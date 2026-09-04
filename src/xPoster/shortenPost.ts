import { callClaude } from "./claudeClient";
import { getWeightedLength } from "./tweetLength";

// 生成→セルフチェックのリトライを重ねても文字数超過が解消しない場合の最終手段。
// 意味・トーンを保ったまま短くするだけの単発の指示を別途投げる
// (amazon-sentaku-shiageのshortenText.tsを流用)。
// 現在の文字数を明示することで、どの程度削ればよいかをモデルに掴ませ、
// 複数回呼んでも収束しやすくする。
//
// 同じ指示を機械的に繰り返すだけだと、毎回わずかな語尾調整程度しか削れず
// 頭打ちになる(生成をゼロからやり直すだけの旧実装では、392字→392字前後で
// 頭打ちになり収束しないことを実運用で確認済み)。attemptが進むほど目標文字数を
// 引き下げつつ、指示自体もより具体的・強めにする。
export async function shortenPost(model: string, text: string, charLimit: number, attempt = 1): Promise<string> {
  const currentLength = getWeightedLength(text);
  const over = currentLength - charLimit;
  const targetRatio = Math.max(0.6, 0.8 - (attempt - 1) * 0.1);
  const targetChars = Math.round(charLimit * targetRatio);

  const instruction =
    attempt === 1
      ? "思い切って文章量そのものを削ってください(語尾を整えるだけでは不十分です)。"
      : `前回までの短縮では削減が不十分でした(まだ上限を${over}文字超えています)。語尾の調整だけでなく、一文まるごと削る・具体的な描写や修飾語を思い切って省くなど、より大胆に削ってください。`;

  const prompt = [
    `以下のSNS投稿文は現在${currentLength}文字相当あり、上限の${charLimit}文字を超えています(${over}文字オーバー)。`,
    `全角${targetChars}文字程度になるまで、${instruction}`,
    "意味・トーンは保ちつつ、冒頭の引っかかりや問いかけなど投稿の要点は残してください。",
    "",
    "投稿本文のみを出力してください。説明や前置きは不要です。",
    "",
    "---",
    text,
  ].join("\n");

  const result = await callClaude(model, prompt);
  return result.trim();
}
