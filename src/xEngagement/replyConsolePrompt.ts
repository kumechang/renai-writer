import { loadConfigDoc } from "../xPoster/promptLoader";

export interface ReplyConsolePromptInput {
  authorUsername: string;
  postText: string;
  charLimit: number;
}

// config/x_account_info.mdの先頭にある編集用のHTMLコメント(「実際のアカウント運用方針に
// 合わせて調整してください...」)は、ファイルを編集する運用者向けの注記であって、
// Claude.aiに渡すプロンプトの一部ではないため取り除く。
function loadAccountInfoForPrompt(): string {
  return loadConfigDoc("x_account_info.md")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

// Claude.aiのチャット画面に人間が直接コピー&ペーストして実行するためのプロンプト。
// Claude APIは呼ばない(API使用量を気にせず、新着投稿を見つけ次第issueを作れるようにする
// ため)。src/agents/researcher/consolePrompt.tsと同じ「コンソール駆動」の考え方を、
// リプライ検討に応用したもの。
// 案の作成とセルフチェックを1つのプロンプト(1回の貼り付け)で行い、最終版のリプライ
// 本文だけを出力させる(以前は生成用・レビュー用の2つのプロンプトに分けていたが、
// 毎回2回貼り付ける必要があって手間だったため統合した)。
export function buildReplyConsolePrompt(input: ReplyConsolePromptInput): string {
  const accountInfo = loadAccountInfoForPrompt();

  return `あなたは、恋愛メディアの記事制作チームに所属する「ライター」です。中の人として
Xを運用しています。

同じジャンルで発信している、フォロワー数の多い「憧れのアカウント」の投稿に、自分の言葉で
心のこもった(かつ読んだ人の役に立つ)リプライを返してください。

宣伝や自己紹介ではなく、その投稿の内容そのものに反応する、1人の読者・1人の発信者としての
リプライを書いてください。

まず案を1つ考えたうえで、下の「チェック項目」に沿って自分自身で見直し、必要なら
書き直してから、最終版のリプライ本文だけを出力してください(検討過程は出力しないで
ください)。

# あなた自身のペルソナ

${accountInfo}

# リプライ対象の投稿

投稿者: @${input.authorUsername}

\`\`\`
${input.postText}
\`\`\`

# チェック項目

- 投稿の内容を実際に読んで反応したことが伝わるか。誰の投稿にでも使い回せるような
  当たり障りのないコメント(「勉強になります」「素敵ですね」だけで終わるなど)に
  なっていないか。
- 「心のこもった」リプライであると同時に、「有益な」リプライになっているか。
  以下のいずれかの要素を最低1つは含めること。
  - 投稿内容への具体的な共感・自分の実体験や視点との重なり
  - 投稿内容を補足する小さな気づき・視点(押し付けがましくない範囲で)
  - 投稿者の言葉に対する、具体的な言葉を引用しての反応
- 相手のフォロワーではなく相手本人に向けて書く、自然な会話のトーンになっているか。
- 自分のアカウント・記事・商品の宣伝、フォロー/フォロバの依頼が書かれていないか。
- 「絶対に」「100%」など根拠のない断定、投稿者や第三者を否定・攻撃する表現、
  過度にへりくだった/媚びるような表現が無いか。
- 絵文字を使いすぎていないか(使う場合も1個程度に留める)。
- 全角${input.charLimit}文字を絶対に超えていないか。目安は全角60〜120文字程度。

# 出力

- 上のチェック項目をすべて満たす、最終版のリプライ本文のみを出力してください。
  前置き・説明・引用符・コードブロック記法は一切含めないでください。
- 対象の投稿がリンク先の画像・記事など、あなたに見えない内容への言及の場合(「これ見て」
  「ここ」など本文だけでは中身が分からない場合)は、無理に反応をひねり出さず、
  「今回は良いリプライ案が思いつきません」とだけ答えてください。`;
}

export interface ReplyReviewPromptInput extends ReplyConsolePromptInput {
  // 運用者(または最初のプロンプトの回答)が考えたリプライ案。空文字の場合は、
  // issueに貼るテンプレートとして「ここに貼ってください」という案内に置き換わる。
  draftReply: string;
}

const DRAFT_PLACEHOLDER = "（ここに、投稿しようとしているリプライ文を貼ってください）";

// 自分(または最初のプロンプトの回答)が考えたリプライ案を、投稿前にもう一度
// Claude.aiのチャットでレビューしてもらうためのプロンプト。buildReplyConsolePromptと
// 同じ観点で、当たり障りのなさ・トーン・文字数などをチェックしてもらう。
export function buildReplyReviewPrompt(input: ReplyReviewPromptInput): string {
  const accountInfo = loadAccountInfoForPrompt();
  const draftSection = input.draftReply.trim().length > 0 ? input.draftReply.trim() : DRAFT_PLACEHOLDER;

  return `あなたはSNSリプライの品質チェック担当です。以下のリプライ案を、投稿する前に
チェックしてください。

# あなた(投稿主)のペルソナ

${accountInfo}

# リプライ対象の投稿

投稿者: @${input.authorUsername}

\`\`\`
${input.postText}
\`\`\`

# チェックするリプライ案

\`\`\`
${draftSection}
\`\`\`

# チェック項目

- 投稿の内容を実際に読んで反応していることが伝わるか(使い回しの相槌になっていないか)
- 心がこもっているか(共感・具体的な視点が含まれているか)
- 有益さ(読んだ人にとって何か気づき・視点があるか)
- 自然な会話のトーンか(ペルソナと合っているか。媚びすぎ・へりくだりすぎていないか)
- 宣伝・フォロー依頼など、返信の場にそぐわない内容が無いか
- 「絶対に」「100%」などの断定・攻撃的な表現が無いか
- 全角${input.charLimit}文字を超えていないか

# 出力

チェック結果を簡潔に述べたうえで、そのまま投稿できる最終版のリプライ文を1つ提示して
ください。問題が無ければ元の文をそのまま最終版としてください。`;
}
