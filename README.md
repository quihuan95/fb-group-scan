# The HBG Facebook Group Lead Scanner

Runner bền vững cho 152 Facebook Group: đọc rule từ Google Sheet, quét `Bài viết mới`, lưu checkpoint SQLite, phân loại 11 dịch vụ bằng OpenAI, chống trùng và ghi lead `NEW` vào Sheet Data thô (tab `Tháng 10/26`, cấu trúc `A6:H6`).

## 1. Yêu cầu

- Node.js 20+
- Chrome/Chromium
- OpenAI API key
- Google service account có quyền Editor với Sheet chính

## 2. Cài đặt

```bash
npm install
npm run install-browser
cp .env.example .env
```

Tải JSON service account từ Google Cloud, lưu thành `service-account.json`, sau đó chia sẻ Google Sheet cho email service account.

## 3. Đăng nhập Facebook lần đầu

Đặt `HEADLESS=false`, chạy:

```bash
npm run scan -- --stt=1
```

Chrome profile được giữ trong `browser-profile/`. Tự đăng nhập/xác minh trên cửa sổ Chrome. Không đưa mật khẩu/cookie vào `.env`.

## 4. Test trước

```bash
npm test
npm run typecheck
npm run scan -- --stt=1,2,3,4,5
```

Sau khi kiểm tra `LEAD OUTPUT`, chạy toàn bộ:

```bash
npm run scan
```

Runner lưu trạng thái ở `data/scanner.db`. Group chỉ được đánh dấu thành công khi cuộn đến bài ngoài Scan Window hoặc feed không tăng sau nhiều vòng. Group lỗi có checkpoint riêng và không cập nhật ngày quét.

## 5. MCP cho ChatGPT

```bash
npm run mcp
```

Endpoint: `http://localhost:8787/mcp`. Khi dùng ChatGPT Developer mode, kết nối máy nội bộ qua Secure MCP Tunnel; không mở thẳng cổng máy cá nhân ra Internet.

Các tool:

- `start_scan({stt?, priority?})`
- `get_scan_status({runId?})`
- `get_scan_report({runId})`

## 6. Lệnh vận hành

```bash
npx tsx src/cli.ts status
npx tsx src/cli.ts report RUN_ID
```

## 7. Lưu ý nghiệp vụ

- Buyer intent gồm tìm NCC/vendor/freelancer/crew/kỹ thuật viên/operator/đội vận hành cho chương trình cụ thể.
- Chỉ loại tuyển người vào làm dài hạn cho doanh nghiệp.
- `DUPLICATE` không tạo dòng; `UPDATE` cần mở rộng hàm cập nhật đúng dòng trước khi bật sản xuất.
- Bản hiện tại tự ghi `NEW`; `UPDATE` được giữ trong database để review, tránh ghi nhầm.
- Facebook có thể thay DOM. Khi extractor lỗi, group chuyển `ERROR`, không suy đoán dữ liệu.

## 8. Checklist production

1. Dùng tài khoản Facebook nghiệp vụ riêng.
2. Chạy PC/VPS có giao diện và profile cố định.
3. Backup `data/scanner.db`.
4. Giới hạn 5–10 group mỗi batch và đặt lịch theo Priority.
5. Review `HOLD/ERROR` hàng ngày.
6. Không commit `.env`, `service-account.json`, `browser-profile/`.
