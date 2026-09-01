# エージェント一覧 (Claude API)

編集者・ライター・調査員の3ロールを Claude API（`claude-opus-5`）で実際に動かすための
プロンプト・ツール定義・実行スクリプト。すべて `src/agents/pipeline` が一気通貫で
オーケストレーションする。

## 全体の流れ

```
テーマ(GitHub issue または直接指定)
  │
  ▼
編集者: 企画立案 (runEditorPlanning)
  - 想定読者・構成・ボリューム・有料部分の設計、タイトル案50個 を submit_plan で登録
  - 必要なら request_research で調査員に依頼
  │
  ▼
ライター: 初稿執筆 (runWriterDraft)
  - 企画に沿って本文を執筆し submit_draft で登録 (revisionNumber=0)
  - 必要なら request_research で調査員に依頼
  │
  ▼
編集者: レビュー (runEditorReview) ──score>=80──▶ accepted で終了
  │ score<80
  ▼
ライターが差し戻し2回目まで修正 (runWriterRevision) ──▶ 編集者が再レビュー
  │
  ▼ (2回の差し戻し後もscore<80)
score>70 なら accepted_with_reservation として成立
score<=70 なら needs_human_review (人間の編集者の確認が必要)
```

差し戻しは2回目まで（初稿+修正2回=最大3原稿・3回のレビュー）。

## ディレクトリ構成

| ディレクトリ | 役割 |
| --- | --- |
| `researcher/` | 調査員。`web_search`/`web_fetch` でWeb調査し `submit_research_item` でDBに登録 |
| `editor/` | 編集者。`submit_plan`（企画立案）と `review_draft`（レビュー・採点）の2つのモード |
| `writer/` | ライター。`submit_draft`（執筆・修正、いずれも全文提出） |
| `pipeline/` | 上記を差し戻しルールに従って一気通貫で実行するオーケストレーター |
| `shared/` | 各エージェント共通のユーティリティ。特に `requestResearchTool.ts` は編集者・
ライターの両方から「調査員に依頼する」ために使う |

編集者・ライターはいずれも `request_research` ツールを持ち、呼び出すとその場で
調査員エージェントを実行してMarkdown資料を受け取る（プロセスを分けず、同一プロセス内で
呼び出す）。

## 使い方

```bash
# 1. APIサーバーを起動
npm run dev

# 2a. テーマを直接指定して実行
ANTHROPIC_API_KEY=sk-ant-... npm run pipeline -- --theme "20代女性向け婚活アプリの選び方"

# 2b. テーマをGitHub issueに書いた場合(本文をそのままテーマとして使う)
GITHUB_TOKEN=... ANTHROPIC_API_KEY=sk-ant-... npm run pipeline -- --issue kumechang/renai-writer#12
```

`GITHUB_TOKEN` はprivateリポジトリのissueを読む場合のみ必要。

実行結果は `Plan` / `Draft` / `Review` としてDBに保存され、以下から参照できる。

- `GET /api/plans/:id` — 企画内容と最終ステータス
- `GET /api/plans/:planId/drafts` — 各版の原稿(レビュー結果つき)

## タイトルの確定について

編集者は50個のタイトル案から `recommendedTitle` を1つ選ぶが、これは人間の最終確認前の
暫定案。ライターはデフォルトで `selectedTitle ?? recommendedTitle` を使うため、
人間が別のタイトルにしたい場合は執筆前に次で上書きできる。

```bash
curl -X PATCH http://localhost:3000/api/plans/<planId> \
  -H 'Content-Type: application/json' \
  -d '{"selectedTitle": "候補の中から選んだタイトル"}'
```

## 個別エージェントの詳細

調査員エージェント固有の設計メモ（zod/v4の扱いなど）は
[`researcher/README.md`](researcher/README.md) を参照。
