# TASK: Loại bỏ hoàn toàn dữ liệu Facebook Comments khỏi quy trình quét Lead

## 1. Mục tiêu

Chỉnh sửa **hệ thống Facebook Group Lead Scanner hiện có** để AI **chỉ sử dụng dữ liệu từ bài đăng gốc (original post)** khi phát hiện, phân loại, trích xuất và ghi lead.

**Không lấy bất kỳ dữ liệu nào từ comment/reply**, bao gồm comment do chính tác giả bài đăng viết, comment ghim hoặc comment tự hiển thị trên giao diện Facebook.

> Đây là yêu cầu thay đổi source code và pipeline xử lý dữ liệu, **không chỉ thêm câu lệnh vào SYSTEM_PROMPT**.

## 2. Nguyên tắc thực hiện

1. Trước tiên đọc codebase và xác định các thành phần: Facebook scraper/browser automation, DOM extraction, chuẩn hóa dữ liệu, lệnh gọi AI/classifier, chống trùng, ghi Google Sheet/Drive, logging và tests.
2. Chỉnh sửa trực tiếp file hiện có; giữ nguyên kiến trúc và API contract nếu có thể. Không tạo một hệ thống song song.
3. Chỉ thay đổi các phần cần thiết để loại bỏ comment khỏi nguồn dữ liệu. Không tự sửa logic phân loại 11 nhóm dịch vụ, Scan Window, mapping, chống trùng hoặc các rule nghiệp vụ khác.
4. Google Sheet **MASTER GROUP – HỆ THỐNG QUÉT LEAD FACEBOOK / WEB** là nguồn cấu hình nghiệp vụ có thẩm quyền. Không tự thêm group, keyword, dịch vụ hoặc rule loại trừ. Nếu cần thay đổi cấu hình trái với Sheet, báo lại thay vì tự ghi đè.
5. Không suy diễn rằng nội dung thiếu trong bài gốc có thể được bổ sung từ bình luận.

## 3. Phạm vi dữ liệu ĐƯỢC PHÉP

Chỉ dùng dữ liệu thuộc chính bài đăng gốc:

- `postId`, canonical `postUrl`/permalink và `groupUrl`/group ID nếu xác định được chính xác.
- `author` của bài đăng gốc.
- `createdAt`/thời gian **đăng bài gốc** (không dùng thời gian comment).
- `content`/text của bài đăng gốc, bao gồm phần “Xem thêm” **của bài gốc** nếu có.
- Ảnh, video và attachment đính kèm **trực tiếp vào bài gốc**, trong khả năng pipeline hiện tại hỗ trợ.
- SĐT/Zalo/email, địa điểm, thời gian sự kiện, quy mô, ngân sách, deadline **chỉ khi xuất hiện trong nội dung hoặc attachment của bài gốc**.

Nếu trường thông tin không có trong bài gốc, đặt `null`/giá trị trống theo schema hiện có, **không tìm trong comment**.

## 4. Nguồn dữ liệu BỊ CẤM

- Toàn bộ `comments`, `replies`, `commentThreads`, bình luận ghim, bình luận nổi bật, bình luận của chính tác giả.
- Contact, thời gian, địa điểm, quy mô, ngân sách, deadline, nội dung nhu cầu hoặc thông tin cập nhật lấy từ bình luận.
- Timestamp của comment làm bằng chứng bài nằm trong Scan Window.
- Các bài viết hoặc trang bên ngoài được liên kết **trong comment**.
- Tạo lead riêng từ comment, hoặc UPDATE lead cũ bằng thông tin chỉ có trong comment.

## 5. Yêu cầu sửa code (bắt buộc)

### A. Facebook scraper / DOM extraction

- Xác định đúng ranh giới DOM giữa **post body** và **comments/replies**. Tuyệt đối không dùng `innerText`/`textContent` trên một container bao gồm cả bài viết và bình luận để gán vào `post.content`.
- Nếu code đang dùng selector quá rộng, thay bằng selector xác định riêng post body và metadata của bài gốc; xử lý hợp lý trường hợp DOM Facebook thay đổi.
- Chỉ mở “Xem thêm” để đọc **nội dung bài gốc**; không click “Xem thêm bình luận”, “Xem câu trả lời” hoặc tải thêm comments để tìm lead.
- Nếu UI tự hiển thị comment, bỏ qua khi extract. Nếu không phân biệt chắc chắn đâu là post body, không trộn dữ liệu: đánh dấu trường hợp cần rà soát/HOLD theo schema hiện có.
- Ưu tiên xác nhận permalink canonical và thời gian bài đăng từ metadata của **bài gốc**.

### B. Chuẩn hóa dữ liệu & payload gửi AI

- Thiết lập/kiểm tra object chuẩn hóa kiểu `OriginalPostOnly` theo cấu trúc tương thích codebase, ví dụ:

```js
const classificationInput = {
  postId: post.id,
  postUrl: post.permalink,
  groupUrl: post.groupUrl,
  author: post.author,
  createdAt: post.createdAt,
  content: post.originalBodyText,
  attachments: post.originalAttachments,
};
```

- **Whitelist** các trường cho phép thay vì truyền nguyên object của scraper tới model.
- Không truyền bất kỳ `comments`, `replies`, `commentCountText`, comment author/contact, hoặc bản text tổng hợp chứa comment vào model.
- Nếu có context text, OCR, image caption, metadata tổng hợp hoặc cached content, kiểm tra để bảo đảm nguồn vẫn là **bài gốc**.
- Đảm bảo các worker, retry, batch và đường xử lý fallback cũng tuân thủ lọc nguồn.

### C. System prompt / classifier

Bổ sung rule có độ ưu tiên cao:

> Chỉ phân tích ORIGINAL POST. Bỏ qua tuyệt đối tất cả COMMENTS/REPLIES, kể cả comment của tác giả bài đăng. Không lấy buyer intent, dịch vụ, contact, địa điểm, thời gian, quy mô hay thông tin cập nhật từ bình luận. Nếu bài gốc có buyer intent nhưng thiếu contact, vẫn xử lý theo rule hiện có với `contact: null`. Nếu dữ liệu bài gốc mơ hồ/không đọc đủ, xử lý HOLD theo quy tắc hiện hành; không dùng comment để suy đoán.

- Không sửa tên các nhóm dịch vụ hay định dạng output hiện hành nếu không cần thiết.
- Không đồng nhất `NEW` với buyer intent: **nếu hệ thống đã có bước chống trùng**, vẫn để bước đó xác định NEW/UPDATE/DUPLICATE theo rule trong Sheet. Không tự tái cấu trúc decision schema ngoài phạm vi task.

### D. Chống trùng, ghi dữ liệu, lịch sử

- Chỉ lưu nội dung và contact có nguồn từ bài đăng gốc.
- Không tạo NEW/UPDATE chỉ vì comment có thông tin mới.
- Không làm mới hay xóa LEAD OUTPUT lịch sử.
- Không tự sửa các dòng dữ liệu lịch sử đã được ghi trước đây trừ khi người dùng yêu cầu migration riêng.
- Giữ nguyên GOOGLE DRIVE MAPPING, RULE CHỐNG TRÙNG, cơ chế báo cáo và cập nhật trạng thái group.

### E. Logging / debug

- Không log raw comment vào các payload phục vụ phân loại hay dữ liệu lead.
- Có thể ghi trạng thái `comment_data_ignored` hoặc bộ đếm kỹ thuật nếu hữu ích, nhưng **không giữ nguyên văn comment hoặc thông tin liên hệ từ comment** trong log.
- Đảm bảo preview, export, webhook, cache và queue payload của lead không tái gắn comment vào bản ghi.

## 6. Trường hợp kiểm thử bắt buộc

| ID | Bài đăng gốc | Bình luận | Kết quả mong đợi |
|---|---|---|---|
| T01 | “Cần thuê màn LED cho hội nghị, liên hệ 09xx…” | NCC quảng cáo | Chỉ dùng nhu cầu và contact trong bài gốc. |
| T02 | “Cần đơn vị tổ chức sự kiện” (không có SĐT) | Tác giả comment SĐT | Buyer intent từ bài gốc; `contact = null`. |
| T03 | “Check-in cuối tuần” | Người khác comment “cần thuê xe 45 chỗ” | Không tạo lead từ comment. |
| T04 | Quảng cáo dịch vụ của NCC | Comment hỏi giá dịch vụ | Không chuyển quảng cáo thành buyer lead. |
| T05 | Bài gốc đăng ngoài Scan Window | Comment mới đăng hôm nay | Không lấy bài dựa vào ngày comment. |
| T06 | Bài gốc thiếu địa điểm, ngày và số lượng | Comment bổ sung đầy đủ | Các trường thiếu vẫn là `null`; không UPDATE vì comment. |
| T07 | Bài gốc có “Xem thêm” và bên dưới có “Xem thêm bình luận” | Bình luận chứa SĐT | Chỉ expand post body; không đưa comment vào content. |
| T08 | Comment ghim do tác giả viết chứa ngân sách | Bài gốc có nhu cầu thật, không ghi ngân sách | Ngân sách không được trích xuất. |
| T09 | Bài gốc bị che/không tách rõ DOM | Comment hiển thị rõ | Không dùng comment để lấp chỗ trống; HOLD/rà soát nếu phù hợp. |
| T10 | Bài đăng trùng đã có, comment bổ sung deadline | Không có sửa đổi nội dung bài gốc | Không UPDATE chỉ vì comment. |
| T11 | Bài gốc sửa nội dung, bổ sung quy mô mới | Comment không đổi | Đánh giá UPDATE theo rule chống trùng hiện hành, từ bài gốc. |
| T12 | Scraper trả object có cả `postText` lẫn `comments` | Comment có contact | Payload classifier chỉ chứa dữ liệu whitelisted từ bài gốc. |

Viết unit tests cho extractor/normalizer/classifier payload và integration tests cho đường ghi lead nếu dự án có test framework. Đảm bảo thay đổi này không làm mất các bài mua/thuê hợp lệ chỉ vì không có contact trong bài gốc.

## 7. Tiêu chí nghiệm thu

- [ ] Không có comment/reply trong `post.content`.
- [ ] Không có comment/reply trong payload gửi tới AI (bao gồm retry/fallback/batch).
- [ ] Không lấy contact, date, location, scale, budget, deadline từ comment.
- [ ] Không nhận dạng buyer intent từ comment nếu bài gốc không có nhu cầu.
- [ ] Không dùng timestamp comment để xác định Scan Window.
- [ ] Không tạo NEW hoặc UPDATE chỉ dựa trên comment.
- [ ] Bài gốc có nhu cầu nhưng thiếu SĐT vẫn được đánh giá hợp lệ theo rule hiện có.
- [ ] Giữ nguyên nghiệp vụ 11 dịch vụ, chống trùng 3 lớp, mapping và cấu hình Google Sheet.
- [ ] Các test liên quan chạy thành công; nếu không chạy được thì nêu rõ lý do.

## 8. Hướng dẫn AI coding agent thực thi

1. Tìm toàn bộ vị trí trong source sử dụng các từ khóa `comment`, `comments`, `replies`, `innerText`, `textContent`, `postText`, `message`, `classify`, `lead`, `scrape` và xác định đường dữ liệu thực tế.
2. Trình bày ngắn gọn những file và điểm gây trộn comment vào bài viết.
3. **Sửa trực tiếp** các file liên quan, bao gồm prompt, selector/parser, serializer và tests khi cần. Không chỉ trả về code mẫu trong phần chat.
4. Chạy test/lint/typecheck sẵn có; kiểm tra diff để tránh ảnh hưởng phần không liên quan.
5. Báo cáo: danh sách file đã sửa, thay đổi chính, test pass/fail, phần còn rủi ro (nhất là selector động của Facebook).
6. Không tự truy cập Facebook để vượt đăng nhập, xác minh hay CAPTCHA. Nếu cần xác minh trên tài khoản đang đăng nhập, yêu cầu người dùng xử lý bước bảo vệ.

## 9. Giới hạn phạm vi quét

Task này chỉ thay đổi **cách lấy và xử lý dữ liệu**. Nếu chạy thử scanner, tuân thủ chế độ test hiện hành: chỉ xử lý STT 1–5 trong MASTER GROUP theo điều kiện và Scan Window ghi tại Sheet. Không tự mở rộng phạm vi.
