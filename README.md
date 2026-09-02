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
| `Plan` | 編集者が立てる企画。想定読者・構成・ボリューム・有料部分の設計・タイトル案50個を持つ |
| `Draft` | ライターが提出した原稿の1版（`revisionNumber` 0が初稿、1・2が差し戻し後の修正稿） |
| `Review` | 編集者による1原稿へのレビュー結果（0〜100点のスコアとフィードバック、1原稿につき1件） |

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

- `POST /api/plans` — 企画作成 `{ theme, targetReader, structure, volume, paidSection, titleCandidates(50件ちょうど), recommendedTitle }`
- `GET /api/plans` — 一覧
- `GET /api/plans/:id` — 詳細
- `PATCH /api/plans/:id` — 更新（`selectedTitle` の確定、`status` の遷移）
  - `status`: `planning` / `drafting` / `in_review` / `needs_revision` / `accepted` /
    `accepted_with_reservation` / `needs_human_review` / `archived`

### 原稿・レビュー（ライターが執筆、編集者が採点）

- `POST /api/plans/:planId/drafts` — 原稿登録 `{ title, content, wordCount? }`
  （`revisionNumber` は既存件数から自動採番。省略時 `wordCount` は `content.length`）
- `GET /api/plans/:planId/drafts` — 一覧（revisionNumber昇順、レビュー結果つき）
- `GET /api/plans/:planId/drafts/:draftId` — 詳細
- `POST /api/plans/:planId/drafts/:draftId/review` — レビュー登録
  `{ score(0-100), feedback, isFinalAttempt? }`（1原稿につき1回のみ、`passed` は `score>=80` から自動算出）
- `GET /api/plans/:planId/drafts/:draftId/review` — レビュー取得

## エージェント（Claude API）

編集者・ライター・調査員の3ロールを Claude API（`claude-sonnet-5`）で実際に動かすプロンプト・
ツール定義・実行スクリプトを `src/agents/` に用意している。企画立案→執筆→レビュー→
（必要なら）差し戻しまでを一気通貫で実行するパイプラインも含む。詳細は
[`src/agents/README.md`](src/agents/README.md) を参照。

```bash
# 調査員のみ単体実行
ANTHROPIC_API_KEY=sk-ant-... npm run researcher -- <topicId>

# 編集者→ライター→編集者レビュー→(必要なら)差し戻しまで一気通貫で実行
ANTHROPIC_API_KEY=sk-ant-... npm run pipeline -- --theme "20代女性向け婚活アプリの選び方"
```

## テスト

```bash
npm test
```

テストは専用のSQLiteファイル（`test/test.db`）に対して `prisma db push` を行った上で実行される。

## 今後の拡張（未実装）

- GitHub issueの新規作成をトリガーに、パイプラインを自動起動する仕組み（現状はCLIから手動実行）
- タイトル確定・レビュー結果などを人間が見るための管理画面（現状はAPI経由での確認のみ）
