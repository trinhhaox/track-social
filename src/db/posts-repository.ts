import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { AiAssessment, CollectedComment, CollectedPost, PostSource, StoredPost } from "../domain-types.ts";
import { inTransaction } from "./database.ts";

const nowIso = (): string => new Date().toISOString();

/** After this many empty refreshes in a row a post is treated as gone (deleted/private) and no longer billed. */
export const MAX_REFRESH_MISSES = 3;

/**
 * Apify comment downloads are billed per comment, so a post is re-downloaded only after its
 * comment count grew by this fraction (or by at least 1 for small posts). Fanpage reads are free.
 */
const COMMENT_REFETCH_GROWTH = 0.2;

function getById(db: DatabaseSync, id: number): StoredPost | undefined {
  return db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as unknown as StoredPost | undefined;
}

function findExisting(db: DatabaseSync, post: CollectedPost, knownId?: number): StoredPost | undefined {
  if (post.fbPostId) {
    const byId = db.prepare("SELECT * FROM posts WHERE fb_post_id = ?").get(post.fbPostId);
    if (byId) return byId as unknown as StoredPost;
  }
  if (knownId !== undefined) return getById(db, knownId);
  return db.prepare("SELECT * FROM posts WHERE url = ?").get(post.url) as unknown as StoredPost | undefined;
}

/**
 * Inserts a new post or refreshes an existing one (matched by FB post id, then `knownId`, then URL),
 * and records a metric snapshot. Returns the stored row id.
 *
 * When `knownId` is a manually added link (no FB id yet) of a post another row already
 * holds, the manual row is merged into that row (its hidden flag carries over) and deleted.
 * Any other id conflict — e.g. a dead URL the scraper resolved to a different post — is
 * left untouched rather than risk deleting a real post.
 */
export function upsertPost(db: DatabaseSync, post: CollectedPost, source: PostSource, knownId?: number): number {
  return inTransaction(db, () => {
    const now = nowIso();
    const existing = findExisting(db, post, knownId);
    if (existing && knownId !== undefined && existing.id !== knownId) {
      const known = getById(db, knownId);
      if (!known || known.source !== "manual" || known.fb_post_id !== null) {
        // Mark as checked so the ambiguous row is not re-scraped (and re-billed) every run.
        db.prepare("UPDATE posts SET metrics_updated_at = ? WHERE id = ?").run(now, knownId);
        return knownId;
      }
      if (known.hidden) db.prepare("UPDATE posts SET hidden = 1 WHERE id = ?").run(existing.id);
      db.prepare("DELETE FROM posts WHERE id = ?").run(knownId);
    }
    let id: number;
    if (existing) {
      id = existing.id;
      db.prepare(
        `UPDATE posts SET
           fb_post_id = COALESCE(fb_post_id, ?), author_id = COALESCE(?, author_id),
           author_name = COALESCE(?, author_name), author_url = COALESCE(?, author_url),
           text = COALESCE(?, text), posted_at = COALESCE(?, posted_at),
           -- Monotonic on purpose: rounded "1,2K" scan values and transient zeros must not lower
           -- exact counts. Trade-off: genuine drops (removed fake likes) are never reflected.
           reactions = MAX(reactions, ?), comments = MAX(comments, ?), shares = MAX(shares, ?),
           metrics_updated_at = ?, refresh_misses = 0,
           -- A post the Fanpage also returns is refreshed for free via Graph API from now on.
           source = CASE WHEN ? = 'fanpage' THEN 'fanpage' ELSE source END
         WHERE id = ?`,
      ).run(
        post.fbPostId, post.authorId, post.authorName, post.authorUrl, post.text, post.postedAt,
        post.reactions, post.comments, post.shares, now, source, id,
      );
    } else {
      const result = db.prepare(
        `INSERT INTO posts (fb_post_id, url, source, author_id, author_name, author_url, text, posted_at,
           reactions, comments, shares, first_seen_at, metrics_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        post.fbPostId, post.url, source, post.authorId, post.authorName, post.authorUrl, post.text,
        post.postedAt, post.reactions, post.comments, post.shares, now, now,
      );
      id = Number(result.lastInsertRowid);
    }
    // Snapshot the stored (monotonic) values so a scraper returning 0 never draws a false drop.
    db.prepare(
      `INSERT INTO metric_snapshots (post_id, captured_at, reactions, comments, shares)
       SELECT id, ?, reactions, comments, shares FROM posts WHERE id = ?`,
    ).run(now, id);
    return id;
  });
}

/** Adds a bare URL submitted by an admin; metrics arrive on the next refresh. */
export function addManualPost(db: DatabaseSync, url: string): { id: number; created: boolean } {
  const existing = db.prepare("SELECT id FROM posts WHERE url = ?").get(url) as { id: number } | undefined;
  if (existing) return { id: existing.id, created: false };
  const result = db.prepare(
    "INSERT INTO posts (url, source, first_seen_at) VALUES (?, 'manual', ?)",
  ).run(url, nowIso());
  return { id: Number(result.lastInsertRowid), created: true };
}

/** Adds newly downloaded comments (comments no longer on Facebook are kept) and records the count fetched. */
export function upsertComments(db: DatabaseSync, postId: number, comments: CollectedComment[], fetchedCount: number): void {
  inTransaction(db, () => {
    const insert = db.prepare(
      `INSERT INTO comments (comment_id, post_id, profile_key, profile_name, profile_url, text, commented_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(comment_id) DO UPDATE SET text = excluded.text`,
    );
    for (const c of comments) {
      insert.run(c.commentId, postId, c.profileKey, c.profileName, c.profileUrl, c.text, c.commentedAt);
    }
    db.prepare("UPDATE posts SET comments_fetched_count = ? WHERE id = ?").run(fetchedCount, postId);
  });
}

export function saveAiAssessment(db: DatabaseSync, postId: number, ai: AiAssessment, textHash: string): void {
  db.prepare(
    `UPDATE posts SET ai_summary = ?, ai_topic = ?, ai_sentiment = ?, ai_on_topic = ?, ai_score = ?,
       ai_reason = ?, ai_scored_text_hash = ? WHERE id = ?`,
  ).run(ai.summary, ai.topic, ai.sentiment, ai.onTopic ? 1 : 0, ai.score, ai.reason, textHash, postId);
}

/** Records that Claude declined this exact text, so it is not re-submitted every run. */
export function markAiDeclined(db: DatabaseSync, postId: number, textHash: string): void {
  db.prepare(
    `UPDATE posts SET ai_summary = NULL, ai_topic = NULL, ai_sentiment = NULL, ai_on_topic = NULL, ai_score = NULL,
       ai_reason = 'AI từ chối đánh giá bài này — cần giám khảo xem thủ công', ai_scored_text_hash = ? WHERE id = ?`,
  ).run(textHash, postId);
}

export function setHidden(db: DatabaseSync, postId: number, hidden: boolean): void {
  db.prepare("UPDATE posts SET hidden = ? WHERE id = ?").run(hidden ? 1 : 0, postId);
}

export function listPosts(db: DatabaseSync, opts: { includeHidden: boolean }): StoredPost[] {
  const where = opts.includeHidden ? "" : "WHERE hidden = 0";
  return db.prepare(`SELECT * FROM posts ${where} ORDER BY id`).all() as unknown as StoredPost[];
}

/** Posts whose metrics are older than `olderThanIso` (or never fetched), skipping posts that look gone. */
export function listStalePosts(db: DatabaseSync, olderThanIso: string): StoredPost[] {
  return db.prepare(
    `SELECT * FROM posts WHERE hidden = 0 AND refresh_misses < ?
       AND (metrics_updated_at IS NULL OR metrics_updated_at < ?) ORDER BY id`,
  ).all(MAX_REFRESH_MISSES, olderThanIso) as unknown as StoredPost[];
}

/** Records a refresh that returned nothing for this post. */
export function markRefreshMiss(db: DatabaseSync, postId: number): void {
  db.prepare("UPDATE posts SET refresh_misses = refresh_misses + 1 WHERE id = ?").run(postId);
}

/** Posts whose comment count grew enough since their comments were last downloaded. */
export function listPostsNeedingComments(db: DatabaseSync): StoredPost[] {
  return db.prepare(
    `SELECT * FROM posts WHERE hidden = 0 AND comments > 0 AND comments > comments_fetched_count
       AND (source = 'fanpage' OR comments - comments_fetched_count >= MAX(1, comments_fetched_count * ?))
     ORDER BY id`,
  ).all(COMMENT_REFETCH_GROWTH) as unknown as StoredPost[];
}

export function queryAll<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}
