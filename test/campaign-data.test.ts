import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCampaignStats, contiguousDays } from "../src/analysis/campaign-stats.ts";
import { rankPosts, scorePost } from "../src/analysis/ranking.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/database.ts";
import {
  addManualPost, listPosts, listPostsNeedingComments, markAiDeclined, replaceComments, setHidden, upsertPost,
} from "../src/db/posts-repository.ts";
import { runWithConcurrency } from "../src/jobs/run-with-concurrency.ts";
import type { CollectedPost, StoredPost } from "../src/domain-types.ts";
import { isInCampaignWindow } from "../src/jobs/campaign-jobs.ts";
import { jobsDueAt } from "../src/jobs/scheduler.ts";
import { buildPostsCsv, csvCell } from "../src/web/csv-export.ts";

const baseEnv = {
  CAMPAIGN_HASHTAGS: "#trigxanh", CAMPAIGN_START: "2026-10-01", CAMPAIGN_END: "2026-10-31",
  ADMIN_USER: "admin", ADMIN_PASSWORD: "supersecret",
};
const config = loadConfig(baseEnv);

const post = (over: Partial<CollectedPost> = {}): CollectedPost => ({
  fbPostId: "1", url: "https://www.facebook.com/a/posts/1", authorId: "u1", authorName: "An", authorUrl: null,
  text: "#trigxanh", postedAt: "2026-10-05T03:00:00.000Z", reactions: 10, comments: 2, shares: 1, ...over,
});

describe("config", () => {
  it("parses hashtags and weights", () => {
    assert.deepEqual(config.CAMPAIGN_HASHTAGS, ["trigxanh"]);
    assert.deepEqual(config.RANK_WEIGHTS, { reaction: 1, comment: 2, share: 3, ai: 0 });
  });
  it("rejects bad weights and inverted dates", () => {
    assert.throws(() => loadConfig({ ...baseEnv, RANK_WEIGHTS: "likes=1" }), /RANK_WEIGHTS/);
    assert.throws(() => loadConfig({ ...baseEnv, CAMPAIGN_END: "2026-09-01" }), /CAMPAIGN_END/);
    assert.throws(() => loadConfig({ ...baseEnv, ADMIN_PASSWORD: "short" }), /ADMIN_PASSWORD/);
    // dotenv drops everything after an unquoted "#", leaving an empty value.
    assert.throws(() => loadConfig({ ...baseEnv, CAMPAIGN_HASHTAGS: "" }), /CAMPAIGN_HASHTAGS rỗng/);
  });
});

describe("posts repository", () => {
  it("upserts by fb id and keeps snapshots", () => {
    const db = openDatabase(":memory:");
    const id = upsertPost(db, post(), "hashtag");
    assert.equal(upsertPost(db, post({ reactions: 15 }), "hashtag"), id);
    const [stored] = listPosts(db, { includeHidden: true });
    assert.equal(stored?.reactions, 15);
    const snapshots = db.prepare("SELECT COUNT(*) AS n FROM metric_snapshots").get() as { n: number };
    assert.equal(snapshots.n, 2);
  });

  it("merges a manual link into the post the scan already found", () => {
    const db = openDatabase(":memory:");
    const scannedId = upsertPost(db, post(), "hashtag");
    const { id: manualId, created } = addManualPost(db, "https://www.facebook.com/share/p/xyz");
    assert.ok(created);
    assert.equal(addManualPost(db, "https://www.facebook.com/share/p/xyz").created, false);
    const resultId = upsertPost(db, post({ url: "https://www.facebook.com/share/p/xyz", reactions: 20 }), "manual", manualId);
    assert.equal(resultId, scannedId);
    assert.equal(listPosts(db, { includeHidden: true }).length, 1);
  });

  it("never deletes a real post when a refresh resolves to another post's id", () => {
    const db = openDatabase(":memory:");
    upsertPost(db, post(), "hashtag");
    const otherId = upsertPost(db, post({ fbPostId: "2", url: "https://www.facebook.com/b/posts/2" }), "hashtag");
    // Scraper answers the URL of post 2 with data of post 1 (dead/redirected link).
    assert.equal(upsertPost(db, post({ url: "https://www.facebook.com/b/posts/2" }), "hashtag", otherId), otherId);
    assert.equal(listPosts(db, { includeHidden: true }).length, 2);
  });

  it("carries the hidden flag over when merging a manual duplicate", () => {
    const db = openDatabase(":memory:");
    const scannedId = upsertPost(db, post(), "hashtag");
    const { id: manualId } = addManualPost(db, "https://www.facebook.com/share/p/abc");
    setHidden(db, manualId, true);
    upsertPost(db, post({ url: "https://www.facebook.com/share/p/abc" }), "manual", manualId);
    assert.equal(listPosts(db, { includeHidden: true }).find((p) => p.id === scannedId)?.hidden, 1);
  });

  it("snapshots stored values, not a scraper's transient zero", () => {
    const db = openDatabase(":memory:");
    upsertPost(db, post({ reactions: 10 }), "hashtag");
    upsertPost(db, post({ reactions: 0 }), "hashtag");
    const rows = db.prepare("SELECT reactions FROM metric_snapshots ORDER BY rowid").all() as Array<{ reactions: number }>;
    assert.deepEqual(rows.map((r) => r.reactions), [10, 10]);
  });

  it("remembers AI refusals for the same text", () => {
    const db = openDatabase(":memory:");
    const id = upsertPost(db, post(), "hashtag");
    markAiDeclined(db, id, "hash1");
    const [stored] = listPosts(db, { includeHidden: true });
    assert.equal(stored?.ai_scored_text_hash, "hash1");
    assert.equal(stored?.ai_score, null);
  });

  it("only re-downloads comments when the count grew", () => {
    const db = openDatabase(":memory:");
    const id = upsertPost(db, post(), "hashtag");
    assert.equal(listPostsNeedingComments(db).length, 1);
    replaceComments(db, id, [], 2);
    assert.equal(listPostsNeedingComments(db).length, 0);
    upsertPost(db, post({ comments: 5 }), "hashtag");
    assert.equal(listPostsNeedingComments(db).length, 1);
  });
});

describe("ranking", () => {
  const stored = (id: number, r: number, c: number, s: number, ai: number | null = null): StoredPost => ({
    id, fb_post_id: String(id), url: `u${id}`, source: "hashtag", author_id: `a${id}`, author_name: null, author_url: null,
    text: null, posted_at: `2026-10-0${id}T00:00:00Z`, reactions: r, comments: c, shares: s, comments_fetched_count: -1,
    hidden: 0, ai_summary: null, ai_topic: null, ai_sentiment: null, ai_on_topic: null, ai_score: ai, ai_reason: null,
    ai_scored_text_hash: null, first_seen_at: "2026-10-01T00:00:00Z", metrics_updated_at: null,
  });

  it("weights metrics and AI score", () => {
    assert.equal(scorePost(stored(1, 10, 2, 1, 8), { reaction: 1, comment: 2, share: 3, ai: 5 }), 57);
  });

  it("orders by score and shares ranks on ties", () => {
    const ranked = rankPosts([stored(1, 1, 0, 0), stored(2, 5, 0, 0), stored(3, 5, 0, 0), stored(4, 0, 0, 0)], config.RANK_WEIGHTS);
    assert.deepEqual(ranked.map((r) => [r.post.id, r.rank]), [[2, 1], [3, 1], [1, 3], [4, 4]]);
  });
});

describe("campaign stats", () => {
  it("counts unique commenters across posts and builds daily series", () => {
    const db = openDatabase(":memory:");
    const a = upsertPost(db, post(), "hashtag");
    const b = upsertPost(db, post({ fbPostId: "2", url: "https://www.facebook.com/b/posts/2", authorId: "u2" }), "hashtag");
    const comment = (id: string, key: string) => ({ commentId: id, profileKey: key, profileName: null, profileUrl: null, text: null, commentedAt: null });
    replaceComments(db, a, [comment("c1", "id:x"), comment("c2", "id:y")], 2);
    replaceComments(db, b, [comment("c3", "id:x")], 1);
    const stats = computeCampaignStats(db, listPosts(db, { includeHidden: false }));
    assert.equal(stats.uniqueCommenters, 2);
    assert.equal(stats.totalAuthors, 2);
    assert.equal(stats.daily.find((d) => d.day === "2026-10-05")?.newPosts, 2);
  });
  it("fills gaps between days", () => {
    assert.deepEqual(contiguousDays(["2026-10-03", "2026-09-30", "2026-10-03"]), ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    assert.deepEqual(contiguousDays([]), []);
  });
  it("handles an empty campaign", () => {
    const stats = computeCampaignStats(openDatabase(":memory:"), []);
    assert.equal(stats.totalPosts, 0);
    assert.equal(stats.uniqueCommenters, 0);
  });
});

describe("campaign window and schedule", () => {
  it("uses Vietnam time for window edges", () => {
    assert.ok(isInCampaignWindow({ postedAt: "2026-09-30T17:30:00Z" }, config)); // 00:30 on 1/10 VN
    assert.ok(!isInCampaignWindow({ postedAt: "2026-09-30T16:30:00Z" }, config));
    assert.ok(isInCampaignWindow({ postedAt: null }, config));
  });
  it("stops scanning after the campaign but keeps refreshing during grace", () => {
    assert.deepEqual(jobsDueAt(Date.parse("2026-09-20T00:00:00Z"), config), []);
    assert.deepEqual(jobsDueAt(Date.parse("2026-10-10T00:00:00Z"), config), ["scan", "refresh", "comments", "ai"]);
    assert.deepEqual(jobsDueAt(Date.parse("2026-11-04T00:00:00Z"), config), ["refresh", "comments", "ai"]);
    assert.deepEqual(jobsDueAt(Date.parse("2026-11-20T00:00:00Z"), config), []);
  });
});

describe("runWithConcurrency", () => {
  it("keeps going after failures and respects the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    const result = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (n % 3 === 0) throw new Error(`boom ${n}`);
      done.push(n);
    });
    assert.equal(peak, 2);
    assert.deepEqual(done.sort(), [1, 2, 4, 5]);
    assert.equal(result.failed, 2);
    assert.match(result.firstError ?? "", /boom/);
    assert.deepEqual(await runWithConcurrency([], 3, async () => {}), { failed: 0, firstError: null });
  });
});

describe("csv export", () => {
  it("escapes quotes, newlines and formula injection", () => {
    assert.equal(csvCell('a "b"'), '"a ""b"""');
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell(-3), "-3");
    assert.equal(csvCell(null), "");
    assert.ok(buildPostsCsv([]).startsWith("﻿Hạng,"));
  });
});
