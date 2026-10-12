import type { DatabaseSync } from "node:sqlite";
import { queryAll } from "../db/posts-repository.ts";
import type { StoredPost } from "../domain-types.ts";
import { authorKey, engagementOf } from "./ranking.ts";

export interface DailyPoint {
  day: string;
  newPosts: number;
  totalEngagement: number;
}

export interface AuthorStat {
  key: string;
  name: string;
  url: string | null;
  posts: number;
  engagement: number;
}

export interface CampaignStats {
  totalPosts: number;
  totalAuthors: number;
  totalReactions: number;
  totalComments: number;
  totalShares: number;
  uniqueCommenters: number;
  aiScored: number;
  sentiment: Record<string, number>;
  topics: Array<{ topic: string; count: number }>;
  daily: DailyPoint[];
  topAuthors: AuthorStat[];
}

const TIMEZONE = "Asia/Ho_Chi_Minh";
const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
/** Calendar day (YYYY-MM-DD) in Vietnam time. */
export const toLocalDay = (iso: string): string => dayFormatter.format(new Date(iso));


/** Every calendar day from the earliest to the latest given day, so charts have no gaps. */
export function contiguousDays(days: string[]): string[] {
  const sorted = [...new Set(days)].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [];
  const out: string[] = [];
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Daily new posts and cumulative engagement, carrying each post's latest snapshot forward. */
function buildDailySeries(db: DatabaseSync, posts: StoredPost[]): DailyPoint[] {
  const visible = new Set(posts.map((p) => p.id));
  const snapshots = queryAll<{ post_id: number; captured_at: string; reactions: number; comments: number; shares: number }>(
    db,
    "SELECT post_id, captured_at, reactions, comments, shares FROM metric_snapshots ORDER BY captured_at",
  ).filter((s) => visible.has(s.post_id));

  const newPostsByDay = new Map<string, number>();
  for (const p of posts) {
    const day = toLocalDay(p.posted_at ?? p.first_seen_at);
    newPostsByDay.set(day, (newPostsByDay.get(day) ?? 0) + 1);
  }

  const days = contiguousDays([...newPostsByDay.keys(), ...snapshots.map((s) => toLocalDay(s.captured_at))]);
  const latestByPost = new Map<number, number>();
  let cursor = 0;
  return days.map((day) => {
    while (cursor < snapshots.length && toLocalDay((snapshots[cursor] as { captured_at: string }).captured_at) <= day) {
      const s = snapshots[cursor] as (typeof snapshots)[number];
      latestByPost.set(s.post_id, engagementOf(s));
      cursor++;
    }
    const totalEngagement = [...latestByPost.values()].reduce((a, b) => a + b, 0);
    return { day, newPosts: newPostsByDay.get(day) ?? 0, totalEngagement };
  });
}

function buildTopAuthors(posts: StoredPost[], limit: number): AuthorStat[] {
  const byAuthor = new Map<string, AuthorStat>();
  for (const p of posts) {
    const key = authorKey(p);
    const prev = byAuthor.get(key);
    byAuthor.set(key, {
      key,
      name: p.author_name ?? prev?.name ?? "(chưa rõ)",
      url: p.author_url ?? prev?.url ?? null,
      posts: (prev?.posts ?? 0) + 1,
      engagement: (prev?.engagement ?? 0) + engagementOf(p),
    });
  }
  return [...byAuthor.values()].sort((a, b) => b.engagement - a.engagement || b.posts - a.posts).slice(0, limit);
}

export function computeCampaignStats(db: DatabaseSync, posts: StoredPost[]): CampaignStats {
  const ids = posts.map((p) => p.id);
  const uniqueCommenters = ids.length
    ? (queryAll<{ n: number }>(
        db,
        `SELECT COUNT(DISTINCT profile_key) AS n FROM comments WHERE post_id IN (${ids.map(() => "?").join(",")})`,
        ...ids,
      )[0]?.n ?? 0)
    : 0;

  const sentiment: Record<string, number> = {};
  const topicCounts = new Map<string, number>();
  for (const p of posts) {
    if (p.ai_sentiment) sentiment[p.ai_sentiment] = (sentiment[p.ai_sentiment] ?? 0) + 1;
    if (p.ai_topic) topicCounts.set(p.ai_topic, (topicCounts.get(p.ai_topic) ?? 0) + 1);
  }

  return {
    totalPosts: posts.length,
    totalAuthors: new Set(posts.map(authorKey)).size,
    totalReactions: posts.reduce((a, p) => a + p.reactions, 0),
    totalComments: posts.reduce((a, p) => a + p.comments, 0),
    totalShares: posts.reduce((a, p) => a + p.shares, 0),
    uniqueCommenters,
    aiScored: posts.filter((p) => p.ai_score !== null).length,
    sentiment,
    topics: [...topicCounts.entries()].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    daily: buildDailySeries(db, posts),
    topAuthors: buildTopAuthors(posts, 10),
  };
}
