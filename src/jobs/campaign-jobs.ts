import type { DatabaseSync } from "node:sqlite";
import { hashPostText, isAiConfigured, AiPostScorer } from "../analysis/ai-post-scorer.ts";
import type { AppConfig } from "../config.ts";
import { fetchCommentsForUrl, fetchPostsByUrl, scanHashtagPosts } from "../collectors/apify-collectors.ts";
import { fetchFanpageComments, fetchFanpagePosts, isFanpageConfigured } from "../collectors/fanpage-graph-collector.ts";
import { canonicalPostUrl } from "../collectors/normalize-apify-items.ts";
import {
  listPosts, listPostsNeedingComments, listStalePosts, markAiDeclined, markRefreshMiss, upsertComments,
  saveAiAssessment, upsertPost,
} from "../db/posts-repository.ts";
import type { CollectedPost, StoredPost } from "../domain-types.ts";
import { runWithConcurrency } from "./run-with-concurrency.ts";

/** Parallel Apify comment runs; each run handles one post. */
const COMMENT_CONCURRENCY = 5;

const failureNote = (r: { failed: number; firstError: string | null }): string =>
  r.failed ? ` (${r.failed} lỗi, ví dụ: ${r.firstError})` : "";

/** A post counts only if it was posted inside the campaign window (Vietnam time). */
export function isInCampaignWindow(post: Pick<CollectedPost, "postedAt">, config: AppConfig): boolean {
  if (!post.postedAt) return true;
  const start = new Date(`${config.CAMPAIGN_START}T00:00:00+07:00`).getTime();
  const end = new Date(`${config.CAMPAIGN_END}T23:59:59+07:00`).getTime();
  const posted = new Date(post.postedAt).getTime();
  return posted >= start && posted <= end;
}

/** Fanpage reads are free (Graph API), so they also serve as the metrics refresh for fanpage posts. */
async function syncFanpage(db: DatabaseSync, config: AppConfig): Promise<string> {
  const pagePosts = (await fetchFanpagePosts(config)).filter((p) => isInCampaignWindow(p, config));
  pagePosts.forEach((p) => upsertPost(db, p, "fanpage"));
  return `Fanpage: ${pagePosts.length} bài có hashtag`;
}

/** Finds new campaign posts via hashtag search (Apify) and the owned Fanpage (Graph API). */
export async function scanSources(db: DatabaseSync, config: AppConfig): Promise<string> {
  const notes: string[] = [];
  if (config.APIFY_TOKEN) {
    const found = await scanHashtagPosts(config);
    const inWindow = found.filter((p) => isInCampaignWindow(p, config));
    inWindow.forEach((p) => upsertPost(db, p, "hashtag"));
    notes.push(`Hashtag: ${found.length} bài, ${inWindow.length} bài trong thời gian chiến dịch`);
  } else {
    notes.push("Bỏ qua quét hashtag (chưa có APIFY_TOKEN)");
  }
  if (isFanpageConfigured(config)) notes.push(await syncFanpage(db, config));
  return notes.join(". ");
}

/** Re-reads metrics for posts the scan did not refresh recently (manual links, older posts, fanpage). */
export async function refreshStaleMetrics(db: DatabaseSync, config: AppConfig): Promise<string> {
  const notes: string[] = [];
  if (isFanpageConfigured(config)) notes.push(await syncFanpage(db, config));
  if (!config.APIFY_TOKEN) return [...notes, "Bỏ qua Apify (chưa có APIFY_TOKEN)"].join(". ");

  const staleBefore = new Date(Date.now() - config.REFRESH_INTERVAL_HOURS * 0.8 * 3_600_000).toISOString();
  const stale = listStalePosts(db, staleBefore).filter((p) => p.source !== "fanpage");
  if (stale.length === 0) return [...notes, "Không có bài cần làm mới"].join(". ");

  let updated = 0;
  let missed = 0;
  const byUrl = new Map(stale.map((p) => [p.url, p]));
  await fetchPostsByUrl(config, [...byUrl.keys()], (byInputUrl, requestedUrls) => {
    for (const url of requestedUrls) {
      const post = byUrl.get(url);
      if (!post) continue;
      const fresh = byInputUrl.get(canonicalPostUrl(url));
      if (fresh) {
        upsertPost(db, { ...fresh, url }, post.source, post.id);
        updated++;
      } else {
        // Deleted/private posts return nothing; count misses so they stop being billed.
        markRefreshMiss(db, post.id);
        missed++;
      }
    }
  });
  const missedNote = missed ? `, ${missed} bài không lấy được` : "";
  return [...notes, `Làm mới ${updated}/${stale.length} bài${missedNote}`].join(". ");
}

/** Downloads comments only for posts whose comment count grew since the last download. */
export async function refreshComments(db: DatabaseSync, config: AppConfig): Promise<string> {
  const targets = listPostsNeedingComments(db).filter((p) =>
    p.source === "fanpage" ? Boolean(p.fb_post_id) : Boolean(config.APIFY_TOKEN),
  );
  let saved = 0;
  let empty = 0;
  const fetchOne = (post: StoredPost) =>
    post.source === "fanpage" ? fetchFanpageComments(config, post.fb_post_id as string) : fetchCommentsForUrl(config, post.url);

  const result = await runWithConcurrency(targets, COMMENT_CONCURRENCY, async (post) => {
    const comments = await fetchOne(post);
    // An empty result for a post that has comments usually means a scraping hiccup:
    // leave it unmarked so the next run retries it.
    if (comments.length === 0) {
      empty++;
      return;
    }
    upsertComments(db, post.id, comments, post.comments);
    saved += comments.length;
  });
  const emptyNote = empty ? `, ${empty} bài chưa lấy được (sẽ thử lại)` : "";
  return `Tải bình luận cho ${targets.length} bài, ${saved} bình luận${emptyNote}${failureNote(result)}`;
}

/** Scores posts that are new or whose text changed since the last AI assessment. */
export async function scorePostsWithAi(db: DatabaseSync, config: AppConfig): Promise<string> {
  if (!isAiConfigured(config)) return "Bỏ qua (chưa có ANTHROPIC_API_KEY)";
  const scorer = new AiPostScorer(config);
  const pending = listPosts(db, { includeHidden: false }).filter(
    (p) => p.text && p.ai_scored_text_hash !== hashPostText(p.text),
  );
  let scored = 0;
  let declined = 0;
  const result = await runWithConcurrency(pending, 1, async (post) => {
    const textHash = hashPostText(post.text as string);
    const assessment = await scorer.assess(post);
    if (assessment) {
      saveAiAssessment(db, post.id, assessment, textHash);
      scored++;
    } else {
      // Remember the refusal so the same text is not re-billed every run.
      markAiDeclined(db, post.id, textHash);
      declined++;
    }
  });
  return `AI chấm ${scored} bài${declined ? `, ${declined} bài bị từ chối đánh giá` : ""}${failureNote(result)}`;
}
