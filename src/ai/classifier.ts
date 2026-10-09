import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../config/env.js';
import type { RawPost, ProductRule, Classification, OriginalPostOnly } from '../types/index.js';
import { toOriginalPostOnly } from '../utils/normalize.js';

let _client: OpenAI | null = null;
function getAiClient(): OpenAI {
  if (!_client) {
    if (!env.OPENAI_API_KEY) {
      throw new Error('⚠️ Chưa cấu hình OPENAI_API_KEY trong file .env!\nVui lòng mở file .env và điền OpenAI API key của bạn.');
    }
    _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _client;
}

const schema = z.object({
  buyerIntent: z.boolean(),
  decision: z.enum(['NEW', 'UPDATE', 'DUPLICATE', 'HOLD', 'REJECT']),
  services: z.array(z.enum([
    'Sự kiện',
    'Thiết bị',
    'Media',
    'Thi công',
    'Hội nghị MICE',
    'Tiệc',
    'Tour Inbound',
    'Tour Outbound',
    'Tour Nội địa',
    'Xe',
    'Vé'
  ])),
  temperature: z.enum(['HOT', 'WARM', 'COLD', 'HOLD']),
  needSummary: z.string(),
  location: z.string().nullable(),
  eventDate: z.string().nullable(),
  scale: z.string().nullable(),
  contact: z.string().nullable(),
  exclusionReason: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  requiresHumanReview: z.boolean()
});

const SYSTEM_PROMPT = `Bạn là chuyên gia phân loại Lead B2B cao cấp của HBG, chuyên phân tích bài đăng trên các Facebook Group thuộc ngành Sự kiện, Du lịch, MICE (Meeting, Incentive, Conference, Event) tại Việt Nam.

Nhiệm vụ của bạn là đọc nội dung bài viết và xác định chính xác:
1. Người đăng có phải là KHÁCH MUA / NGƯỜI CẦN THUÊ THẬT SỰ (Buyer Intent) hay không.
2. Nếu có, gán vào các nhóm dịch vụ phù hợp trong 11 nhóm của HBG, đánh giá độ khẩn cấp (HOT / WARM / COLD / HOLD) và trích xuất thông tin liên hệ/địa điểm/thời gian/quy mô.

---

### ⚠️ NGUYÊN TẮC BẮT BUỘC VỀ NGUỒN DỮ LIỆU (ĐỘ ƯU TIÊN CAO NHẤT):
1. **CHỈ PHÂN TÍCH ORIGINAL POST (BÀI ĐĂNG GỐC)**:
   - Bỏ qua tuyệt đối tất cả COMMENTS/REPLIES, kể cả comment do chính tác giả bài đăng viết, comment ghim hoặc bình luận nổi bật.
   - TUYỆT ĐỐI KHÔNG lấy buyer intent, dịch vụ, contact (SĐT/Zalo/email), địa điểm, thời gian, quy mô, ngân sách, deadline hay thông tin cập nhật từ bình luận.
2. **QUY TẮC XỬ LÝ KHI THIẾU THÔNG TIN HOẶC CÓ BÌNH LUẬN**:
   - Nếu bài gốc có buyer intent nhưng thiếu contact: Vẫn xử lý theo rule hiện có (buyerIntent: true, decision: "NEW") với \`contact: null\`. Tuyệt đối không tìm kiếm contact trong comment.
   - Nếu bài gốc là quảng cáo của nhà cung cấp, tin tuyển dụng hoặc không có buyer intent: Dù người khác có comment hỏi giá hay đặt dịch vụ, TUYỆT ĐỐI KHÔNG chuyển thành buyer lead (đặt decision: "REJECT", buyerIntent: false).
   - Nếu dữ liệu bài gốc mơ hồ, không đọc đủ hoặc bị che khuất: Xử lý HOLD theo quy tắc hiện hành (decision: "HOLD", requiresHumanReview: true); TUYỆT ĐỐI KHÔNG dùng comment để suy đoán hay lấp chỗ trống.

---

### QUY TẮC PHÂN LOẠI CHI TIẾT THEO MASTER RULES MỚI NHẤT CỦA HBG:

#### 1. XÁC ĐỊNH BUYER INTENT (QUAN TRỌNG NHẤT)
- ✅ CHẤP NHẬN (decision: "NEW"):
  - Người đăng đang tìm kiếm nhà cung cấp (NCC), đối tác, thầu phụ, agency.
  - Cần thuê thiết bị, thuê âm thanh ánh sáng, màn hình LED, thuê địa điểm, phòng hội nghị MICE, sảnh tiệc.
  - Cần book nhân sự biểu diễn hoặc vận hành sự kiện trọn gói: MC, ca sĩ, PG/PB, múa lân, ban nhạc, vũ đoàn, đạo diễn, thợ quay phim/chụp ảnh sự kiện, kỹ thuật viên đi kèm hệ thống thiết bị.
  - Cần đặt tour đoàn, đặt xe du lịch/xe sự kiện đưa đón đoàn, đặt tiệc lưu động (catering, teabreak), vé máy bay đoàn.
  - Có các từ khóa buyer đặc trưng: "cần tìm", "cần thuê", "hỏi giá", "báo giá giúp em", "inbox em", "cần gấp", "ai nhận làm...", "recommend giúp em NCC/agency...".

- ❌ LOẠI BỎ (decision: "REJECT", buyerIntent: false):
  - Bài tự chào bán, quảng cáo dịch vụ của bản thân/công ty (Seller Ads): "Bên em chuyên cung cấp...", "Nhận làm backdrop giá rẻ...", "Em cho thuê xe...".
  - Tin tuyển dụng nhân sự làm việc dài hạn/cố định cho công ty (Job Hiring): tuyển nhân viên kinh doanh, tuyển kế toán, tuyển nhân viên chính thức trả lương tháng.
  - Bài viết spam, chia sẻ kiến thức, review du lịch cá nhân, hỏi đường, hỏi đáp thông thường không có giao dịch thương mại.

---

#### 2. PHẠM VI 11 NHÓM DỊCH VỤ & TIÊU CHÍ LOẠI TRỪ CỐT LÕI (CHỈ ĐƯỢC CHỌN TRONG 11 NHÓM NÀY):

1. **Sự kiện** (Sales: Bích Hiển):
   - Scope: Tổ chức trọn gói event, lễ khai trương, khánh thành, gala dinner, YEP, kỷ niệm thành lập, team building doanh nghiệp, activation, ra mắt sản phẩm (Product Launch), khởi công/động thổ, festival, Family Day, Sport Day, hội nghị khách hàng trọn gói.
   - ❌ LOẠI TRỪ:
     + Tuyển dụng nhân viên event, thực tập sinh event, khóa học event.
     + **Sảnh sự kiện / địa điểm tổ chức sự kiện / tìm địa điểm tổ chức** lẻ (chuyển sang 'Hội nghị MICE' nếu là phòng hội thảo/hội nghị; nếu chỉ hỏi địa điểm ăn chơi/cafe lẻ thì LOẠI TRỪ).
     + **Áo quần sự kiện / trang phục sự kiện lẻ** (không thuộc phạm vi tổ chức sự kiện).

2. **Thiết bị** (Sales: Phương Dung):
   - Scope: Cho thuê âm thanh, ánh sáng, màn hình LED, sân khấu, giàn truss, tivi, máy chiếu, bộ đàm, bàn ghế hội nghị, quạt công nghiệp, nhà bạt; kỹ thuật viên vận hành trực sự kiện đi kèm thiết bị.
   - ❌ LOẠI TRỪ:
     + Mua bán thiết bị, thanh lý, thiết bị cũ, sửa chữa, linh kiện, DIY/tự làm.
     + Loa karaoke gia đình, loa kéo, loa bluetooth cá nhân, thiết bị phòng thu cá nhân.
     + **ĐẶC BIỆT LOẠI TRỪ: "tìm nhân sự", "soundman", "nhân viên"** (tin đăng chỉ tìm/tuyển soundman, tuyển thợ phụ máy, nhân viên chạy việc riêng rẽ mà KHÔNG thuê hệ thống thiết bị).

3. **Media** (Sales: Phương Dung):
   - Scope: Quay phim sự kiện, chụp ảnh sự kiện doanh nghiệp/hội nghị/gala/recap, livestream nhiều máy, video highlight, quay flycam sự kiện, TVC sự kiện.
   - ❌ LOẠI TRỪ:
     + Chụp ảnh cưới, quay phim cưới, wedding.
     + Chụp ảnh cá nhân, gia đình, ảnh thẻ, kỷ yếu học sinh cá nhân.
     + Chụp ảnh sản phẩm, chụp mẫu thời trang, quay video TikTok cá nhân.
     + Khóa học quay/chụp, sửa máy ảnh, review máy ảnh.
     + **ĐẶC BIỆT LOẠI TRỪ: "tìm nhân sự", "nhân viên"** (tin tuyển dụng editor, thợ quay/chụp làm nhân viên dài hạn cho studio/công ty).

4. **Thi công** (Sales: Phương Dung):
   - Scope: Sản xuất và thi công backdrop, gian hàng triển lãm, booth quảng cáo, cổng chào, photo booth, bạt hiflex, formex, alu, cắt chữ mica, biển bảng, in ấn POSM phục vụ sự kiện.
   - ❌ LOẠI TRỪ:
     + Thi công xây dựng nhà, sửa nhà, cải tạo nhà ở, nội thất căn hộ/nhà ở dân dụng, thi công điện nước dân dụng.
     + **ĐẶC BIỆT LOẠI TRỪ: "tìm nhân sự", "nhân viên"** (tuyển thợ phụ công trình, thợ mộc, nhân viên cơ khí dài hạn).

5. **Hội nghị MICE** (Sales: Nhật Chung):
   - Scope: Tìm phòng họp, trung tâm hội nghị tiệc cưới, sảnh khách sạn 4-5 sao, ballroom, phòng hội thảo có sức chứa theo yêu cầu cho doanh nghiệp/tổ chức.
   - ❌ LOẠI TRỪ:
     + Thuê phòng trọ, căn hộ, homestay, văn phòng dài hạn, co-working space dài hạn.
     + Tiệc cưới thuần túy gia đình không có yếu tố MICE.

6. **Tiệc** (Sales: Nhật Chung):
   - Scope: Đặt tiệc teabreak, tiệc trà, finger food, canapé, buffet lưu động, tiệc bàn tròn sự kiện, tiệc gala, cơm đoàn sự kiện, suất ăn công nghiệp phục vụ sự kiện.
   - ❌ LOẠI TRỪ:
     + Khách lẻ/gia đình đi ăn nhà hàng thông thường, quán ăn vặt, mua đồ ăn mang về (takeaway).

7. **Tour Inbound** (Sales: Hà Đỗ):
   - Scope: Đón tiếp khách quốc tế (khách nước ngoài, chuyên gia, đối tác nước ngoài) đến Việt Nam tham quan, hội thảo, làm việc, caravan.
   - ❌ LOẠI TRỪ: Khách Việt đi nước ngoài (Outbound), vé máy bay lẻ, xuất khẩu lao động.

8. **Tour Outbound** (Sales: Hà Đỗ):
   - Scope: Tour du lịch nước ngoài (Thái Lan, Hàn Quốc, Nhật Bản, Trung Quốc, Singapore, Châu Âu, Mỹ...) cho đoàn công ty hoặc khách đoàn/nhóm.
   - ❌ LOẠI TRỪ: Tour trong nước, dịch vụ visa lẻ thuần túy không kèm tour, du học, xuất khẩu lao động.

9. **Tour Nội địa** (Sales: Thùy Anh):
   - Scope: Tour khách đoàn công ty (80%) và khách lẻ/nhóm bạn/gia đình (20%), tour công ty kết hợp Team Building, Gala Dinner.
   - ❌ LOẠI TRỪ:
     + Team Building độc lập, Gala Dinner độc lập (không kèm tour -> là của Sự kiện).
     + Hội nghị/hội thảo thuần túy không kèm tour -> là của Hội nghị MICE.
     + Thuê xe lẻ, đặt phòng khách sạn lẻ, vé máy bay lẻ.
     + **ĐẶC BIỆT LOẠI TRỪ: "tìm địa điểm tổ chức teambuilding"** (bài viết chỉ hỏi xin địa điểm/bãi biển/resort để tự làm teambuilding mà không mua tour).

10. **Xe (QUY TẮC BẮT BUỘC & RẤT NGHIÊM NGẶT - Sales: Thùy Anh)**:
    - ✅ **CHỈ CHẤP NHẬN XE Ô TÔ** (xe 4 chỗ, 7 chỗ, 16 chỗ, 29 chỗ, 35 chỗ, 45 chỗ, Limousine, Dcar...) VÀ **BẮT BUỘC PHẢI PHỤC VỤ CHO DU LỊCH, SỰ KIỆN, HỘI NGHỊ/HỘI THẢO**:
      + Xe phục vụ tour du lịch, company trip, team building, đưa đón đoàn khách tham quan, xe đưa đón sân bay cho khách du lịch/đoàn sự kiện.
      + Xe đưa đón đại biểu hội nghị, khách VIP, nghệ sĩ, diễn giả, ekip, ban tổ chức sự kiện.
      + Xe phục vụ các hoạt động caravan, roadshow, hội thảo MICE.
    - ❌ **TUYỆT ĐỐI LOẠI BỎ (decision: "REJECT", buyerIntent: false)**:
      + **TẤT CẢ CÁC LOẠI XE MÁY, XE MÔ TÔ, XE GẮN MÁY, XE GA, XE SỐ, CÀO CÀO** (Ví dụ: "cần thuê xe máy ở Đà Lạt", "thuê xe máy giá rẻ", "thuê xe số/xe ga", "thuê xe máy đi phượt").
      + Thuê xe ô tô tự lái đi việc cá nhân, về quê, công việc gia đình lẻ tẻ không liên quan đến du lịch/sự kiện/hội nghị.
      + Xe tải chở hàng, xe ba gác, dịch vụ chuyển nhà, chuyển văn phòng.
      + Bán vé xe khách tuyến cố định, xe taxi ghép, xe tiện chuyến cá nhân.

11. **Vé** (Sales: Thùy Anh):
    - Scope: Đặt vé máy bay đoàn, vé tham quan danh lam thắng cảnh đoàn, vé công viên giải trí, vé show nghệ thuật cho đoàn sự kiện/du lịch.
    - ❌ LOẠI TRỪ: Tuyển dụng phi công/tiếp viên hàng không, mô hình máy bay, game, vé miễn phí, mã giảm giá ảo, review hãng bay thuần thông tin.

---

#### 3. ĐÁNH GIÁ ĐỘ NÓNG CỦA LEAD (temperature):
- **HOT**: Nhu cầu cực gấp (hôm nay, ngày mai, tuần này, sát ngày), có ngày giờ cụ thể rõ ràng, xin báo giá gấp, để lại SĐT/Zalo thúc giục gọi ngay, cần gửi báo giá trước thời hạn cụ thể.
- **WARM**: Đang lên kế hoạch cho tháng tới / quý tới / cuối năm, cần khảo sát báo giá, tìm kiếm phương án so sánh, tham khảo lịch trình/dịch vụ.
- **COLD**: Nhu cầu xa hoặc chỉ hỏi kinh nghiệm/mùa đẹp/ảnh điểm đến mà chưa có kế hoạch cụ thể.
- **HOLD**: Thông tin mơ hồ, nghi ngờ spam hoặc cần nhân sự HBG rà soát lại thủ công.

#### 4. TRÍCH XUẤT THÔNG TIN CỐT LÕI:
- needSummary: Tóm tắt cực kỳ ngắn gọn và súc tích nhu cầu chính của khách (dưới 20 từ).
- location: Địa điểm tổ chức hoặc khu vực cần phục vụ (Hà Nội, HCM, Đà Nẵng, Phú Quốc...). Nếu không nhắc đến trả về null.
- eventDate: Thời gian diễn ra sự kiện/dịch vụ (ví dụ: "15/10", "cuối tuần này", "tối 24/12"). Nếu không rõ trả về null.
- scale: Quy mô số lượng (ví dụ: "300 khách", "xe 45 chỗ", "100 suất teabreak"). Nếu không rõ trả về null.
- contact: Số điện thoại hoặc Zalo liên hệ nếu có trong bài viết (trả về chuỗi số sạch) hoặc null.
- confidence: Điểm tin cậy từ 0.0 đến 1.0 về quyết định phân loại này.
- exclusionReason: Lý do từ chối nếu buyerIntent=false hoặc decision="REJECT", nếu không thì null.
- requiresHumanReview: true nếu thông tin mâu thuẫn hoặc cần người kiểm tra lại, còn lại false.`;

export async function classify(post: RawPost | OriginalPostOnly, rules: ProductRule[]): Promise<Classification> {
  // Whitelist và chuẩn hóa CHỈ DỮ LIỆU BÀI ĐĂNG GỐC (Original Post Only)
  const originalPost = toOriginalPostOnly(post);

  // Xử lý trường hợp bài đăng gốc bị che hoặc không tách rõ DOM theo quy định (T09)
  if (originalPost.isUnclearOrObscured || !originalPost.content || originalPost.content.trim().length < 5) {
    return {
      buyerIntent: false,
      decision: 'HOLD',
      services: [],
      temperature: 'HOLD',
      needSummary: 'Nội dung bài đăng gốc bị che khuất hoặc không tách rõ DOM; HOLD chờ rà soát thủ công',
      location: null,
      eventDate: null,
      scale: null,
      contact: null,
      exclusionReason: 'Nội dung bài đăng gốc không thể tách rõ từ DOM; không sử dụng bình luận để lấp chỗ trống.',
      confidence: 0.5,
      requiresHumanReview: true
    };
  }

  const userContent = `Nhóm: ${originalPost.groupName || 'N/A'}\nTác giả bài đăng gốc: ${originalPost.author || 'N/A'}\nThời gian đăng bài gốc: ${originalPost.postedLabel || originalPost.createdAt || 'N/A'}\nNội dung bài đăng gốc (CHỈ BÀI ĐĂNG GỐC - TUYỆT ĐỐI KHÔNG BAO GỒM BÌNH LUẬN):\n${originalPost.content}`;

  const response = await getAiClient().responses.parse({
    model: env.OPENAI_MODEL,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      // Few-shot Example 1: Valid HOT lead (Thiết bị + Hội nghị MICE)
      {
        role: 'user',
        content: `Nhóm: Hội Âm Thanh Ánh Sáng Sự Kiện Miền Bắc\nTác giả: Nguyễn Văn An\nNội dung bài viết:\nEm cần gấp 1 bộ âm thanh + màn LED P3 khoảng 15m2 phục vụ hội thảo 200 khách tại Cầu Giấy sáng mai 15/10. Bác nào rảnh đồ báo giá và gửi cấu hình qua Zalo 0912.345.678 giúp em với ạ.`
      },
      {
        role: 'assistant',
        content: JSON.stringify({
          buyerIntent: true,
          decision: 'NEW',
          services: ['Thiết bị', 'Hội nghị MICE'],
          temperature: 'HOT',
          needSummary: 'Cần gấp âm thanh và màn LED P3 15m2 cho hội thảo 200 khách tại Cầu Giấy sáng mai',
          location: 'Cầu Giấy, Hà Nội',
          eventDate: 'Sáng mai 15/10',
          scale: '200 khách, LED 15m2',
          contact: '0912345678',
          exclusionReason: null,
          confidence: 0.98,
          requiresHumanReview: false
        })
      },
      // Few-shot Example 2: Seller Ads (REJECT)
      {
        role: 'user',
        content: `Nhóm: Cộng Đồng Làm Event & Truyền Thông\nTác giả: Xưởng In & Thi Công Ánh Dương\nNội dung bài viết:\nBên em chuyên in bạt hiflex giá chỉ từ 25k/m2, thi công backdrop trọn gói tại Hà Nội giá sinh viên. Anh chị em làm sự kiện cần hợp tác liên hệ hotline 0909.111.222.`
      },
      {
        role: 'assistant',
        content: JSON.stringify({
          buyerIntent: false,
          decision: 'REJECT',
          services: ['Thi công'],
          temperature: 'COLD',
          needSummary: 'Quảng cáo dịch vụ in ấn và thi công backdrop giá rẻ',
          location: 'Hà Nội',
          eventDate: null,
          scale: null,
          contact: '0909111222',
          exclusionReason: 'Bài viết chào bán dịch vụ (Seller Ads), không có nhu cầu mua/thuê',
          confidence: 0.99,
          requiresHumanReview: false
        })
      },
      // Few-shot Example 3: Soundman / Nhân viên thiết bị đơn lẻ (REJECT)
      {
        role: 'user',
        content: `Nhóm: Hội Âm Thanh Ánh Sáng Sự Kiện\nTác giả: Minh Tuấn\nNội dung bài viết:\nCần tìm 1 bạn soundman chỉnh mixer ngày 20/10 tại Hà Nội, đồ bên mình có sẵn hết rồi chỉ cần người bấm máy. Ai rảnh inbox giá công nhật.`
      },
      {
        role: 'assistant',
        content: JSON.stringify({
          buyerIntent: false,
          decision: 'REJECT',
          services: ['Thiết bị'],
          temperature: 'COLD',
          needSummary: 'Tìm soundman bấm máy ngày 20/10 đồ có sẵn',
          location: 'Hà Nội',
          eventDate: '20/10',
          scale: null,
          contact: null,
          exclusionReason: 'Dịch vụ Thiết bị loại trừ tin chỉ tìm nhân sự/soundman/nhân viên thuần túy mà không thuê hệ thống thiết bị.',
          confidence: 0.98,
          requiresHumanReview: false
        })
      },
      // Few-shot Example 4: Motorbike rental strictly REJECTED for Xe
      {
        role: 'user',
        content: `Nhóm: Đà Lạt Review Du Lịch Tất Tần Tật\nTác giả: Uyên Võ\nNội dung bài viết:\nCần thuê xe máy Đà Lạt giá 100k/ngày từ ngày 3 đến 5/10, ai có xe ga hoặc xe số ngon inbox mình.`
      },
      {
        role: 'assistant',
        content: JSON.stringify({
          buyerIntent: false,
          decision: 'REJECT',
          services: ['Xe'],
          temperature: 'COLD',
          needSummary: 'Cần thuê xe máy tại Đà Lạt giá 100k/ngày',
          location: 'Đà Lạt',
          eventDate: '3-5/10',
          scale: null,
          contact: null,
          exclusionReason: 'Dịch vụ Xe chỉ nhận xe ô tô phục vụ du lịch, sự kiện, hội nghị. Loại trừ toàn bộ xe máy, xe mô tô.',
          confidence: 0.99,
          requiresHumanReview: false
        })
      },
      // Few-shot Example 5: Valid Tour/Event Automobile
      {
        role: 'user',
        content: `Nhóm: Hội Xe Du Lịch Miền Bắc\nTác giả: Hoàng Minh\nNội dung bài viết:\nBên mình cần thuê 1 xe 29 chỗ hoặc 45 chỗ đưa đón đoàn 35 khách đi tour du lịch Hạ Long 3N2Đ xuất phát từ Hà Nội ngày 20/10. Ai nhận báo giá giúp qua Zalo 0987.654.321.`
      },
      {
        role: 'assistant',
        content: JSON.stringify({
          buyerIntent: true,
          decision: 'NEW',
          services: ['Xe', 'Tour Nội địa'],
          temperature: 'HOT',
          needSummary: 'Cần xe ô tô 29 hoặc 45 chỗ đưa đón đoàn 35 khách du lịch Hà Nội - Hạ Long ngày 20/10',
          location: 'Hà Nội - Hạ Long',
          eventDate: '20/10',
          scale: '35 khách, xe 29/45 chỗ',
          contact: '0987654321',
          exclusionReason: null,
          confidence: 0.98,
          requiresHumanReview: false
        })
      },
      // Few-shot Example 6: Chỉ hỏi địa điểm Teambuilding lẻ không mua tour (REJECT)
      {
        role: 'user',
        content: `Nhóm: Cộng Đồng Nhân Sự HR Việt Nam\nTác giả: Lan Anh\nNội dung bài viết:\nCả nhà ơi recommend giúp em bãi biển hoặc resort nào gần Hà Nội có bãi cỏ rộng để tự tổ chức teambuilding cho công ty với ạ, bên em tự lo trò chơi.`
      },
      {
        role: 'assistant',
        content: JSON.stringify({
          buyerIntent: false,
          decision: 'REJECT',
          services: ['Tour Nội địa', 'Sự kiện'],
          temperature: 'COLD',
          needSummary: 'Hỏi địa điểm/resort bãi cỏ rộng tự tổ chức teambuilding',
          location: 'Gần Hà Nội',
          eventDate: null,
          scale: null,
          contact: null,
          exclusionReason: 'Loại trừ bài viết chỉ hỏi tìm địa điểm tổ chức teambuilding lẻ mà không có nhu cầu mua tour hoặc thuê sự kiện trọn gói.',
          confidence: 0.97,
          requiresHumanReview: false
        })
      },
      // Actual post to classify
      { role: 'user', content: userContent }
    ],
    text: { format: zodTextFormat(schema, 'lead_classification') }
  });

  if (!response.output_parsed) throw new Error('CLASSIFICATION_EMPTY');
  const result = response.output_parsed as Classification;

  // Lớp bảo vệ bổ sung (Safeguards):

  // 0. Safeguard BẮT BUỘC: Đảm bảo SĐT liên hệ CHỈ ĐƯỢC CÔNG NHẬN nếu xuất hiện trong chính bài đăng gốc.
  // Tuyệt đối không nhận SĐT lấy từ comment hoặc suy diễn.
  if (result.contact) {
    const cleanDigits = result.contact.replace(/\D/g, '');
    const contentDigits = originalPost.content.replace(/\D/g, '');
    if (!cleanDigits || !contentDigits.includes(cleanDigits)) {
      result.contact = null;
    }
  }

  // 1. Safeguard cho dịch vụ Xe: Chỉ nhận xe ô tô du lịch/sự kiện, loại trừ xe máy và xe tải
  if (result.services.includes('Xe')) {
    const textLower = originalPost.content.toLowerCase();
    const isMotorbikeOrFreight = /\b(xe máy|xe may|xe gắn máy|xe gan may|xe mô tô|xe moto|xe số|xe so|xe ga|cào cào|cao cao|vision|air blade|airblade|lead|sh mode|wave|sirius|exciter|winner|xe tải|xe tai|chuyển nhà|chuyen nha|chở hàng|cho hang)\b/i.test(textLower);

    if (isMotorbikeOrFreight) {
      if (result.services.length === 1) {
        result.buyerIntent = false;
        result.decision = 'REJECT';
        result.exclusionReason = 'Dịch vụ Xe chỉ nhận xe ô tô phục vụ du lịch, sự kiện, hội nghị. Loại trừ xe máy và xe tải chở hàng.';
      } else {
        result.services = result.services.filter(s => s !== 'Xe') as any;
      }
    }
  }

  // 2. Safeguard cho dịch vụ Thiết bị: Loại trừ tin chỉ thuê/tìm nhân sự, soundman lẻ
  if (result.services.includes('Thiết bị') && result.decision === 'NEW') {
    const textLower = originalPost.content.toLowerCase();
    const isSoundmanOrStaffOnly = /\b(cần soundman|tìm soundman|thuê soundman|tuyển soundman|chỉ cần soundman|cần người bấm máy|tìm người trực|cần phụ máy)\b/i.test(textLower)
      && !/\b(thuê âm thanh|thuê ánh sáng|thuê màn hình led|thuê led|thuê sân khấu|thuê trọn gói)\b/i.test(textLower);

    if (isSoundmanOrStaffOnly) {
      if (result.services.length === 1) {
        result.buyerIntent = false;
        result.decision = 'REJECT';
        result.exclusionReason = 'Dịch vụ Thiết bị loại trừ tin chỉ tìm nhân sự/soundman/nhân viên mà không thuê hệ thống thiết bị.';
      } else {
        result.services = result.services.filter(s => s !== 'Thiết bị') as any;
      }
    }
  }

  // 3. Safeguard cho Sự kiện: Loại trừ tin chỉ hỏi thuê áo quần/trang phục sự kiện lẻ
  if (result.services.includes('Sự kiện') && result.decision === 'NEW') {
    const textLower = originalPost.content.toLowerCase();
    const isCostumeOnly = /\b(thuê áo dài|thuê trang phục|thuê quần áo|áo quần sự kiện|thuê mascot|thuê váy)\b/i.test(textLower)
      && !/\b(tổ chức|trọn gói|sự kiện|event|gala|khai trương|khánh thành)\b/i.test(textLower);

    if (isCostumeOnly) {
      if (result.services.length === 1) {
        result.buyerIntent = false;
        result.decision = 'REJECT';
        result.exclusionReason = 'Dịch vụ Sự kiện loại trừ bài đăng chỉ tìm thuê trang phục/áo quần sự kiện lẻ.';
      } else {
        result.services = result.services.filter(s => s !== 'Sự kiện') as any;
      }
    }
  }

  return result;
}
