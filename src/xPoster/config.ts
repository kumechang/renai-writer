import { readFileSync } from "node:fs";
import path from "node:path";

export interface XPosterConfig {
  // manual: GitHub issueでの人による承認後にXへ投稿する / auto: セルフチェック合格時に即時投稿する
  approvalMode: "manual" | "auto";
  claudeModel: string;
  xCharLimit: number;
  selfCheckPassThreshold: number;
  // 文字数超過時、生成+セルフチェックをやり直す最大回数
  maxGenerateRetries: number;

  // 1日あたりの目標投稿数。generate-postsは投稿可能時間帯の間毎時起動するが、
  // 実際に生成するかはshouldGenerateNowがこの目標値をもとに確率的に判断する
  // (amazon-sentaku-shiageと同じ設計)。
  targetPostsPerDay: number;
  // ターゲット読者が投稿を見ていて不自然でない時間帯(JST)。この範囲内でのみ生成を試みる。
  postingWindow: {
    startHour: number;
    endHour: number;
  };
  // 直近の投稿候補作成からこの時間(h)未満なら、次の生成をスキップする(連投防止)。
  minSpacingHours: number;
  // 一度Xで宣伝した記事を再び宣伝候補に戻すまでの日数。書き下ろし記事だけでは
  // targetPostsPerDayを満たせない場合に、この日数以上前に宣伝した記事を再利用する。
  repromotionCooldownDays: number;
  // 直近の却下・事後フィードバックのうち、次回生成時のヒントとして渡す件数。
  recentFeedbackWindow: number;
  // 記事に紐づかない「単発投稿」(恋愛系の一般的な投稿)を選ぶ確率(0〜1)。
  // 記事の宣伝だけに偏らないようにするための比率。単発投稿はリンクを含まず、
  // インプレッションが伸びる傾向が観察されているため、フォロワーがまだ少ない現段階では
  // 高めに設定している(既定0.5)。宣伝可能な記事が1件もない場合は、この確率に関わらず
  // 単発投稿にフォールバックする。
  standalonePostRatio: number;
  // 同じ記事から作った過去の投稿・過去の単発投稿を、切り口の重複チェック用に
  // 何件までプロンプトに渡すか。
  recentPostsForVarietyWindow: number;
  // 記事URL付き投稿(2ツイート構成のスレッド)を1日に何件まで許可するか。
  // 公開中の記事が複数あっても、この件数を超えて生成しない。
  urlPostsPerDay: number;
  // 投稿生成時に「直近よく使われている言葉」ヒントとして渡す、トレンドワードの件数
  // (src/xPoster/trendWords.ts、npm run x-post:collect-trendsが収集したもの)。
  trendWordsLimit: number;
  // 公開済み記事の「制作裏話」(なぜこのテーマ/タイトル/構成にしたか)投稿を選ぶ確率(0〜1)。
  // 記事URL付きスレッドと同様、自動選択の際に毎回この確率で試み、対象(まだ3トピックを
  // 出し尽くしていない公開済み記事)が無ければ通常フローにフォールバックする。
  behindTheScenesPostRatio: number;
  // 読者に保存(ブックマーク)されることを狙った「保存型」投稿(記事に紐づかない1ツイート)を
  // 選ぶ確率(0〜1)。共感系の投稿はいいねは付いても保存・フォローに結びつきにくかったため、
  // 持ち帰れる中身のある投稿を一定の割合で混ぜる。
  saveWorthyPostRatio: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-poster.json");

let cached: XPosterConfig | undefined;

// config/x-poster.json を読み込む。プロセス内で使い回すため一度読んだらキャッシュする。
export function loadXPosterConfig(): XPosterConfig {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as XPosterConfig;
  return cached;
}
