import type { RankedPost } from "../analysis/ranking.ts";

/** Quotes a cell and neutralises spreadsheet formula injection (=, +, -, @ prefixes). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADERS = [
  "Hạng", "Điểm", "Tác giả", "Link tác giả", "Link bài", "Nguồn", "Ngày đăng", "Cảm xúc", "Bình luận", "Chia sẻ",
  "Điểm AI", "Đúng chủ đề", "Chủ đề", "Cảm xúc bài", "Tóm tắt AI", "Nhận xét AI", "Ẩn", "Nội dung",
];

export function buildPostsCsv(ranked: RankedPost[]): string {
  const rows = ranked.map(({ post, score, rank }) => [
    rank || "", score, post.author_name, post.author_url, post.url, post.source, post.posted_at,
    post.reactions, post.comments, post.shares, post.ai_score,
    post.ai_on_topic === null ? "" : post.ai_on_topic ? "có" : "không",
    post.ai_topic, post.ai_sentiment, post.ai_summary, post.ai_reason, post.hidden ? "có" : "", post.text,
  ]);
  // BOM so Excel opens UTF-8 Vietnamese text correctly.
  return "﻿" + [HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
