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

## テスト

```bash
npm test
```

テストは専用のSQLiteファイル（`test/test.db`）に対して `prisma db push` を行った上で実行される。

## 今後の拡張（未実装）

- GitHub issueの新規作成をトリガーに、パイプラインを自動起動する仕組み（現状はCLIから手動実行）
- タイトル確定・レビュー結果などを人間が見るための管理画面（現状はAPI経由での確認のみ）
