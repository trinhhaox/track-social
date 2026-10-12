import type { RankedPost } from "../../analysis/ranking.ts";
import { fmt } from "./layout.tsx";

const SOURCE_LABELS = { hashtag: "Hashtag", fanpage: "Fanpage", manual: "Thủ công" } as const;
const SENTIMENT_LABELS: Record<string, string> = { positive: "Tích cực", neutral: "Trung lập", negative: "Tiêu cực" };

export function AdminPostsTable({ ranked }: { ranked: RankedPost[] }) {
  if (ranked.length === 0) {
    return <p class="muted">Chưa có bài nào. Bấm "Quét hashtag & Fanpage" hoặc thêm link thủ công.</p>;
  }
  return (
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Tác giả / nội dung</th><th class="n">Cảm xúc</th><th class="n">BL</th>
            <th class="n">Chia sẻ</th><th class="n">AI</th><th class="n">Điểm</th><th></th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(({ post, score, rank }) => (
            <tr class={post.hidden ? "hidden-row" : ""}>
              <td class="rank">{post.hidden ? "–" : rank}</td>
              <td>
                <div>
                  <strong>{post.author_name ?? "(chưa rõ)"}</strong>{" "}
                  <span class="badge">{SOURCE_LABELS[post.source]}</span>{" "}
                  {post.ai_on_topic === 0 ? <span class="badge error">Lạc đề?</span> : null}
                </div>
                <div class="excerpt">{post.ai_summary ?? post.text ?? "(chưa tải nội dung)"}</div>
                {post.ai_reason ? (
                  <div class="small muted">
                    AI: {post.ai_topic} · {SENTIMENT_LABELS[post.ai_sentiment ?? ""] ?? "—"} · {post.ai_reason}
                  </div>
                ) : null}
              </td>
              <td class="n">{fmt(post.reactions)}</td>
              <td class="n">{fmt(post.comments)}</td>
              <td class="n">{fmt(post.shares)}</td>
              <td class="n">{post.ai_score ?? "—"}</td>
              <td class="n"><strong>{fmt(score)}</strong></td>
              <td>
                <a href={post.url} target="_blank" rel="noopener noreferrer">Mở</a>
                <form class="inline" method="post" action={`/admin/posts/${post.id}/visibility`}>
                  <input type="hidden" name="hidden" value={post.hidden ? "0" : "1"} />
                  <button type="submit" class="small">{post.hidden ? "Hiện" : "Ẩn"}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
