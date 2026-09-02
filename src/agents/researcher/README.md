# 調査員エージェント (Claude API)

Claude API（`claude-sonnet-5`）で「調査員」ロールを実際に動かすためのプロンプトとツール定義。
`web_search` / `web_fetch`（Anthropicのサーバー側ツール）でWeb上の情報を集め、
1件ごとに `submit_research_item` ツールを呼び出して、このリポジトリのAPI
（`POST /api/topics/:topicId/items`）へそのまま登録する。

記事の執筆や企画立案はこのエージェントの役割ではない。あくまで
「ライターが記事執筆にそのまま使える形の調査データを集める」ことだけを行う。

## 構成

| ファイル | 役割 |
| --- | --- |
| `systemPrompt.ts` | 調査員としての振る舞い・出典の扱い方・信頼度/関連度の評価基準を定義するシステムプロンプト |
| `tools.ts` | `submit_research_item`（自前APIへ登録するツール）と `web_search` / `web_fetch`（Anthropicのサーバー側ツール）の定義 |
| `runResearcher.ts` | 指定した `topicId` に対してエージェントを1回実行するCLIエントリポイント |

## 前提条件

- このリポジトリのAPIサーバーが起動していること（`npm run dev`）
- `ANTHROPIC_API_KEY` が環境変数または `.env` に設定されていること
- 調査対象の `Topic` が事前に作成されていること（`POST /api/topics`）

## 使い方

```bash
# 1. APIサーバーを起動
npm run dev

# 2. 調査テーマを作成（例）
curl -s -X POST http://localhost:3000/api/topics \
  -H 'Content-Type: application/json' \
  -d '{"title":"婚活アプリ徹底比較2026","theme":"20代向け婚活アプリの選び方","brief":"料金と成婚率を重視"}'
# => { "id": "xxxxx", ... }

# 3. 調査員エージェントを実行
npm run researcher -- xxxxx
```

実行が終わると、集めた情報は `GET /api/topics/:topicId/items` や
`GET /api/topics/:topicId/briefing` からライター向けの形式で参照できる。

## 環境変数

| 変数 | 説明 | デフォルト |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude APIキー | なし（必須） |
| `RESEARCH_API_BASE_URL` | このリポジトリのAPIサーバーのURL | `http://localhost:3000` |
| `RESEARCHER_AGENT_NAME` | `collectedBy` に記録する調査員の識別名 | `claude-researcher-agent` |

## 設計メモ

- `submit_research_item` の入力スキーマは `src/schemas/researchItem.ts` の
  `createResearchItemSchema` と項目を揃えているが、Anthropic SDKの `betaZodTool` が
  zod/v4 の型を要求するため、`tools.ts` 側で zod/v4 として別途定義している
  （REST API側のバリデーションは引き続き classic zod(v3) で行われる）。
- モデルは `claude-sonnet-5` を使用（`claude-opus-5` の1/2.5程度のコストで運用するため）。
- `web_search` / `web_fetch` はいずれもAnthropicのサーバー側で実行されるツールで、
  1回の実行あたりの利用回数を `max_uses` で制限している（コスト・実行時間の上限）。
- 長時間の調査でサーバー側ツールの呼び出し回数上限に達すると `pause_turn` が返る
  ことがあるため、`runResearcher.ts` はストリーミングで実行しつつ `pause_turn` を
  検知して自動的に継続する。
