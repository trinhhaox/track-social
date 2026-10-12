# Track Social

Công cụ thu thập bài viết Facebook gắn hashtag của chiến dịch, đo lượt tương tác, cho AI chấm bài và hiển thị bảng xếp hạng công khai.

- `/`: bảng xếp hạng công khai (tên tác giả, link bài, số liệu, điểm)
- `/admin`: dashboard quản trị (đăng nhập bằng `ADMIN_USER`/`ADMIN_PASSWORD`)
  - Chỉ số tổng, biểu đồ theo ngày, top người đăng, phân tích AI
  - Chạy thu thập thủ công, thêm link bài bị sót, ẩn/hiện bài, tải CSV

## Nguồn dữ liệu

| Nguồn | Cách lấy | Ghi chú |
|---|---|---|
| Trang cá nhân | Apify `apify/facebook-hashtag-scraper` | Không cần cookie. Facebook chỉ trả **một phần** bài theo hashtag. Bài để chế độ Bạn bè không lấy được. |
| Fanpage của bạn | Graph API (`/{page-id}/feed`) | Lọc bài có hashtag. Cần Page token. |
| Bài bị sót | Admin dán link | Số liệu tự tải ở lần làm mới kế tiếp. |

Bình luận lấy bằng `apify/facebook-comments-scraper`; Fanpage dùng Graph API. **"Người bình luận duy nhất"** được gộp trùng theo link/ID hồ sơ. Facebook không công khai danh sách người thả cảm xúc nên cảm xúc chỉ có tổng số.

## Chi phí ước tính (dưới 500 bài)

- Quét hashtag: 0,005 USD/bài × số lần quét. Lần quét hằng ngày đã cập nhật luôn số liệu của các bài tìm thấy.
- Làm mới số liệu: chỉ áp dụng cho bài không xuất hiện trong lần quét gần nhất (link thủ công, bài cũ).
- Bình luận: 0,0025 USD/bình luận. Chỉ tải lại khi số bình luận của bài tăng.
- AI: mỗi bài chấm một lần, chỉ chấm lại khi nội dung bài thay đổi.

## Chạy local

```bash
cp .env.example .env    # điền hashtag, ngày, mật khẩu, token
npm install
npm run dev             # http://localhost:3000
```

Lưu ý: trong `.env`, viết `CAMPAIGN_HASHTAGS=trigxanh` (không có `#`), vì `#` là ký tự bắt đầu comment.

## Deploy (Docker)

```bash
docker compose up -d --build   # lắng nghe 127.0.0.1:3017, dữ liệu trong volume campaign-data
```

Sao lưu: `docker compose cp app:/app/data/campaign.db ./backup.db`. Đặt Nginx/Caddy phía trước để có HTTPS. Trang `/admin` dùng Basic Auth, nên **bắt buộc chạy qua HTTPS**.

## Lịch chạy tự động

- **Trước ngày bắt đầu:** không chạy gì.
- **Trong chiến dịch (đến hết ngày kết thúc + 1 ngày):** quét hashtag & Fanpage mỗi `SCAN_INTERVAL_HOURS`, sau đó tải bình luận và AI chấm bài.
- **Sau chiến dịch `REFRESH_GRACE_DAYS` ngày:** chỉ làm mới số liệu, bình luận và AI.
- **Khi khởi động lại:** chỉ chạy bù những việc đã quá hạn, để tránh tốn phí scraper mỗi lần deploy.

## Phát triển

```bash
npm run typecheck
npm test
```

Cấu trúc thư mục:

- `src/collectors`: Apify, Graph API, chuẩn hoá dữ liệu
- `src/db`: SQLite (`node:sqlite`)
- `src/analysis`: xếp hạng, thống kê, AI chấm bài
- `src/jobs`: hàng đợi việc, lịch chạy
- `src/web`: Hono, giao diện JSX render phía server
