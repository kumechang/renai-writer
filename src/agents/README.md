# エージェント一覧

編集者・ライター・調査員の3ロールを動かすためのプロンプト・状態管理・実行スクリプト。
2つの動かし方がある。

- **コンソール駆動**（`src/agents/console/`、推奨）: Claude AIへの主な問いかけはClaude.ai
  のコンソールで人間が手動実行する。このリポジトリのコードはプロンプトの生成・GitHub issue
  への出力・返信の解析だけを行い、Anthropic APIを一切呼び出さない。1つの企画（50タイトル案）
  から、編集者が推奨する10タイトル分の記事を並行して書ける。
- **自動実行**（`src/agents/pipeline/`）: Claude API（`claude-sonnet-5`）を直接呼び出して
  全ステップを自動実行する。コストと引き換えに人手を介さず完結できるが、1企画につき
  推奨タイトルの1つ目のみを使って1記事だけを書く（複数記事はコンソール駆動フローを使う）。

どちらも同じルール（差し戻しは2回目まで、80点以上で合格、2回の差し戻し後70点超なら
条件付きで成立、70点以下は人間確認）で編集者・ライターの往復を進める。

## データの関係

```
Plan(企画: 想定読者・構成・ボリューム・有料部分・タイトル案50個・推奨タイトル10個)
  └─ Article(記事1本。推奨タイトルごとに1つ、並行して独立に進む)
       └─ Draft(原稿の各版) ── Review(1版につき1件)
```

## コンソール駆動フロー（`src/agents/console/`）

```
GitHub issue(テーマ記載)
  │
  │ npm run console -- plan --issue owner/repo#番号
  ▼
編集者への企画立案プロンプトをissueにコメント投稿
  │ (人間がClaude.aiのコンソールに貼り付けて実行し、回答をissueに貼り付ける)
  │ npm run console -- check --issue owner/repo#番号
  ▼
返信のJSON(タイトル案50個+推奨10個など)を解析してPlanを登録
  │
  ▼
推奨タイトル10個それぞれについて:
  - Article を作成
  - GitHubのsub-issue(このissueの子issue)を作成
  - ライターへの執筆プロンプトをそのsub-issueに投稿
  (この時点で元issueでの作業は完了。以降は10個のsub-issueがそれぞれ独立して進む)
  │
  ▼ (各sub-issueで以下を繰り返す)
返信のJSONを解析してDraftを登録 → 編集者へのレビュープロンプトを同じsub-issueに投稿
  │ (人間がコンソールで実行 → 回答をsub-issueに貼り付け → check)
  ▼
返信のJSONを解析してReviewを登録
  ├─ score>=80                        → 完成。記事をsub-issueに投稿して終了
  ├─ score<80 かつ差し戻し2回未満       → ライターへの修正プロンプトを投稿(draftへ戻る)
  └─ score<80 かつ差し戻し2回目         → score>70なら条件付きで成立、70以下は要人間確認
                                          いずれも記事をsub-issueに投稿して終了
```

`check` は「issueに保留中のプロンプトより新しいコメントがあるか」を見て、あれば処理して
次のプロンプトを投稿するだけの、何度でも安全に呼べるコマンド。まだ返信がなければ
「まだ返信が見つかりません」と言って何もしない。

### 使い方

```bash
npm run dev  # APIサーバーを起動

# 企画立案から開始(テーマはissue本文から取得)
npm run console -- plan --issue kumechang/renai-writer#1

# issueに投稿されたプロンプトをClaude.aiのコンソールに貼り付けて実行し、
# 回答(```json ... ```を含む全文)をissueにコメントとして貼り付けてから:
npm run console -- check --issue kumechang/renai-writer#1
# → 推奨タイトル10個分のsub-issue(例: #2〜#11)が自動作成される

# 以降は各sub-issue(記事1本ごと)で「コンソールで実行→回答を貼り付け→check」を
# 完成まで繰り返す。そのsub-issueの番号を指定する。
npm run console -- check --issue kumechang/renai-writer#2

# (任意) 企画立案の前に調査員へ依頼したい場合
npm run console -- research --issue kumechang/renai-writer#1 \
  --title "調査タイトル" --brief "調べてほしい内容"
```

`GITHUB_TOKEN`（`issues:write` 権限、およびsub-issue作成には `issues:write` で足りる）が
常に必要。`research` を使った場合、その調査結果は `plan` 実行時に自動で企画立案プロンプトへ
埋め込まれる。

### 実装メモ

- 状態管理は内部テーブル `IssueSession`（issueごとに、保留中のステップと直前に投稿した
  プロンプトのコメントIDを保持）で行う。1つのissue(sub-issueを含む)につき同時に1つの
  保留中プロンプトのみ許容する。
- sub-issue作成は `lib/github.ts` の `createSubIssue`（issue作成 + GitHubのsub-issue APIで
  親子紐付け）で行い、`auto-article` ラベルを付与する。このラベルは、GitHub Actions側で
  「テーマissue用のワークフロー」を記事issueに対して誤発火させないためのマーカーとしても使う。
- 返信の解析は、コメント本文から最初の \`\`\`json ... \`\`\` コードブロックを取り出して
  （`shared/jsonBlock.ts`）、既存の `src/schemas/*`（REST APIと共通のclassic zod）で
  検証する。ツール呼び出しを使わないため、API側のバリデーションをそのまま再利用できる。
- プロンプト文中で `<!-- PAID_SECTION -->` のようなHTMLコメント構文をそのまま地の文に
  書くと、GitHub上でHTMLコメントとして解釈され表示から消えるため、説明文中では
  インラインコード（バッククォート1つ）で囲んでいる。

## 自動実行フロー（`src/agents/pipeline/`）

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run researcher -- <topicId>
ANTHROPIC_API_KEY=sk-ant-... npm run pipeline -- --theme "20代女性向け婚活アプリの選び方"
# または
ANTHROPIC_API_KEY=sk-ant-... GITHUB_TOKEN=... npm run pipeline -- --issue kumechang/renai-writer#12
```

推奨タイトル10個のうち1つ目だけを使って1記事を書く。`--issue` で実行した場合、完成した
記事は同じissueにコメントとして自動投稿される。複数記事をまとめて書きたい場合はコンソール
駆動フローを使うこと。

編集者・ライターはいずれも `request_research` ツールを持ち、呼び出すとその場で調査員
エージェントを実行してMarkdown資料を受け取る（プロセスを分けず、同一プロセス内で呼び出す）。

## ディレクトリ構成

| ディレクトリ | 役割 |
| --- | --- |
| `researcher/` | 調査員。`systemPrompt.ts`/`tools.ts`/`run.ts` は自動実行用、`consolePrompt.ts` はコンソール用 |
| `editor/` | 編集者。同様に自動実行用とコンソール用のプロンプトを両方持つ |
| `writer/` | ライター。同様 |
| `pipeline/` | 自動実行のオーケストレーター。`formatComment.ts` は完成記事のコメント整形（コンソール駆動側でも共用） |
| `console/` | コンソール駆動の状態管理・CLI（`run.ts` が本体、`runConsole.ts` がエントリポイント） |
| `shared/` | 両方式で共通のユーティリティ（HTTPヘルパー、JSON抽出、共通型など） |

## タイトルの選び方について

編集者は50個のタイトル案の中から、実際に記事化する10個(`recommendedTitles`)を選ぶ。
この10個それぞれが独立したArticleになり、並行して執筆・レビューが進む。人間による
事前確認は挟まらないため、編集者の選定をそのまま信頼する運用になっている。
特定のタイトルだけを追加で記事化したい場合は、`POST /api/plans/:planId/articles`
（`titleCandidates` に含まれるタイトルなら50個のうちどれでも指定可）で個別に追加できる。

## 個別エージェントの詳細

調査員エージェント固有の設計メモ（zod/v4の扱いなど）は
[`researcher/README.md`](researcher/README.md) を参照。
