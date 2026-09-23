import { loadPromptTemplate, loadConfigDoc, renderPrompt } from "./promptLoader";
import { callClaude } from "./claudeClient";
import { buildFeedbackHint } from "./feedbackHint";
import { buildVarietyHint } from "./varietyHint";
import { loadReaderPersonas } from "./bookmarkReview";

export const SAVE_WORTHY_POST_KIND = "save_worthy";

export interface SaveWorthyType {
  label: string;
  instruction: string;
}

// 保存(ブックマーク)される投稿の型。毎回同じ型に偏らないよう、生成のたびにランダムに1つ選ぶ。
export const SAVE_WORTHY_TYPES: readonly SaveWorthyType[] = [
  {
    label: "置き換え行動型",
    instruction:
      "元恋人のSNSを見たくなった夜、連絡したくなった瞬間など、執着・未練からくる衝動が来た場面を1つ取り上げ、" +
      "その場でできる「代わりにやること」を2〜4個、箇条書き(・)で具体的に示してください。" +
      "禁止や我慢ではなく、衝動を一度やり過ごすための小さな行動にしてください。最後に、なぜそれが効くのかを一言添えてください。",
  },
  {
    label: "チェックリスト型",
    instruction:
      "「手放しが進んでいるサイン」「まだ執着が残っているサイン」など、読者が自分に当てはめて確認できる" +
      "チェック項目を3〜4個、□を使った箇条書きで示してください。項目は日常の具体的な行動や感覚にしてください。" +
      "最後に、当てはまった数の受け止め方を、読者を責めない一言で添えてください。",
  },
  {
    label: "お守りの言葉型",
    instruction:
      "失恋直後で自分を責めがちな読者が、辛い夜に開き直せる「お守り」になる言葉を書いてください。" +
      "問いかけで終わらせず、読者を少し楽にする考え方を言い切ってください。" +
      "未練や執着を「なくすべきもの」として否定せず、今夜からできる小さな一歩を1つだけ添えてください。",
  },
];

export function pickSaveWorthyType(random: () => number = Math.random): SaveWorthyType {
  const index = Math.min(Math.floor(random() * SAVE_WORTHY_TYPES.length), SAVE_WORTHY_TYPES.length - 1);
  return SAVE_WORTHY_TYPES[index];
}

export interface GenerateSaveWorthyPostInput {
  saveType: SaveWorthyType;
  charLimit: number;
  recentFeedbackWindow: number;
  recentPostsForVarietyWindow: number;
}

// 記事に紐づかない、保存(ブックマーク)されることを狙った1ツイートの投稿を生成する。
// 持ち帰れる中身そのものが保存の理由になるため、スレッドに分けず1件目で完結させる。
export async function generateSaveWorthyPost(model: string, input: GenerateSaveWorthyPostInput): Promise<string> {
  const template = loadPromptTemplate("X投稿生成_保存型.md");
  // xCharLimitはX上の重み付き文字数(全角は2)のため、全角換算ではその半分になる。
  const zenkakuLimit = Math.floor(input.charLimit / 2);
  const targetChars = Math.round(zenkakuLimit * 0.8);

  const feedbackHint = await buildFeedbackHint(input.recentFeedbackWindow);
  const varietyHint = await buildVarietyHint({ postKind: SAVE_WORTHY_POST_KIND }, input.recentPostsForVarietyWindow);

  const prompt = renderPrompt(template, {
    account_info: loadConfigDoc("x_account_info.md"),
    reader_personas: loadReaderPersonas(),
    save_type_label: input.saveType.label,
    save_type_instruction: input.saveType.instruction,
    feedback_hint: feedbackHint ?? "(まだ指摘はありません)",
    variety_hint: varietyHint ?? "(まだ過去の保存型投稿はありません)",
    char_limit_note:
      `全角${targetChars}文字程度を目標にし、絶対に全角${zenkakuLimit}文字を超えないでください` +
      "(改行も1文字として数えます)。",
  });

  const text = await callClaude(model, prompt);
  return text.trim();
}
