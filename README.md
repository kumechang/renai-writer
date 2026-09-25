# renai-writer

恋愛メディアの記事制作を、3つの役割で分業して支援するシステム。

- **編集者**: テーマに沿った記事の企画立案、ライターが書いた記事の添削
- **ライター**: 編集者が立案した企画をもとに文章を制作
- **調査員**: ライターが執筆に使う資料をWebから収集

このリポジトリでは、3ロールそれぞれのデータをライターが記事執筆に使いやすい形で
蓄積・提供する**データベースAPI**と、3ロールを実際にClaude APIで動かす**エージェント**
（企画立案→執筆→レビュー→差し戻しまでの一気通貫パイプライン）を実装している。

## 技術スタック

- Node.js + TypeScript
- Express (REST API)
- Prisma + SQLite（データストア）
- zod（入力バリデーション）
- Vitest + supertest（テスト）

## セットアップ

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

サーバーは `http://localhost:3000` で起動する。

## データモデル

| モデル | 役割 |
| --- | --- |
| `Topic` | 調査テーマ（編集者の企画に対応する単位）。`title` / `theme`（記事の切り口）/ `brief`（調査依頼メモ）を持つ |
| `Source` | 収集元URLの情報（ドメイン・著者・サイト名・公開日など） |
| `ResearchItem` | 調査員が集めた個別データ。要約・重要ポイント・引用・信頼度/関連度スコア・タグを持つ |
| `Tag` | 記事のトピックやジャンルで横断検索するためのタグ |
| `Plan` | 編集者が立てる企画。想定読者・構成・ボリューム・有料部分の設計・タイトル案50個・実際に記事化する推奨タイトル10個を持つ |
| `Article` | 企画1件から生まれる記事1本。推奨タイトル10個それぞれが1つのArticleになり、並行して独立に執筆・レビューが進む |
| `Draft` | ライターが提出した原稿の1版（`revisionNumber` 0が初稿、1・2が差し戻し後の修正稿） |
| `Review` | 編集者による1原稿へのレビュー結果（0〜100点のスコアとフィードバック、1原稿につき1件） |
| `IssueSession` | 「コンソール駆動」フロー（下記）の進行状況を管理する内部テーブル。GitHub issueごとに、保留中のプロンプトと紐づくコメントIDを保持する |

`ResearchItem` は「元記事の丸写し」ではなく、調査員が要約・評価した上で保存する設計にしている。
ライターはこれをそのまま記事の材料として使える。

## API

### トピック（調査テーマ）

- `POST /api/topics` — トピック作成 `{ title, theme?, brief? }`
- `GET /api/topics` — 一覧（各トピックの収集件数つき）
- `GET /api/topics/:id` — 詳細
- `PATCH /api/topics/:id` — 更新（`status`: `collecting` / `ready` / `archived`）

### 調査データ（調査員が投入）

- `POST /api/topics/:topicId/items` — データ登録

  ```json
  {
    "url": "https://example.com/article",
    "sourceTitle": "記事タイトル",
    "siteName": "サイト名",
    "author": "著者名",
    "publishedAt": "2026-08-01T00:00:00Z",
    "summary": "ライターがそのまま使える要約",
    "keyPoints": ["重要ポイント1", "重要ポイント2"],
    "quotes": [{ "text": "引用文", "context": "誰の発言か等" }],
    "reliability": 4,
    "relevance": 5,
    "tags": ["婚活アプリ", "市場調査"],
    "collectedBy": "researcher-1",
    "notes": "補足メモ"
  }
  ```

- `GET /api/topics/:topicId/items` — 一覧（関連度→信頼度→登録順でソート）
  - クエリ: `tag`, `status`（`new`/`reviewed`/`used`/`rejected`）, `minRelevance`
- `PATCH /api/topics/:topicId/items/:itemId` — 更新（ライター/編集者による採否・修正）
- `DELETE /api/topics/:topicId/items/:itemId` — 削除

### ライター向け集約ビュー（briefing）

- `GET /api/topics/:topicId/briefing` — JSON形式。`rejected` を除き関連度・信頼度順で整形済み
- `GET /api/topics/:topicId/briefing?format=markdown` — 執筆にそのまま使えるMarkdown資料

### タグ

- `GET /api/tags` — 登録済みタグ一覧

### 企画（編集者が立案）

- `POST /api/plans` — 企画作成
  `{ theme, targetReader, structure, volume, paidSection, titleCandidates(50件ちょうど), recommendedTitles(10件ちょうど) }`
- `GET /api/plans` — 一覧
- `GET /api/plans/:id` — 詳細
- `PATCH /api/plans/:id` — `status` の遷移（`planning` / `ready` / `archived`）

### 記事（企画1件から複数、タイトルごとに独立して執筆・レビューが進む）

- `POST /api/plans/:planId/articles` — 記事作成 `{ title }`（`titleCandidates` に含まれる必要あり）
- `GET /api/plans/:planId/articles` — 一覧
- `GET /api/plans/:planId/articles/:articleId` — 詳細
- `PATCH /api/plans/:planId/articles/:articleId` — `status` の遷移
  （`drafting` / `in_review` / `needs_revision` / `accepted` / `accepted_with_reservation` /
  `needs_human_review`）

### 原稿・レビュー（ライターが執筆、編集者が採点。記事ごとに独立）

- `POST /api/plans/:planId/articles/:articleId/drafts` — 原稿登録 `{ title, content, wordCount? }`
  （`revisionNumber` は既存件数から自動採番。省略時 `wordCount` は `content.length`）
- `GET /api/plans/:planId/articles/:articleId/drafts` — 一覧（revisionNumber昇順、レビュー結果つき）
- `GET /api/plans/:planId/articles/:articleId/drafts/:draftId` — 詳細
- `POST /api/plans/:planId/articles/:articleId/drafts/:draftId/review` — レビュー登録
  `{ score(0-100), feedback, isFinalAttempt? }`（1原稿につき1回のみ、`passed` は `score>=80` から自動算出）
- `GET /api/plans/:planId/articles/:articleId/drafts/:draftId/review` — レビュー取得

## エージェント

編集者・ライター・調査員の3ロールを動かすためのプロンプト・状態管理・実行スクリプトを
`src/agents/` に用意している。2つの動かし方がある。

### コンソール駆動（推奨・Anthropic API費用ゼロ）

Claude AIへの主な問いかけは Claude.ai のコンソールで人間が手動実行し、このリポジトリの
スクリプトはプロンプトの生成・GitHub issueへの出力・返信の解析だけを行う。
`npm run console` 自体はAnthropic APIを一切呼び出さない。

1企画（50タイトル案）から、編集者が推奨する10タイトル分の記事を並行して書く。各記事は
GitHubのsub-issue（テーマissueの子issue）として作られ、それぞれ独立して執筆・レビュー・
（必要なら）差し戻しが進む。

```bash
npm run dev  # APIサーバーを起動

# 1. 編集者への企画立案プロンプトをissueに投稿(テーマはissue本文から取得)
npm run console -- plan --issue kumechang/renai-writer#1

# 2. issueに投稿されたプロンプトをClaude.aiのコンソールに貼り付けて実行し、
#    回答(```json ... ```を含む全文)をissueにコメントとして貼り付ける

# 3. 返信を解析し、推奨タイトル10個それぞれのsub-issueを自動作成。
#    各sub-issueにライターへの執筆プロンプトが投稿される。
npm run console -- check --issue kumechang/renai-writer#1

# 4. 以降は各sub-issue(記事1本ごと)で「コンソールで実行→回答を貼り付け→check」を
#    繰り返す。そのsub-issueの番号を指定する。
npm run console -- check --issue kumechang/renai-writer#2

# 執筆→レビュー→(必要なら)差し戻しでの再執筆→完成、まで進むと、
# 完成した記事がそのsub-issueにコメントとして投稿される。

# (任意) 調査員への依頼を先に行いたい場合(企画立案の前に実行する)
npm run console -- research --issue kumechang/renai-writer#1 \
  --title "婚活アプリの料金相場" --brief "20代向け主要アプリの月額料金を調べてほしい"
```

#### GitHub Actionsによる自動化

`plan`/`check`の実行そのものは `.github/workflows/console-plan.yml` /
`console-check.yml` により自動化できる。issueを作成すると企画立案プロンプトが自動投稿され、
issueにコメントを付けるたびに返信の解析と次のプロンプトの投稿が自動で行われる
（テーマの登録とコンソールでの実行・回答の貼り付けは引き続き人間が行う）。
企画の回答が解析されると、推奨タイトル10個分のsub-issueが自動作成され、以降は
sub-issueごとに同じ仕組み（コメント→自動解析→次のプロンプト投稿）が独立して動く。
sub-issueには`auto-article`ラベルが付き、`console-plan.yml`はこのラベルが付いた
issueでは発火しない（テーマissueとして誤処理しないため）。

利用するには以下が必要:

1. **ワークフローがデフォルトブランチにあること**（`issues`/`issue_comment`イベントは
   デフォルトブランチ上のワークフロー定義を使う。このPRがマージされるまでは発火しない）
2. リポジトリの **Settings → Actions → General → Workflow permissions** を
   「Read and write permissions」にする（issueへのコメント投稿とbot.dbのコミットに必要）

状態（Plan/Draft/Review/IssueSessionなど）はActionsの使い捨て実行環境をまたいで
保持する必要があるため、ローカル開発用の `prisma/dev.db`（gitignore対象）とは別に、
**`prisma/bot.db` をリポジトリにコミットして永続化する**方式にしている
（外部DBサービスを使わずに手軽に済ませるためのトレードオフ。SQLiteのバイナリファイルが
git履歴に積み上がる点と、複数issueを同時に自動処理すると競合しうる点は把握した上で採用）。

### 自動実行（Anthropic APIを直接呼び出す・費用が発生）

Claude API（`claude-sonnet-5`）を直接呼び出して全ステップを自動実行する従来方式も残している。
コストと引き換えに人手を介さず完結できる。

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run researcher -- <topicId>
ANTHROPIC_API_KEY=sk-ant-... npm run pipeline -- --theme "20代女性向け婚活アプリの選び方"
```

両方式の詳細・仕組みは [`src/agents/README.md`](src/agents/README.md) を参照。

## X投稿（完成した記事の告知）

完成した記事（`Article.status` が `accepted` / `accepted_with_reservation`）を、Xで告知する
投稿文をライターの人格でClaude APIに生成させ、Xに自動投稿する仕組み。
**amazon-sentaku-shiageリポジトリのX自動投稿の仕組み（Claude APIでの文面生成→
セルフチェック→GitHub issueでの承認→X投稿→時間帯別エンゲージメント学習）をそのまま流用している。**

コンソール駆動フロー（`npm run console`）とは独立した機能で、Anthropic API・X APIを直接
呼び出すため費用が発生する（`src/agents/pipeline/` の自動実行フローと同様の位置づけ）。

### 自動投稿・ペース制御

`config/x-poster.json` の既定値は `approvalMode: "auto"`（セルフチェック合格時は承認を
待たずその場で投稿。不合格の場合は `"auto"` でも必ず人の承認待ちに倒す安全策あり）。

1日あたりの目標投稿数（既定3件、`targetPostsPerDay`。以前は8件だったが、フォロワーが少ない段階で反応の薄い投稿を連発しても1件あたりの反応が薄まるだけだったため絞った。投稿間隔は`minSpacingHours`で3時間以上空ける）を目指し、`.github/workflows/x-post-generate.yml`
が投稿可能時間帯（既定JST 7〜24時、`postingWindow`）の間、毎時起動する。実際に生成するかは
`src/xPoster/shouldGenerateNow.ts`（amazon-sentaku-shiageと同じロジック）が、残り目標数・
直近投稿からの間隔・時間帯の重みをもとに判断するため、毎時起動してもClaude API呼び出し
（コスト）は目標水準に保たれる。

**投稿時間の最適化**: 時間帯ごとの重みは最初は均等（1.0）だが、`x-post-collect-metrics.yml`
（毎日）が投稿済みツイートのエンゲージメント（いいね・リポスト・返信）を取得し、
`x-post-analyze-posting-times.yml`（週次）がそれをClaudeに分析させて時間帯別の重みを更新する
（データが10件貯まるまでは分析をスキップし均等のまま）。反応の良い時間帯ほど生成確率が
上がっていく形で、ターゲット読者の活動時間に合わせて自然に最適化されていく。

**記事の再宣伝と単発投稿**: 書き下ろし記事だけでは毎日のペースを満たせないため、2段構えで
補っている。

1. `repromotionCooldownDays`（既定3日）以上前に宣伝した記事を再び宣伝候補に戻す
   （承認待ち・承認済みで処理中の記事は対象外）。再宣伝の際は、その記事から過去に作った
   投稿文をプロンプトに渡し、**同じ引用・同じ切り口を繰り返さず違う角度で書く**よう指示する
   （記事本文の抜粋も長め(2000字)に渡し、複数ある見出し・ステップの別の部分に触れられるようにしている）。
2. `standalonePostRatio`（既定0.5 = 50%。インプレッション・フォロワー獲得を優先する運用方針に伴い、
   単発投稿の方がインプレッションが伸びる傾向を踏まえて0.3から引き上げた）の確率で、
   特定の記事に紐づかない「単発投稿」
   （恋愛の執着・未練にまつわる気づき・あるある・問いかけなど）を生成する。未宣伝・
   再宣伝可能な記事が1件も無い場合は、この確率に関わらず必ず単発投稿にフォールバックする
   ため、記事の在庫が尽きても生成が完全に止まることはない。単発投稿にも同様に過去の
   単発投稿を渡して切り口の重複を避けさせる。

   単発投稿は、記事URL付きスレッドと同じく**hook(本題)→payoff(補足、1件目への
   返信)の2ツイート構成**で作る(`generateStandalonePost.ts` / `X投稿生成_単発.md`)。
   自分でコメント(返信)を付けた投稿の方がインプレッションが伸びる傾向が見られたため、
   記事の告知以外の投稿にもこの構成を採用している。タイムラインでは1件目しか読まれない
   ため、1件目で場面と気づき・答えまで言い切り、2件目で具体例・深掘り・小さなコツを足す
   (以前は1件目を文の途中で切って答えを2件目に回していたが、答えが見えない1件目には
   いいね・保存が付かなかったためやめた)。

**書き出し・ネタの重複防止**: すべての投稿種別で、種別・記事ごとの過去投稿
(`recentPostsForVarietyWindow`、既定10件)に加えて、アカウント全体の直近の投稿の書き出し
(`recentOpeningsWindow`、既定30件)をプロンプトに渡し、同じネタ・似た書き出しを避けさせる。
「〜ない?」で始める・「責めなくていい」で締める・1件目を途中で切る、といった型の固定化は
`config/x_account_info.md`の「型の固定化」で禁止している。

### 安全チェック

投稿は人の確認なしに自動投稿されうるため、すべての投稿種別のセルフチェックで、点数とは別に
安全チェックを行う(`safetyCheck.ts`)。以下に1つでも該当するとセルフチェックが
`safety_violations`に書き出し、点数に関係なく不合格(=autoモードでも人の承認待ち)にする。
該当内容は承認issueの指摘事項に`[安全]`付きで表示される。

- 希死念慮・自傷・摂食障害・不眠などの症状、DV・モラハラ・性暴力、精神疾患に触れている
- つきまとい・相手の監視・拒否された後の接触を肯定、または当たり前のことのように扱っている
- 失恋直後の読者が「自分はまだダメだ」と感じる判定やラベルがある
- 回復の期限、出典のない数値、実在を確認できない体験談を事実のように書いている
- 心理学・脳科学の話を過剰に断定している

生成側でも、同じ内容を`config/x_account_info.md`の「読者を傷つけうる内容」で禁止している。

### 保存型投稿とペルソナによる保存判定

共感系の投稿はいいねは付いても保存(ブックマーク)が付かず、フォローに結びつきにくかった
ため、次の2つの仕組みを入れている。

- **保存型投稿**(`postKind=save_worthy`): 記事URL付きスレッドに当たらなかった場合、
  `saveWorthyPostRatio`(既定0.3)の確率で、記事に紐づかない1ツイートの「保存型」投稿を作る
  (`generateSaveWorthyPost.ts` / `X投稿生成_保存型.md`)。置き換え行動型・チェックリスト型・
  お守りの言葉型のいずれかをランダムに選び、途中で切らず投稿単体で持ち帰れる中身を書かせる。
- **保存判定**: すべての投稿種別のセルフチェックで、`config/x_reader_personas.md`の想定読者
  ペルソナごとに「この投稿をブックマークするか」を判定させ、承認issueに表示する。保存型投稿では
  少なくとも1人が保存する判定であることを合格条件にし、それ以外の種別では採点に含めない
  参考情報として記録する(`selfCheckJson`の`bookmark_review`)。

### 記事issueの公開状況(オープン=未公開/クローズ=公開済み)

記事issue(sub-issue)が**オープンのままか、運用者が手動でクローズしたか**を、X投稿生成時に
GitHub APIで確認し、生成方針を切り替える(記事issueは`npm run console -- check`で完成しても
自動ではクローズされない。運用者が他媒体に記事を公開したタイミングでissueをクローズする
運用を想定している)。

- **オープン(まだ他媒体に未公開)**: 内容の具体的な詳細・結論・引用を一切明かさない
  「匂わせ」投稿にする。記事本文はごく短い抜粋(300字)だけを材料として渡し、URLも付けない。
- **クローズ済み(公開済み)**: 内容を具体的に紹介してよい(通常の生成。記事本文の抜粋も
  2000字渡す)。`--url` で公開先URLを渡せば投稿にも含める。

元issueが見つからない、またはGitHub側の状態取得に失敗した場合は、内容を漏らさない安全側
(未公開=匂わせ)として扱う。

### 記事URL付き投稿(公開済み記事を2ツイート構成のスレッドで告知)

クローズ済み(公開済み)の記事issueの**コメントに運用者が記事の公開先URLを貼っておく**と、
自動選択時にそれを拾って「本題(hook)」→「深掘り+記事URL(payoff)」の2ツイート構成のスレッドで
告知する。通常の1ツイート投稿とは別枠で扱い、以下の仕様になっている(`urlThreadCandidate.ts` /
`generateUrlThreadPost.ts` / `finalizePost.ts`)。

- **直近7日間で`urlPostsPerWeek`件(既定2件)まで**。同じ記事のURLを短期間に何度も貼ると、
  スパム扱いや読者の飽きにつながるため絞っている。複数の記事が公開済みでURL付き投稿の対象に
  なり得る場合は、その中からランダムに1件を選ぶ。
- 公開先URLとして使うのは、`publishedArticleUrlPattern`(既定は`note.com/yurumeru_romance`の
  記事URLの形)に一致するものだけ。コメントを新しい順に見て、最初に一致したURLを使う。
  以前はclaude.aiなど特定のドメインを除く方式だったが、Claude Codeのattributionリンクが
  投稿に紛れ込む事故があったため、許可する形で絞る方式に変えた。
- 1ツイート目(hook)は記事の中の気づきを一つ選び、答えまで含めて言い切る(1件目だけ読んでも
  価値があるようにする)。
- 2ツイート目(payoff)は記事にある具体的な方法・理由を一つ足し、記事URLを付けて**1ツイート目への返信(リプライ)**
  として投稿する(`postReply` → `v2.reply`)。記事URLはコメント側にのみ付き、1ツイート目には
  付かない。
- 対象は「公開済み(issueクローズ済み)」かつ「コメントに公開先URLがある」記事のみ。
  処理中(承認待ち・承認済み)の記事URL付き投稿がある記事、`urlThreadCooldownDays`(既定14日)
  以内にURL付き投稿を出したばかりの記事は候補から除外する。
- 文字数超過時の短縮は、hookとpayoff+URLをそれぞれ独立に行う(URL自体は縮められないため、
  payoff側はURL分の文字数を差し引いた上限で短縮する)。
- 1ツイート目の投稿に成功した後で2ツイート目(返信)の投稿に失敗した場合、1ツイート目は
  取り消せないため、`post_failed`として記録した上でその旨をissueコメントで知らせる。
- 承認issueには「投稿候補(1件目)」「投稿候補(2件目・1件目への返信、記事URL付き)」の
  2つの本文が並べて表示される。

対象が見つからない(公開済み記事が無い、URLコメントがまだ無い、既に今日の上限に達している
など)場合は、通常の投稿生成フローにフォールバックする。

```bash
# 引数なしで実行すると、まだXで宣伝していない完成記事の中から1件を自動で選んで投稿文を
# 生成する(記事が尽きていればrepromotionCooldownDays日以上前の記事を再選択する)。
ANTHROPIC_API_KEY=sk-ant-... GITHUB_TOKEN=... GITHUB_REPOSITORY=kumechang/renai-writer \
  npm run x-post:generate

# 宣伝する記事を明示的に指定したい場合は --issue で紐づいたsub-issueを指定する
# (auto-articleラベル付きのissue)。記事の公開先URLが決まっている場合は --url も渡せる
# (--issueを指定した場合のみ有効。省略するとURLを含まない投稿文になる)。
ANTHROPIC_API_KEY=sk-ant-... GITHUB_TOKEN=... GITHUB_REPOSITORY=kumechang/renai-writer \
  npm run x-post:generate -- --issue kumechang/renai-writer#12 --url "https://example.com/articles/xxx"
```

### 承認issue・フィードバックの取り込み

`approvalMode: "auto"` でも、生成された投稿ごとに承認issue（`pending-x-post-approval`
ラベル）が作られ、実際の投稿本文・スコアが記録される（自動投稿された場合は
「投稿しました: URL」のコメントとともにクローズされる）。

投稿を見返して気になった点があれば、承認issue（クローズ済みでもよい）に自由な文面で
コメントを残せる。「承認」「却下」といったキーワードを含まないコメントは
**次回以降の投稿生成時の「避けるべき方向性」のヒントとして自動的に記録される**
（`.github/workflows/x-post-approval.yml` → `npm run x-post:handle-approval`）。
承認前の投稿に「却下 理由」とコメントすればそこで投稿は取り止められ、その理由も
同様にヒントとして次回以降に活かされる。

投稿文の生成自体は `.github/workflows/x-post-generate.yml`（`workflow_dispatch`）からも
手動実行できる。記事の完成（`npm run console -- check`）に自動連動はしていない
（コンソール駆動フローのAnthropic API費用ゼロという前提を崩さないため、意図的に分離している）。

### トレンドワードの活用

X APIの公式トレンド機能(`GET /2/trends/by/woeid`)はProティア以上($5,000/月)が
必要で利用できないため、代わりに`config/x-trend-words.json`の恋愛ジャンルの検索語で
Xの直近投稿を検索し、よく使われているハッシュタグを自前で集計する
(`src/xPoster/trendWords.ts`、discoverAccounts.tsと同じ投稿検索エンドポイントを使う)。

`npm run x-post:collect-trends`(`.github/workflows/x-post-collect-trends.yml`、
4時間おき)が収集し、`TrendWord`として保存する(1回の収集ごとに全件入れ替える)。
投稿生成時(`generatePost.ts`/`generateStandalonePost.ts`/`generateUrlThreadPost.ts`)
は、これを「直近よく使われている言葉」ヒントとしてプロンプトに渡す。無理に使わせる
ものではなく、自然に絡められそうな場合だけ使うようライターに指示している。件数は
`config/x-poster.json`の`trendWordsLimit`(既定8件)で調整する。

### 設定・関連コマンド

設定は `config/x-poster.json`（承認モード・使用モデル・文字数上限・1日の目標投稿数・
投稿可能時間帯・再宣伝までの日数・単発投稿の比率(`standalonePostRatio`)・保存型投稿の比率
(`saveWorthyPostRatio`)・記事URL付き投稿の上限(`urlPostsPerWeek`)と間隔(`urlThreadCooldownDays`)・トレンドワードの件数
(`trendWordsLimit`)など）と`config/x_account_info.md`（Xアカウントのペルソナ・トーン）、
`config/x_reader_personas.md`（保存判定に使う想定読者ペルソナ）で調整する。

```bash
npm run x-post:generate               # 投稿文生成(自動選択 or --issue指定)
npm run x-post:handle-approval        # 承認issueへのコメント処理(Actions経由での実行を想定)
npm run x-post:collect-metrics        # 投稿済みツイートのエンゲージメント取得
npm run x-post:analyze-posting-times  # エンゲージメント実績から時間帯ごとの投稿重みを算出
npm run x-post:collect-trends         # ジャンル内のトレンドワードを収集
```

必要な環境変数（`X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET`）は
`.env.example` を参照。X APIキーが未設定でもドライラン（ログ出力のみ）で動作する。

## Xエンゲージメント施策（インプレッションの多い投稿にリプライ）

業者に頼らずフォロワーを増やす方法として、「同じジャンルで多くの人の目に触れている
投稿に、心のこもった（かつ有益な）リプライを返す」というアドバイスがある。これを
Xの高インプレッション投稿の検知まで自動化した仕組み（`src/xEngagement/`）。

**リプライ文の生成・投稿はどちらも自動化していない。**

- 投稿: X APIの自動化ルール（[X's automation development
  rules](https://help.x.com/en/rules-and-policies/x-automation)）は、自分の
  アカウントがメンションされていない他アカウントの投稿への自動リプライを禁止しており、
  検索で見つけたアカウントの投稿は当然これに該当する。
- 生成: 当初はClaude APIでリプライ文を自動生成していたが、API使用量を気にせず
  運用したいという要望から、Claude APIは呼ばない方式に変更した。

そのため今の仕組みは、高インプレッションの投稿を見つけたら**GitHub issueに
「Claude.aiのチャット画面に貼り付けるプロンプト」を書くところまで**で終わる。
実際にどう返信するか考えるのも、Xへの投稿も、どちらも運用者が手動で行う
（`src/agents/researcher/`等で使っている「コンソール駆動」と同じ考え方。Claude.aiの
チャット利用は課金APIではないため、issueを何件作っても追加コストは発生しない）。

### 高インプレッション投稿の検知とリプライ検討issue

`npm run x-engagement:collect`（`.github/workflows/x-engagement-collect.yml`、
1日1回のnative schedule）が、以下を行う（`src/xEngagement/findReplyCandidates.ts`）。

1. 特定アカウントの監視ではなく、`config/x-engagement-search.json`のジャンル横断
   キーワード検索（恋愛・婚活など）で直近の投稿を**1回のAPI呼び出しだけ**取得する
   （既定10件。X APIの読み取りは返ってきた件数に応じて課金されるため、1回あたりの
   コストは`件数 × 約$0.005`で固定される。ユーザー情報は取得しない
   ―1ユーザーの読み取りに約$0.010かかるため、あえて取得せずコストを抑えている）。
2. 取得した投稿のうち、インプレッション数（`impressionCount`、取得無料の付随情報）が
   `config/x-engagement-search.json`の`impressionThreshold`（既定1000）を超えているものを、
   同一投稿者からは最もインプレッション数の多い1件だけに絞り込む。
3. 該当する投稿ごとに、まだ`WatchedPost`として保存していなければGitHub issue
   （`x-engagement-reply-prompt`ラベル）を作る。issueには対象の投稿本文と、
   Claude.aiのチャット画面にそのままコピー&ペーストできる「リプライ検討プロンプト」
   （`src/xEngagement/replyConsolePrompt.ts`）を書く。Claude APIは呼ばないため、
   何件issueを作ってもAPI使用量は増えない。

投稿者のユーザー名は取得しないため、issueには`https://x.com/i/web/status/{tweetId}`
形式のリンクだけを載せる（ユーザー名を問わずツイートIDだけで正しい投稿に遷移するため、
誰の投稿かはリンクを開いて直接確認する）。

運用者はissueを開き、プロンプトをClaude.aiのチャットに貼り付けて返信文を考えてもらい、
気に入った文面ができたらXアプリ等から手動でリプライを投稿し、issueをクローズする。
「良いリプライ案が思いつきません」という返答だった場合（対象投稿がリンク先の画像などで
本文だけでは中身が分からない場合など）は、リプライを見送ってクローズしてよい。

```bash
npm run x-engagement:collect   # 高インプレッション投稿を検知し、リプライ検討issueを作る
```

必要な環境変数は`GITHUB_TOKEN` / `GITHUB_REPOSITORY` / `X_API_KEY`等（`.env.example`参照）。
`ANTHROPIC_API_KEY`は不要（Claude APIを呼ばないため）。

### （運用停止中）特定アカウントを監視する旧方式

以前は「フォロワー1万人以上の憧れのアカウント」を`config/x-watch-accounts.json`に
5〜10件登録し、そのアカウントの新着投稿だけを監視する方式だった
（`WatchedAccount`モデル、`npm run x-engagement:discover`によるアカウント探索）。
1回の検知でも複数アカウント分の投稿ぶんissueが作られ、GitHub issueが荒れやすかった
ことと、ユーザー情報の取得コストが変動しやすかったことから、上記のジャンル横断検索
＋インプレッションしきい値方式に置き換えた。`WatchedAccount`関連のコード
（`src/xEngagement/discoverAccounts.ts`等）とconfigは、将来また特定アカウントを
狙い撃ちしたくなった場合のために残してあるが、現在の`x-engagement:collect`からは
呼び出していない。

## テスト

```bash
npm test
```

テストは専用のSQLiteファイル（`test/test.db`）に対して `prisma db push` を行った上で実行される。

## 今後の拡張（未実装）

- GitHub issueの新規作成をトリガーに、パイプラインを自動起動する仕組み（現状はCLIから手動実行）
- タイトル確定・レビュー結果などを人間が見るための管理画面（現状はAPI経由での確認のみ）
