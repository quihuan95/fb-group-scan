import OpenAI from'openai';import{z}from'zod';import{zodTextFormat}from'openai/helpers/zod';import{env}from'../config/env.js';import type{RawPost,ProductRule,Classification}from'../types/index.js';
const schema=z.object({buyerIntent:z.boolean(),decision:z.enum(['NEW','UPDATE','DUPLICATE','HOLD','REJECT']),services:z.array(z.enum(['Sự kiện','Thiết bị','Media','Thi công','Hội nghị MICE','Tiệc','Tour Inbound','Tour Outbound','Tour Nội địa','Xe','Vé'])),temperature:z.enum(['HOT','WARM','COLD','HOLD']),needSummary:z.string(),location:z.string().nullable(),eventDate:z.string().nullable(),scale:z.string().nullable(),contact:z.string().nullable(),exclusionReason:z.string().nullable(),confidence:z.number().min(0).max(1),requiresHumanReview:z.boolean()});
const client=new OpenAI({apiKey:env.OPENAI_API_KEY});
const SYSTEM_PROMPT=`Bạn là trợ lý AI chuyên phân loại lead bán hàng B2B từ bài viết Facebook Group ngành Sự kiện, Du lịch, MICE.

QUY TẮC PHÂN LOẠI:
1. BUYER INTENT (Có nhu cầu mua/thuê thật):
- CHẤP NHẬN (NEW): Người đăng đang tìm nhà cung cấp (NCC), thuê thiết bị, tìm đối tác, thuê freelancer, crew, thợ thi công, MC, ca sĩ, ban nhạc, địa điểm tổ chức, tour, xe, tiệc... cho sự kiện hoặc chương trình cụ thể.
- LOẠI BỎ (REJECT): Bài tự quảng cáo bán hàng/chào giá (seller ads), tin tuyển dụng nhân sự dài hạn vào công ty, bài chia sẻ/spam/hỏi đáp thông thường không có nhu cầu thuê/mua.

2. CHỈ GÁN VÀO 11 NHÓM DỊCH VỤ SAU:
- Sự kiện (tổ chức event, gala, khai trương, khánh thành, activation, festival...)
- Thiết bị (âm thanh, ánh sáng, màn hình LED, sân khấu, vách ngăn, bàn ghế, bộ đàm, TV...)
- Media (quay phim, chụp ảnh sự kiện, livestream, sản xuất video...)
- Thi công (sản xuất backdrop, gian hàng triển lãm, booth, cổng chào, biển bảng...)
- Hội nghị MICE (hội thảo, hội nghị khách hàng, workshop, phòng họp, địa điểm MICE...)
- Tiệc (catering, tiệc trà teabreak, tiệc finger food, buffet, cơm đoàn...)
- Tour Inbound, Tour Outbound, Tour Nội địa
- Xe (thuê xe du lịch, xe đưa đón sự kiện, xe hợp đồng...)
- Vé (vé máy bay, vé tham quan sự kiện...)

3. ĐÁNH GIÁ ĐỘ NÓNG (temperature):
- HOT: Cần gấp, cần ngay trong tuần, có ngày giờ cụ thể, sẵn sàng chốt.
- WARM: Đang tham khảo báo giá, cần tư vấn phương án, tìm kiếm thông thường.
- COLD: Nhu cầu xa hoặc chưa rõ ràng.

4. TRÍCH XUẤT THÔNG TIN:
- location: Địa điểm/khu vực cần tổ chức hoặc thuê (ví dụ: Hà Nội, Bắc Ninh, TP.HCM, Grand Hồ Tràm...) hoặc null.
- eventDate: Thời gian dự kiến sử dụng dịch vụ (ví dụ: 17/10, đầu tháng 12, ngày mai...) hoặc null.
- scale: Quy mô khách hoặc số lượng cần thuê (ví dụ: 600 khách, 1 TV 40 inch, vũ đoàn 6 người...) hoặc null.
- contact: Số điện thoại hoặc Zalo nếu có trong bài, hoặc null.`;

export async function classify(post:RawPost,rules:ProductRule[]):Promise<Classification>{
  const userContent=`Nhóm: ${post.groupName}\nTác giả: ${post.author}\nNội dung bài viết:\n${post.text}`;
  const response=await client.responses.parse({
    model:env.OPENAI_MODEL,
    input:[
      {role:'system',content:SYSTEM_PROMPT},
      {role:'user',content:userContent}
    ],
    text:{format:zodTextFormat(schema,'lead_classification')}
  });
  if(!response.output_parsed)throw new Error('CLASSIFICATION_EMPTY');
  return response.output_parsed as Classification;
}
