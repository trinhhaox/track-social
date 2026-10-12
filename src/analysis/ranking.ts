import type { RankWeights } from "../config.ts";
import type { StoredPost } from "../domain-types.ts";

export interface RankedPost {
  post: StoredPost;
  engagement: number;
  score: number;
  rank: number;
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

/** Sorts by score, then engagement, then earliest post; ties share a rank (1, 2, 2, 4). */
export function rankPosts(posts: StoredPost[], weights: RankWeights): RankedPost[] {
  const scored = posts
    .map((post) => ({ post, engagement: engagementOf(post), score: scorePost(post, weights) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.engagement - a.engagement ||
        (a.post.posted_at ?? a.post.first_seen_at).localeCompare(b.post.posted_at ?? b.post.first_seen_at),
    );
  // A tied post takes the index of the first post in its tie group ("competition" ranking).
  const ranks = scored.map((_, index) => index + 1);
  scored.forEach((item, index) => {
    const prev = scored[index - 1];
    if (prev && prev.score === item.score && prev.engagement === item.engagement) ranks[index] = ranks[index - 1] as number;
  });
  return scored.map((item, index) => ({ ...item, rank: ranks[index] as number }));
}
