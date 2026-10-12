import type { RankedPost } from "../../analysis/ranking.ts";
import type { AppConfig } from "../../config.ts";
import { Layout, StatTile, fmt, fmtDateTime } from "./layout.tsx";

export interface LeaderboardProps {
  config: AppConfig;
  ranked: RankedPost[];
  totals: { posts: number; authors: number; engagement: number };
  updatedAt: string | null;
}

export function LeaderboardPage({ config, ranked, totals, updatedAt }: LeaderboardProps) {
  const w = config.RANK_WEIGHTS;
  const formula = [
    w.reaction && `${w.reaction}×cảm xúc`,
    w.comment && `${w.comment}×bình luận`,
    w.share && `${w.share}×chia sẻ`,
    w.ai && `${w.ai}×điểm giám khảo AI`,
  ].filter(Boolean).join(" + ");
  return (
    <Layout title={`Bảng xếp hạng – ${config.CAMPAIGN_NAME}`}>
      <header class="top">
        <div>
          <h1>{config.CAMPAIGN_NAME}</h1>
          <div class="muted">
            {config.CAMPAIGN_HASHTAGS.map((h) => `#${h}`).join(" ")} · {config.CAMPAIGN_START} → {config.CAMPAIGN_END}
          </div>
        </div>
        <div class="muted small">Cập nhật: {fmtDateTime(updatedAt)}</div>
      </header>

      <div class="grid tiles">
        <StatTile label="Bài dự thi" value={totals.posts} />
        <StatTile label="Người tham gia" value={totals.authors} />
        <StatTile label="Lượt tương tác" value={totals.engagement} />
      </div>

      <section class="card">
        <h2>Bảng xếp hạng</h2>
        <p class="muted small">Điểm = {formula}. Mỗi người chỉ có 1 chỗ trên bảng, tính bài có điểm cao nhất.</p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Tác giả</th><th class="n">Cảm xúc</th><th class="n">Bình luận</th>
                <th class="n">Chia sẻ</th><th class="n">Điểm</th><th></th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, config.LEADERBOARD_SIZE).map((r) => (
                <tr>
                  <td class="rank">{r.rank}</td>
                  <td>{r.post.author_name ?? "(chưa rõ)"}</td>
                  <td class="n">{fmt(r.post.reactions)}</td>
                  <td class="n">{fmt(r.post.comments)}</td>
                  <td class="n">{fmt(r.post.shares)}</td>
                  <td class="n"><strong>{fmt(r.score)}</strong></td>
                  <td><a href={r.post.url} target="_blank" rel="noopener noreferrer">Xem bài</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ranked.length === 0 ? <p class="muted">Chưa có bài dự thi nào.</p> : null}
      </section>
    </Layout>
  );
}
