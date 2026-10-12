import type { CampaignStats } from "../../analysis/campaign-stats.ts";
import type { RankedPost } from "../../analysis/ranking.ts";
import type { AppConfig } from "../../config.ts";
import type { JobRun } from "../../jobs/job-runner.ts";
import { JOB_LABELS, JOB_NAMES } from "../../jobs/scheduler.ts";
import { AdminPostsTable } from "./admin-posts-table.tsx";
import { BarChart, Layout, StatTile, fmt, fmtDateTime } from "./layout.tsx";

export interface AdminPageProps {
  config: AppConfig;
  stats: CampaignStats;
  ranked: RankedPost[];
  runs: JobRun[];
  pendingJobs: string[];
  flash: string | null;
  integrations: { apify: boolean; fanpage: boolean; ai: boolean };
}

const STATUS_LABELS = { running: "Đang chạy", ok: "Xong", error: "Lỗi" } as const;

export function AdminPage({ config, stats, ranked, runs, pendingJobs, flash, integrations }: AdminPageProps) {
  const sentimentTotal = Object.values(stats.sentiment).reduce((a, b) => a + b, 0);
  return (
    <Layout title={`Quản trị – ${config.CAMPAIGN_NAME}`}>
      <header class="top">
        <div>
          <h1>{config.CAMPAIGN_NAME}</h1>
          <div class="muted">
            {config.CAMPAIGN_HASHTAGS.map((h) => `#${h}`).join(" ")} · {config.CAMPAIGN_START} → {config.CAMPAIGN_END}
          </div>
        </div>
        <div class="row small">
          <a href="/">Bảng xếp hạng công khai</a>
          <a href="/admin/export.csv">Tải CSV</a>
        </div>
      </header>

      {flash ? <div class="flash">{flash}</div> : null}

      <div class="grid tiles">
        <StatTile label="Bài viết" value={stats.totalPosts} />
        <StatTile label="Người đăng bài" value={stats.totalAuthors} />
        <StatTile label="Cảm xúc" value={stats.totalReactions} />
        <StatTile label="Bình luận" value={stats.totalComments} />
        <StatTile label="Chia sẻ" value={stats.totalShares} />
        <StatTile label="Người bình luận duy nhất" value={stats.uniqueCommenters} />
      </div>

      <div class="grid two" style="margin-bottom:16px">
        <section class="card">
          <h2>Bài mới theo ngày</h2>
          <BarChart ariaLabel="Số bài mới theo ngày" points={stats.daily.map((d) => ({ label: d.day, value: d.newPosts }))} />
        </section>
        <section class="card">
          <h2>Tổng tương tác tích luỹ</h2>
          <BarChart ariaLabel="Tổng tương tác theo ngày" points={stats.daily.map((d) => ({ label: d.day, value: d.totalEngagement }))} />
        </section>
      </div>

      <div class="grid two" style="margin-bottom:16px">
        <section class="card">
          <h2>Top người đăng bài</h2>
          <table>
            <thead><tr><th>Tác giả</th><th class="n">Bài</th><th class="n">Tương tác</th></tr></thead>
            <tbody>
              {stats.topAuthors.map((a) => (
                <tr>
                  <td>{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a> : a.name}</td>
                  <td class="n">{fmt(a.posts)}</td>
                  <td class="n">{fmt(a.engagement)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section class="card">
          <h2>Phân tích AI ({fmt(stats.aiScored)}/{fmt(stats.totalPosts)} bài)</h2>
          {sentimentTotal ? (
            <p class="small">
              Tích cực {fmt(stats.sentiment.positive ?? 0)} · Trung lập {fmt(stats.sentiment.neutral ?? 0)} · Tiêu cực{" "}
              {fmt(stats.sentiment.negative ?? 0)}
            </p>
          ) : <p class="muted small">{integrations.ai ? "Chưa có bài nào được chấm." : "Chưa cấu hình ANTHROPIC_API_KEY."}</p>}
          <table>
            <tbody>
              {stats.topics.map((t) => <tr><td>{t.topic}</td><td class="n">{fmt(t.count)}</td></tr>)}
            </tbody>
          </table>
        </section>
      </div>

      <section class="card" style="margin-bottom:16px">
        <h2>Thu thập dữ liệu</h2>
        <div class="row" style="margin-bottom:12px">
          {JOB_NAMES.map((job) => (
            <form class="inline" method="post" action={`/admin/jobs/${job}`}>
              <button type="submit" disabled={pendingJobs.includes(job)}>
                {JOB_LABELS[job]}{pendingJobs.includes(job) ? " (đang chờ)" : ""}
              </button>
            </form>
          ))}
        </div>
        <form method="post" action="/admin/posts" class="row" style="margin-bottom:12px">
          <input type="url" name="url" required placeholder="Dán link bài Facebook bị sót…" />
          <button type="submit" class="primary">Thêm bài</button>
        </form>
        <p class="small muted">
          Apify: {integrations.apify ? "đã kết nối" : "chưa cấu hình"} · Fanpage: {integrations.fanpage ? "đã kết nối" : "chưa cấu hình"} · AI:{" "}
          {integrations.ai ? config.AI_MODEL : "chưa cấu hình"}
        </p>
        <div class="scroll">
          <table>
            <thead><tr><th>Việc</th><th>Bắt đầu</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr>
                  <td>{JOB_LABELS[r.job as keyof typeof JOB_LABELS] ?? r.job}</td>
                  <td class="small">{fmtDateTime(r.started_at)}</td>
                  <td><span class={`badge ${r.status}`}>{STATUS_LABELS[r.status]}</span></td>
                  <td class="small">{r.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>Tất cả bài viết</h2>
        <AdminPostsTable ranked={ranked} />
      </section>
    </Layout>
  );
}
