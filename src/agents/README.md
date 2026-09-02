# エージェント一覧

編集者・ライター・調査員の3ロールを動かすためのプロンプト・状態管理・実行スクリプト。
2つの動かし方がある。

- **コンソール駆動**（`src/agents/console/`、推奨）: Claude AIへの主な問いかけはClaude.ai
  のコンソールで人間が手動実行する。このリポジトリのコードはプロンプトの生成・GitHub issue
  への出力・返信の解析だけを行い、Anthropic APIを一切呼び出さない。
- **自動実行**（`src/agents/pipeline/`）: Claude API（`claude-sonnet-5`）を直接呼び出して
  全ステップを自動実行する。コストと引き換えに人手を介さず完結できる。

どちらも同じルール（差し戻しは2回目まで、80点以上で合格、2回の差し戻し後70点超なら
条件付きで成立、70点以下は人間確認）で編集者・ライターの往復を進める。

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
返信のJSONを解析してPlanを登録 → ライターへの執筆プロンプトをissueに投稿
  │ (人間がコンソールで実行 → 回答をissueに貼り付け → check)
  ▼
返信のJSONを解析してDraftを登録 → 編集者へのレビュープロンプトをissueに投稿
  │ (人間がコンソールで実行 → 回答をissueに貼り付け → check)
  ▼
返信のJSONを解析してReviewを登録
  ├─ score>=80                        → 完成。記事をissueに投稿して終了
  ├─ score<80 かつ差し戻し2回未満       → ライターへの修正プロンプトを投稿(draftへ戻る)
  └─ score<80 かつ差し戻し2回目         → score>70なら条件付きで成立、70以下は要人間確認
                                          いずれも記事をissueに投稿して終了
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

# 以降、「コンソールで実行→回答を貼り付け→check」を完成まで繰り返す

# (任意) 企画立案の前に調査員へ依頼したい場合
npm run console -- research --issue kumechang/renai-writer#1 \
  --title "調査タイトル" --brief "調べてほしい内容"
```

`GITHUB_TOKEN`（`issues:write` 権限）が常に必要。`research` を使った場合、その調査結果は
`plan` 実行時に自動で企画立案プロンプトへ埋め込まれる。

### 実装メモ

- 状態管理は内部テーブル `IssueSession`（issueごとに、保留中のステップと直前に投稿した
  プロンプトのコメントIDを保持）で行う。1つのissueにつき同時に1つの保留中プロンプトのみ
  許容する。
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

`--issue` で実行した場合、完成した記事は同じissueにコメントとして自動投稿される。

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
