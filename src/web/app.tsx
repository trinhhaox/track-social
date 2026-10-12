import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { isAiConfigured } from "../analysis/ai-post-scorer.ts";
import { computeCampaignStats } from "../analysis/campaign-stats.ts";
import { rankPosts, type RankedPost } from "../analysis/ranking.ts";
import { isFanpageConfigured } from "../collectors/fanpage-graph-collector.ts";
import { canonicalPostUrl, isFacebookUrl } from "../collectors/normalize-apify-items.ts";
import type { AppConfig } from "../config.ts";
import { addManualPost, listPosts, setHidden } from "../db/posts-repository.ts";
import type { JobRunner } from "../jobs/job-runner.ts";
import { JOB_LABELS, JOB_NAMES, enqueueJob, type JobName } from "../jobs/scheduler.ts";
import { buildPostsCsv } from "./csv-export.ts";
import { AdminPage } from "./views/admin-page.tsx";
import { LeaderboardPage } from "./views/leaderboard-page.tsx";

/** Visible posts ranked, followed by hidden posts (unranked) for the admin view. */
function rankForAdmin(db: DatabaseSync, config: AppConfig): RankedPost[] {
  const all = listPosts(db, { includeHidden: true });
  const hidden = all.filter((p) => p.hidden).map((post) => ({ post, engagement: 0, score: 0, rank: 0 }));
  return [...rankPosts(all.filter((p) => !p.hidden), config.RANK_WEIGHTS), ...hidden];
}

const redirectWithFlash = (message: string): Response =>
  new Response(null, { status: 303, headers: { Location: `/admin?flash=${encodeURIComponent(message)}` } });

export function createApp(db: DatabaseSync, config: AppConfig, runner: JobRunner): Hono {
  const app = new Hono();
  app.use("*", secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      styleSrc: ["'unsafe-inline'"],
      imgSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
    },
  }));
  // Basic-auth credentials are sent automatically by browsers, so POSTs need an Origin check.
  // Compare hosts (not full origins) so it still works behind a TLS-terminating reverse proxy.
  app.use("/admin/*", csrf({
    origin: (origin, c) => {
      try {
        return new URL(origin).host === (c.req.header("x-forwarded-host") ?? c.req.header("host"));
      } catch {
        return false;
      }
    },
  }));
  app.use("/admin", basicAuth({ username: config.ADMIN_USER, password: config.ADMIN_PASSWORD }));
  app.use("/admin/*", basicAuth({ username: config.ADMIN_USER, password: config.ADMIN_PASSWORD }));

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/", (c) => {
    const posts = listPosts(db, { includeHidden: false });
    const ranked = rankPosts(posts, config.RANK_WEIGHTS);
    const updatedAt = posts.reduce<string | null>((max, p) => (p.metrics_updated_at && (!max || p.metrics_updated_at > max) ? p.metrics_updated_at : max), null);
    const totals = {
      posts: posts.length,
      authors: new Set(posts.map((p) => p.author_id ?? p.author_url ?? p.author_name ?? p.id)).size,
      engagement: ranked.reduce((a, r) => a + r.engagement, 0),
    };
    c.header("Cache-Control", "public, max-age=60");
    return c.html(<LeaderboardPage config={config} ranked={ranked} totals={totals} updatedAt={updatedAt} />);
  });

  app.get("/admin", (c) => {
    const ranked = rankForAdmin(db, config);
    const stats = computeCampaignStats(db, listPosts(db, { includeHidden: false }));
    const integrations = { apify: Boolean(config.APIFY_TOKEN), fanpage: isFanpageConfigured(config), ai: isAiConfigured(config) };
    return c.html(
      <AdminPage
        config={config} stats={stats} ranked={ranked} runs={runner.recentRuns()}
        pendingJobs={JOB_NAMES.filter((j) => runner.isPending(j))}
        flash={c.req.query("flash")?.slice(0, 300) ?? null} integrations={integrations}
      />,
    );
  });

  app.get("/admin/export.csv", (c) => {
    const date = new Date().toISOString().slice(0, 10);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="bai-du-thi-${date}.csv"`);
    return c.body(buildPostsCsv(rankForAdmin(db, config)));
  });

  app.post("/admin/jobs/:name", (c) => {
    const name = c.req.param("name");
    if (!JOB_NAMES.includes(name as JobName)) return c.text("Không có việc này", 404);
    const queued = enqueueJob(name as JobName, runner, db, config);
    const label = JOB_LABELS[name as JobName];
    return redirectWithFlash(queued ? `Đã xếp lịch: ${label}. Tải lại trang sau ít phút để xem kết quả.` : `${label} đang chạy rồi.`);
  });

  app.post("/admin/posts", async (c) => {
    const body = await c.req.parseBody();
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!isFacebookUrl(url)) return redirectWithFlash("Link không hợp lệ — cần link bài viết facebook.com.");
    const { created } = addManualPost(db, canonicalPostUrl(url));
    if (created) enqueueJob("refresh", runner, db, config);
    return redirectWithFlash(created ? "Đã thêm bài, số liệu sẽ được tải trong vài phút." : "Bài này đã có trong danh sách.");
  });

  app.post("/admin/posts/:id/visibility", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.text("ID không hợp lệ", 400);
    const body = await c.req.parseBody();
    const hidden = body.hidden === "1";
    setHidden(db, id, hidden);
    return redirectWithFlash(hidden ? "Đã ẩn bài khỏi bảng xếp hạng." : "Đã hiện lại bài.");
  });

  return app;
}
