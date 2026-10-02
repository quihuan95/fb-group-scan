import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../config/env.js';
import type { RawPost, ProductRule, Classification } from '../types/index.js';

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
2. Nếu có, gán vào các nhóm dịch vụ phù hợp, đánh giá độ khẩn cấp (nhiệt độ lead) và trích xuất thông tin liên hệ/địa điểm/thời gian.

---

### QUY TẮC PHÂN LOẠI CHI TIẾT:

#### 1. XÁC ĐỊNH BUYER INTENT (QUAN TRỌNG NHẤT)
- ✅ CHẤP NHẬN (decision: "NEW"):
  - Người đăng đang tìm kiếm nhà cung cấp (NCC), đối tác, thầu phụ, agency.
  - Cần thuê thiết bị, thuê âm thanh ánh sáng, màn hình LED, thuê địa điểm, phòng hội nghị.
  - Cần book nhân sự biểu diễn hoặc vận hành sự kiện: MC, ca sĩ, PG/PB, múa lân, ban nhạc, vũ đoàn, đạo diễn, thợ quay phim/chụp ảnh, kỹ thuật viên, đội thi công dựng booth...
  - Cần đặt tour đoàn, đặt xe đưa đón đoàn, đặt tiệc lưu động (catering, teabreak), vé máy bay đoàn.
  - Có các từ khóa buyer đặc trưng: "cần tìm", "cần thuê", "hỏi giá", "báo giá giúp em", "inbox em", "cần gấp", "ai nhận làm...", "recommend giúp em NCC...".

- ❌ LOẠI BỎ (decision: "REJECT", buyerIntent: false):
  - Bài tự chào bán, quảng cáo dịch vụ của bản thân/công ty (Seller Ads): "Bên em chuyên cung cấp...", "Nhận làm backdrop giá rẻ...", "Em cho thuê xe...".
  - Tin tuyển dụng nhân sự làm việc dài hạn/cố định cho công ty (Job Hiring): tuyển nhân viên kinh doanh, tuyển kế toán, tuyển nhân viên chính thức trả lương tháng.
  - Bài viết spam, chia sẻ kiến thức, review du lịch cá nhân, hỏi đường, hỏi đáp thông thường không có giao dịch thương mại.

#### 2. PHẠM VI 11 NHÓM DỊCH VỤ (CHỈ ĐƯỢC CHỌN TRONG DANH SÁCH NÀY):
1. **Sự kiện**: Tổ chức trọn gói event, lễ khai trương, khánh thành, gala dinner, kỷ niệm, team building, activation, ra mắt sản phẩm, festival.
2. **Thiết bị**: Cho thuê âm thanh, ánh sáng, màn hình LED, sân khấu, giàn truss, tivi, máy chiếu, bộ đàm, bàn ghế hội nghị, quạt công nghiệp, nhà bạt.
3. **Media**: Quay phim sự kiện, chụp ảnh phóng sự/truyền thống, livestream nhiều máy, sản xuất video highlight, quay flycam, recap video.
4. **Thi công**: In ấn, sản xuất và thi công backdrop, gian hàng triển lãm, booth quảng cáo, cổng chào, bạt hiflex, formex, alu, cắt chữ mica.
5. **Hội nghị MICE**: Tìm phòng họp, trung tâm hội nghị tiệc cưới, sảnh khách sạn 4-5 sao, phòng hội thảo có sức chứa theo yêu cầu.
6. **Tiệc**: Đặt tiệc teabreak, tiệc finger food, buffet lưu động, tiệc bàn tròn sự kiện, cơm đoàn, suất ăn công nghiệp cho sự kiện.
7. **Tour Nội địa**: Tổ chức tour du lịch trong nước, tour công ty, tour học sinh, tour trekking, caravan.
8. **Tour Outbound**: Đặt tour du lịch nước ngoài (Thái Lan, Hàn Quốc, Nhật Bản, Trung Quốc, Châu Âu...).
9. **Tour Inbound**: Tour đón tiếp khách quốc tế đến tham quan, hội thảo, làm việc tại Việt Nam.
10. **Xe (QUY TẮC BẮT BUỘC & RẤT NGHIÊM NGẶT)**:
    - ✅ **CHỈ CHẤP NHẬN XE Ô TÔ** (xe 4 chỗ, 7 chỗ, 16 chỗ, 29 chỗ, 35 chỗ, 45 chỗ, Limousine, Dcar...) VÀ **BẮT BUỘC PHẢI PHỤC VỤ CHO DU LỊCH, SỰ KIỆN, HỘI NGHỊ/HỘI THẢO**:
      + Xe phục vụ tour du lịch, company trip, team building, đưa đón đoàn khách tham quan, xe đưa đón sân bay cho khách du lịch/đoàn sự kiện.
      + Xe đưa đón đại biểu hội nghị, khách VIP, nghệ sĩ, diễn giả, ekip, ban tổ chức sự kiện.
      + Xe phục vụ các hoạt động caravan, roadshow, hội thảo MICE.
    - ❌ **TUYỆT ĐỐI LOẠI BỎ (decision: "REJECT", buyerIntent: false)**:
      + **TẤT CẢ CÁC LOẠI XE MÁY, XE MÔ TÔ, XE GẮN MÁY, XE GA, XE SỐ, CÀO CÀO** (Ví dụ: "cần thuê xe máy ở Đà Lạt", "thuê xe máy giá rẻ", "thuê xe số/xe ga", "thuê xe máy đi phượt").
      + Thuê xe ô tô tự lái đi việc cá nhân, về quê, công việc gia đình lẻ tẻ không liên quan đến du lịch/sự kiện/hội nghị.
      + Xe tải chở hàng, xe ba gác, dịch vụ chuyển nhà, chuyển văn phòng.
      + Bán vé xe khách tuyến cố định, xe taxi ghép, xe tiện chuyến cá nhân.
11. **Vé**: Đặt vé máy bay theo đoàn sự kiện, vé tham quan danh lam thắng cảnh, vé công viên giải trí, vé show nghệ thuật.

#### 3. ĐÁNH GIÁ ĐỘ NÓNG CỦA LEAD (temperature):
- **HOT**: Nhu cầu cực gấp (trong ngày, ngày mai, tuần này), có ngày giờ cụ thể rõ ràng, để lại SĐT/Zalo thúc giục gọi ngay.
- **WARM**: Đang lên kế hoạch cho tháng tới, cần khảo sát báo giá, tìm kiếm phương án so sánh, ngày tổ chức cách 2-4 tuần.
- **COLD**: Nhu cầu xa (quý sau, cuối năm), khảo sát ý kiến sơ bộ, chưa có ngân sách hay thời gian cụ thể.
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

export async function classify(post: RawPost, rules: ProductRule[]): Promise<Classification> {
  const userContent = `Nhóm: ${post.groupName}\nTác giả: ${post.author}\nNội dung bài viết:\n${post.text}`;

  const response = await getAiClient().responses.parse({
    model: env.OPENAI_MODEL,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      // Few-shot Example 1: Valid HOT lead
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
      // Few-shot Example 2: Seller Ads
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
      // Few-shot Example 3: Job Hiring
      {
        role: 'user',
        content: `Nhóm: Tuyển Dụng Du Lịch & MICE Toàn Quốc\nTác giả: HR Công ty Du Lịch ABC\nNội dung bài viết:\nCần tuyển gấp 2 Sale Tour Inbound và 1 kế toán nội bộ làm việc tại VP Quận 1. Lương cứng 10tr + hoa hồng. Đi làm ngay.`
      },
      {
        role: 'assistant',
        content: JSON.stringify({
          buyerIntent: false,
          decision: 'REJECT',
          services: ['Tour Inbound'],
          temperature: 'COLD',
          needSummary: 'Tuyển nhân viên kinh doanh và kế toán dài hạn cho công ty',
          location: 'Quận 1, TP.HCM',
          eventDate: null,
          scale: '2 Sale, 1 Kế toán',
          contact: null,
          exclusionReason: 'Tuyển dụng nhân sự dài hạn nội bộ, không phải mua bán/thuê dịch vụ MICE',
          confidence: 0.99,
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
      // Actual post to classify
      { role: 'user', content: userContent }
    ],
    text: { format: zodTextFormat(schema, 'lead_classification') }
  });

  if (!response.output_parsed) throw new Error('CLASSIFICATION_EMPTY');
  const result = response.output_parsed as Classification;

  // Lớp bảo vệ bổ sung (Safeguard) cho dịch vụ Xe:
  // Chỉ nhận xe ô tô phục vụ du lịch, sự kiện, hội nghị.
  // Loại trừ tuyệt đối xe máy, xe mô tô, xe gắn máy, xe cào cào, xe tải chở hàng...
  if (result.services.includes('Xe')) {
    const textLower = (post.text || '').toLowerCase();
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

  return result;
}
