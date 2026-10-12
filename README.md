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
- Làm mới số liệu: chỉ áp dụng cho bài không xuất hiện trong lần quét gần nhất (link thủ công, bài cũ). Bài 3 lần liên tiếp không lấy được (bị xoá, riêng tư, link sai) sẽ ngừng làm mới và có nhãn "Không truy cập được" trong `/admin`.
- Bình luận: 0,0025 USD/bình luận. Chỉ tải lại khi số bình luận tăng ít nhất 20% so với lần tải trước (bài ít bình luận: tăng 1 là tải). Bình luận Fanpage miễn phí nên tải lại mỗi khi tăng.
- Bài vừa có trên Fanpage vừa được quét hashtag được gộp thành một dòng và chuyển sang làm mới miễn phí qua Graph API.
- AI: mỗi bài chấm một lần, chỉ chấm lại khi nội dung bài thay đổi.

## Lưu ý về số liệu

- Số cảm xúc/bình luận/chia sẻ **chỉ tăng, không giảm**: mỗi lần cập nhật giữ giá trị lớn hơn giữa số cũ và số mới. Lý do: máy quét hashtag trả số làm tròn ("1,2K") còn lần làm mới trả số chính xác, và đôi khi trả 0 do lỗi tạm thời. Đổi lại, tương tác bị Facebook gỡ (like ảo) sẽ không được trừ; số sai cần sửa trực tiếp trong DB.
- **Mỗi tác giả chỉ có 1 chỗ trên bảng xếp hạng**, tính bài có điểm cao nhất. Các bài còn lại vẫn được thu thập, cộng vào tổng số liệu và hiện trong `/admin` với nhãn **Bài phụ của tác giả**. Tác giả được nhận diện theo ID hồ sơ, rồi link hồ sơ, rồi tên.
- `/admin` gắn nhãn để giám khảo xem lại: **Lạc đề?** (AI đánh giá), **Ngoài thời gian**, **Thiếu hashtag** (thường gặp với link thêm thủ công), **Không truy cập được**. Bật `AI_EXCLUDE_OFF_TOPIC=true` để bài lạc đề tự rời bảng xếp hạng công khai.
- "Người bình luận duy nhất" chỉ tính bình luận cấp 1 (không tính trả lời), giống nhau cho Fanpage và trang cá nhân.

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

Sao lưu: `docker compose cp app:/app/data/campaign.db ./backup.db`. Đặt Nginx/Caddy phía trước để có HTTPS. Trang `/admin` dùng Basic Auth, nên **bắt buộc chạy qua HTTPS** và nên giới hạn số lần thử mật khẩu ở reverse proxy (ứng dụng không tự chặn dò mật khẩu), ví dụ Nginx:

```nginx
limit_req_zone $binary_remote_addr zone=admin:1m rate=10r/m;   # trong khối http
location /admin { limit_req zone=admin burst=20 nodelay; proxy_pass http://127.0.0.1:3017; proxy_set_header Host $host; }
```

Khi dừng/deploy, các lượt chạy Apify đang dở sẽ bị huỷ (kết quả của chúng không còn ai nhận), nên tránh deploy lúc đang quét hashtag.

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
