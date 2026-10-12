import type { Child } from "hono/jsx";
import { raw } from "hono/html";

const STYLES = `
:root{--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#5d6472;--line:#e3e6eb;--accent:#1f6feb;--accent-soft:#e7f0ff;--good:#1a7f37;--bad:#cf222e;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--text:#e8eaed;--muted:#9aa3b2;--line:#2a2f3a;--accent:#4c8dff;--accent-soft:#1b2740;--good:#3fb950;--bad:#f85149;--warn:#d29922}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px 48px}
header.top{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between;margin-bottom:20px}
h1{font-size:24px;margin:0}h2{font-size:17px;margin:0 0 12px}.muted{color:var(--muted)}.small{font-size:13px}
.grid{display:grid;gap:12px}.tiles{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px}
.two{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}
.tile .v{font-size:26px;font-weight:650;font-variant-numeric:tabular-nums}.tile .l{color:var(--muted);font-size:13px}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:550;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.badge{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;background:var(--accent-soft);color:var(--accent)}
.badge.ok{color:var(--good);background:transparent;border:1px solid currentColor}.badge.error{color:var(--bad);background:transparent;border:1px solid currentColor}
.badge.running{color:var(--warn);background:transparent;border:1px solid currentColor}
.excerpt{max-width:420px;color:var(--muted);font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
form.inline{display:inline}button,input[type=url]{font:inherit;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text);padding:6px 12px}
button{cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button:hover{filter:brightness(.97)}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}input[type=url]{flex:1;min-width:220px}
.flash{padding:10px 14px;border-radius:8px;background:var(--accent-soft);margin-bottom:16px}
.rank{font-weight:700;font-size:18px;width:40px}.hidden-row{opacity:.5}
svg text{fill:var(--muted);font-size:11px}
`;

export function Layout(props: { title: string; children: Child }) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <style>{raw(STYLES)}</style>
      </head>
      <body>
        <div class="wrap">{props.children}</div>
      </body>
    </html>
  );
}

const numberFormatter = new Intl.NumberFormat("vi-VN");
export const fmt = (n: number): string => numberFormatter.format(n);

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});
export const fmtDateTime = (iso: string | null): string => (iso ? dateTimeFormatter.format(new Date(iso)) : "—");

export function StatTile(props: { label: string; value: number | string }) {
  return (
    <div class="card tile">
      <div class="v">{typeof props.value === "number" ? fmt(props.value) : props.value}</div>
      <div class="l">{props.label}</div>
    </div>
  );
}

/** Minimal server-rendered bar chart; no client JS needed. */
export function BarChart(props: { points: Array<{ label: string; value: number }>; height?: number; ariaLabel: string }) {
  const height = props.height ?? 160;
  const width = 640;
  const pad = { top: 8, bottom: 22, left: 4, right: 4 };
  const max = Math.max(1, ...props.points.map((p) => p.value));
  const slot = (width - pad.left - pad.right) / Math.max(1, props.points.length);
  const barW = Math.max(2, Math.min(28, slot - 4));
  const labelEvery = Math.ceil(props.points.length / 8);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={props.ariaLabel}>
      {props.points.map((p, i) => {
        const h = ((height - pad.top - pad.bottom) * p.value) / max;
        const x = pad.left + i * slot + (slot - barW) / 2;
        return (
          <g>
            <rect x={x} y={height - pad.bottom - h} width={barW} height={h} rx="3" fill="var(--accent)">
              <title>{`${p.label}: ${fmt(p.value)}`}</title>
            </rect>
            {i % labelEvery === 0 ? (
              <text x={x + barW / 2} y={height - 6} text-anchor="middle">{p.label.slice(5)}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
