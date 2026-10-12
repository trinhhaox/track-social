import type { AppConfig, RankWeights } from "../config.ts";
import type { StoredPost } from "../domain-types.ts";

export interface RankedPost {
  post: StoredPost;
  engagement: number;
  score: number;
  rank: number;
}

/** Whether a post competes on the public leaderboard: not hidden, and not AI-flagged off-topic when that rule is on. */
export function isRankable(post: StoredPost, config: Pick<AppConfig, "AI_EXCLUDE_OFF_TOPIC">): boolean {
  return !post.hidden && !(config.AI_EXCLUDE_OFF_TOPIC && post.ai_on_topic === 0);
}

export function engagementOf(post: Pick<StoredPost, "reactions" | "comments" | "shares">): number {
  return post.reactions + post.comments + post.shares;
}

/** Weighted score; AI score (0–10) contributes only when the post has been scored. */
export function scorePost(post: StoredPost, weights: RankWeights): number {
  const raw =
    weights.reaction * post.reactions +
    weights.comment * post.comments +
    weights.share * post.shares +
    weights.ai * (post.ai_score ?? 0);
  return Math.round(raw * 100) / 100;
}

/** Identity of a post's author: profile id, then profile URL, then name; unknown authors count as distinct. */
export const authorKey = (p: StoredPost): string => p.author_id ?? p.author_url ?? p.author_name ?? `post:${p.id}`;

type Scored = Omit<RankedPost, "rank">;

const scoreAll = (posts: StoredPost[], weights: RankWeights): Scored[] =>
  posts.map((post) => ({ post, engagement: engagementOf(post), score: scorePost(post, weights) }));

/** Leaderboard order: score, then engagement, then earliest post. */
const byStanding = (a: Scored, b: Scored): number =>
  b.score - a.score ||
  b.engagement - a.engagement ||
  (a.post.posted_at ?? a.post.first_seen_at).localeCompare(b.post.posted_at ?? b.post.first_seen_at);

/** Campaign rule: each author holds one leaderboard spot, taken by their best post. */
export function bestPostPerAuthor(posts: StoredPost[], weights: RankWeights): StoredPost[] {
  const best = new Map<string, Scored>();
  for (const item of scoreAll(posts, weights)) {
    const key = authorKey(item.post);
    const current = best.get(key);
    if (!current || byStanding(item, current) < 0) best.set(key, item);
  }
  return [...best.values()].map((item) => item.post);
}

/** Sorts by standing; ties (same score and engagement) share a rank (1, 2, 2, 4). */
export function rankPosts(posts: StoredPost[], weights: RankWeights): RankedPost[] {
  const scored = scoreAll(posts, weights).sort(byStanding);
  // A tied post takes the index of the first post in its tie group ("competition" ranking).
  const ranks = scored.map((_, index) => index + 1);
  scored.forEach((item, index) => {
    const prev = scored[index - 1];
    if (prev && prev.score === item.score && prev.engagement === item.engagement) ranks[index] = ranks[index - 1] as number;
  });
  return scored.map((item, index) => ({ ...item, rank: ranks[index] as number }));
}
