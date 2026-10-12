import { z } from "zod";

/** Parses "reaction=1,comment=2,share=3,ai=0" into ranking weights. */
const weightsSchema = z
  .string()
  .default("reaction=1,comment=2,share=3,ai=0")
  .transform((raw, ctx) => {
    const weights = { reaction: 0, comment: 0, share: 0, ai: 0 };
    for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [key, value] = pair.split("=").map((s) => s.trim());
      const num = Number(value);
      if (!key || !(key in weights) || !Number.isFinite(num)) {
        ctx.addIssue({ code: "custom", message: `RANK_WEIGHTS không hợp lệ: "${pair}"` });
        return z.NEVER;
      }
      weights[key as keyof typeof weights] = num;
    }
    return weights;
  });

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  /** 0.0.0.0 so Docker port publishing works; set 127.0.0.1 to restrict to the host. */
  HOST: z.string().default("0.0.0.0"),
  DATABASE_PATH: z.string().default("./data/campaign.db"),
  PUBLIC_BASE_URL: optionalString,

  CAMPAIGN_NAME: z.string().default("Chiến dịch hashtag"),
  // In .env files an unquoted "#" starts a comment, so tags are written without "#".
  CAMPAIGN_HASHTAGS: z
    .string({ error: 'CAMPAIGN_HASHTAGS là bắt buộc, ví dụ: trigxanh,songxanh (không có "#", hoặc đặt trong ngoặc kép)' })
    .transform((raw) =>
      raw
        .split(",")
        .map((h) => h.trim().replace(/^#/, ""))
        .filter(Boolean),
    )
    .refine((tags) => tags.length > 0, {
      message: 'CAMPAIGN_HASHTAGS rỗng — trong .env hãy viết trigxanh (không có "#") hoặc "#trigxanh" trong ngoặc kép',
    }),
  CAMPAIGN_START: z.iso.date(),
  CAMPAIGN_END: z.iso.date(),

  ADMIN_USER: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD tối thiểu 8 ký tự"),

  APIFY_TOKEN: optionalString,
  APIFY_HASHTAG_ACTOR: z.string().default("apify~facebook-hashtag-scraper"),
  APIFY_POSTS_ACTOR: z.string().default("apify~facebook-posts-scraper"),
  APIFY_COMMENTS_ACTOR: z.string().default("apify~facebook-comments-scraper"),
  HASHTAG_RESULTS_LIMIT: z.coerce.number().int().positive().default(300),
  COMMENTS_PER_POST: z.coerce.number().int().positive().default(300),

  FB_PAGE_ID: optionalString,
  FB_PAGE_TOKEN: optionalString,
  FB_GRAPH_VERSION: z.string().default("v23.0"),

  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_RUBRIC: z
    .string()
    .default(
      "Đúng chủ đề chiến dịch; nội dung chân thực, có trải nghiệm cá nhân; sáng tạo; trình bày rõ ràng; có hình ảnh/video tự làm.",
    ),

  RANK_WEIGHTS: weightsSchema,
  LEADERBOARD_SIZE: z.coerce.number().int().positive().default(50),

  SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // setInterval overflows past ~24.8 days (2^31 ms) and would fire every 1 ms.
  SCAN_INTERVAL_HOURS: z.coerce.number().min(1).max(596).default(24),
  REFRESH_INTERVAL_HOURS: z.coerce.number().min(1).max(596).default(24),
  /** Keep refreshing metrics this many days after CAMPAIGN_END. */
  REFRESH_GRACE_DAYS: z.coerce.number().int().nonnegative().default(7),
});

export type AppConfig = z.infer<typeof envSchema>;
export type RankWeights = AppConfig["RANK_WEIGHTS"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Cấu hình .env không hợp lệ:\n${issues}`);
  }
  if (parsed.data.CAMPAIGN_END < parsed.data.CAMPAIGN_START) {
    throw new Error("CAMPAIGN_END phải sau hoặc bằng CAMPAIGN_START");
  }
  return parsed.data;
}
