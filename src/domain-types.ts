/** Shapes shared by collectors, repositories and views. */

export type PostSource = "hashtag" | "fanpage" | "manual";

/** A post as produced by any collector, before it is stored. */
export interface CollectedPost {
  fbPostId: string | null;
  url: string;
  authorId: string | null;
  authorName: string | null;
  authorUrl: string | null;
  text: string | null;
  postedAt: string | null;
  reactions: number;
  comments: number;
  shares: number;
}

export interface CollectedComment {
  commentId: string;
  /** Stable identity used to count unique commenters across posts. */
  profileKey: string;
  profileName: string | null;
  profileUrl: string | null;
  text: string | null;
  commentedAt: string | null;
}

export interface StoredPost {
  id: number;
  fb_post_id: string | null;
  url: string;
  source: PostSource;
  author_id: string | null;
  author_name: string | null;
  author_url: string | null;
  text: string | null;
  posted_at: string | null;
  reactions: number;
  comments: number;
  shares: number;
  comments_fetched_count: number;
  /** Consecutive refreshes in which the scraper returned nothing for this post. */
  refresh_misses: number;
  hidden: number;
  ai_summary: string | null;
  ai_topic: string | null;
  ai_sentiment: string | null;
  ai_on_topic: number | null;
  ai_score: number | null;
  ai_reason: string | null;
  ai_scored_text_hash: string | null;
  first_seen_at: string;
  metrics_updated_at: string | null;
}

export interface AiAssessment {
  summary: string;
  topic: string;
  sentiment: "positive" | "neutral" | "negative";
  onTopic: boolean;
  score: number;
  reason: string;
}
