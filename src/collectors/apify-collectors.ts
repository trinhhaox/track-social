import type { AppConfig } from "../config.ts";
import type { CollectedComment, CollectedPost } from "../domain-types.ts";
import { runActor } from "./apify-client.ts";
import { canonicalPostUrl, normalizeComment, normalizePost } from "./normalize-apify-items.ts";

/** posts-scraper ignores resultsLimit for direct URLs, so batching URLs is safe cost-wise. */
const URL_BATCH_SIZE = 50;

function requireToken(config: AppConfig): string {
  if (!config.APIFY_TOKEN) throw new Error("Chưa cấu hình APIFY_TOKEN");
  return config.APIFY_TOKEN;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Searches Facebook for each campaign hashtag. */
export async function scanHashtagPosts(config: AppConfig): Promise<CollectedPost[]> {
  const items = await runActor(requireToken(config), config.APIFY_HASHTAG_ACTOR, {
    keywordList: config.CAMPAIGN_HASHTAGS,
    resultsLimit: config.HASHTAG_RESULTS_LIMIT,
  });
  return items.map(normalizePost).filter((p): p is CollectedPost => p !== null);
}

/**
 * Re-reads metrics for known post URLs. Each finished batch is handed to `onBatch`
 * (keyed by canonical input URL) right away, so a later failing batch does not
 * discard results that were already paid for.
 */
export async function fetchPostsByUrl(
  config: AppConfig,
  urls: string[],
  onBatch: (byInputUrl: Map<string, CollectedPost>) => void,
): Promise<void> {
  const token = requireToken(config);
  for (const batch of chunk(urls, URL_BATCH_SIZE)) {
    const items = await runActor(token, config.APIFY_POSTS_ACTOR, {
      startUrls: batch.map((url) => ({ url })),
      resultsLimit: 1,
    });
    const byInputUrl = new Map<string, CollectedPost>();
    for (const item of items) {
      const post = normalizePost(item);
      const inputUrl = (item as { inputUrl?: unknown }).inputUrl;
      if (post && typeof inputUrl === "string") byInputUrl.set(canonicalPostUrl(inputUrl), post);
    }
    onBatch(byInputUrl);
  }
}

/**
 * Downloads comments of a single post. One URL per run keeps `resultsLimit`
 * an exact per-post cap (the actor does not document whether it is per post or per run).
 */
export async function fetchCommentsForUrl(config: AppConfig, url: string): Promise<CollectedComment[]> {
  const items = await runActor(requireToken(config), config.APIFY_COMMENTS_ACTOR, {
    startUrls: [{ url }],
    resultsLimit: config.COMMENTS_PER_POST,
    includeNestedComments: false,
    viewOption: "RANKED_UNFILTERED",
  });
  return items.flatMap((item) => {
    const comment = normalizeComment(item);
    if (!comment) return [];
    const { postUrl: _postUrl, ...rest } = comment;
    return [rest];
  });
}
