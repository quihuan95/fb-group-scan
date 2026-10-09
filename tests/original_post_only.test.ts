import { describe, it, expect } from 'vitest';
import { toOriginalPostOnly, contactKey, fingerprint, canonicalFacebookUrl } from '../src/utils/normalize.js';
import { decideDuplicate } from '../src/dedup/engine.js';
import { formatRawDataRow } from '../src/sheets/repository.js';
import type { Candidate, RawPost } from '../src/types/index.js';

describe('Original Post Only (Loại bỏ hoàn toàn Facebook Comments)', () => {
  // T12: Scraper trả object có cả postText/text lẫn comments -> Whitelist loại bỏ hoàn toàn comments
  it('T12: strips all comment fields and whitelists only original post data', () => {
    const scraperOutputWithComments = {
      groupStt: 1,
      groupName: 'Hội Sự Kiện Miền Bắc',
      canonicalGroupUrl: 'https://www.facebook.com/groups/eventmb',
      author: 'Nguyễn Văn A',
      authorUrl: 'https://www.facebook.com/user/10001',
      postedLabel: '2 giờ',
      permalink: 'https://www.facebook.com/groups/eventmb/posts/111222333/',
      text: 'Cần tìm đơn vị tổ chức hội nghị 300 khách tại Hà Nội.',
      originalBodyText: 'Cần tìm đơn vị tổ chức hội nghị 300 khách tại Hà Nội.',
      images: ['https://example.com/img1.jpg'],
      // Dữ liệu bình luận bị cấm (Scraper hoặc API trả về):
      comments: [
        { author: 'NCC B', text: 'Bên em nhận nhé, liên hệ 0988.888.888', createdAt: 'vừa xong' },
        { author: 'Nguyễn Văn A', text: 'SĐT của mình là 0911.222.333', createdAt: '1 phút' }
      ],
      commentCountText: '15 bình luận',
      commentThreads: ['thread_1', 'thread_2'],
      replies: ['reply_1']
    };

    const originalOnly = toOriginalPostOnly(scraperOutputWithComments as any);

    // Xác nhận whitelist:
    expect(originalOnly.author).toBe('Nguyễn Văn A');
    expect(originalOnly.content).toBe('Cần tìm đơn vị tổ chức hội nghị 300 khách tại Hà Nội.');
    expect(originalOnly.contact).toBeNull(); // Không lấy SĐT 0911.222.333 từ comment của tác giả
    expect((originalOnly as any).comments).toBeUndefined();
    expect((originalOnly as any).commentCountText).toBeUndefined();
    expect((originalOnly as any).commentThreads).toBeUndefined();
    expect((originalOnly as any).replies).toBeUndefined();
    expect(originalOnly.attachments).toEqual(['https://example.com/img1.jpg']);
  });

  // T01: Bài đăng gốc có nhu cầu và SĐT, comment có NCC quảng cáo -> Chỉ dùng nhu cầu và contact trong bài gốc
  it('T01: uses buyer intent and contact from original post, ignores NCC comment', () => {
    const postWithPhone = {
      groupStt: 2,
      groupName: 'Hội Âm Thanh Ánh Sáng',
      author: 'Trần Văn B',
      permalink: 'https://www.facebook.com/groups/av/posts/222333444/',
      text: 'Cần thuê màn LED P3 cho hội nghị 200 khách tại Cầu Giấy, liên hệ 0912.345.678.',
      comments: [
        { author: 'Kho Led Pro', text: 'Bên em chuyên LED giá rẻ 0999.000.111' }
      ]
    };

    const originalOnly = toOriginalPostOnly(postWithPhone as any);
    expect(originalOnly.content).toContain('Cần thuê màn LED P3');
    expect(originalOnly.contact).toBe('0912.345.678');
    expect(originalOnly.content).not.toContain('Kho Led Pro');
    expect(originalOnly.content).not.toContain('0999.000.111');
  });

  // T02: Bài đăng gốc có nhu cầu nhưng KHÔNG có SĐT, tác giả comment SĐT -> contact = null
  it('T02: preserves buyer intent with contact = null when author comments phone in comment', () => {
    const postWithoutPhone = {
      groupStt: 3,
      groupName: 'Cộng Đồng Event',
      author: 'Lê C',
      permalink: 'https://www.facebook.com/groups/event/posts/333444555/',
      text: 'Cần đơn vị tổ chức sự kiện khai trương showroom tại Ba Đình.',
      // Tác giả tự bình luận số điện thoại:
      comments: [
        { author: 'Lê C', text: 'Ai nhận inbox hoặc liên hệ Zalo em 0909.888.777 ạ' }
      ]
    };

    const originalOnly = toOriginalPostOnly(postWithoutPhone as any);
    expect(originalOnly.content).toBe('Cần đơn vị tổ chức sự kiện khai trương showroom tại Ba Đình.');
    // Contact của bài gốc phải là null:
    expect(originalOnly.contact).toBeNull();
  });

  // T03: Bài đăng gốc là check-in, người khác comment cần thuê xe 45 chỗ -> Không tạo lead từ comment
  it('T03: does not create buyer lead from comment when original post is non-commercial', () => {
    const checkinPost = {
      groupStt: 4,
      groupName: 'Hội Du Lịch',
      author: 'Hoàng D',
      permalink: 'https://www.facebook.com/groups/dulich/posts/444555666/',
      text: 'Check-in cuối tuần cùng cả nhà tại Tam Đảo, không khí tuyệt vời!',
      // Người khác nhảy vào comment tìm xe:
      comments: [
        { author: 'Khách X', text: 'Em cần thuê xe 45 chỗ đi Tam Đảo sáng mai, ai có xe báo giá 0918.777.666' }
      ]
    };

    const originalOnly = toOriginalPostOnly(checkinPost as any);
    expect(originalOnly.content).toBe('Check-in cuối tuần cùng cả nhà tại Tam Đảo, không khí tuyệt vời!');
    expect(originalOnly.content).not.toContain('thuê xe 45 chỗ');
    expect(originalOnly.contact).toBeNull();
  });

  // T04: Quảng cáo dịch vụ của NCC, comment hỏi giá dịch vụ -> Không chuyển quảng cáo thành buyer lead
  it('T04: keeps seller ads as seller ads without converting into buyer lead from comments', () => {
    const sellerPost = {
      groupStt: 5,
      groupName: 'Hội In Ấn Quảng Cáo',
      author: 'Xưởng In Kim Cương',
      permalink: 'https://www.facebook.com/groups/inan/posts/555666777/',
      text: 'Bên em chuyên in bạt hiflex giá 25k/m2, thi công backdrop trọn gói Hà Nội hotline 0901.234.567.',
      comments: [
        { author: 'Khách Y', text: 'Báo giá em backdrop 3x4m tại Hoàn Kiếm với ạ' }
      ]
    };

    const originalOnly = toOriginalPostOnly(sellerPost as any);
    expect(originalOnly.content).toContain('Bên em chuyên in bạt hiflex');
    expect(originalOnly.content).not.toContain('Báo giá em backdrop 3x4m');
  });

  // T05: Bài gốc đăng ngoài Scan Window, comment mới đăng hôm nay -> Không lấy bài dựa vào ngày comment
  it('T05: uses original post timestamp only, ignoring newer comment timestamps', () => {
    const oldPostWithNewComment = {
      groupStt: 6,
      groupName: 'Hội Sự Kiện',
      author: 'Vũ E',
      permalink: 'https://www.facebook.com/groups/event/posts/666777888/',
      postedLabel: '3 ngày', // Bài gốc đăng 3 ngày trước (ngoài Scan Window 24h)
      text: 'Cần tìm đối tác âm thanh ánh sáng cho gala.',
      comments: [
        { author: 'Bình Luận Mới', text: 'Chấm', postedLabel: 'vừa xong' } // Comment mới đăng
      ]
    };

    const originalOnly = toOriginalPostOnly(oldPostWithNewComment as any);
    expect(originalOnly.postedLabel).toBe('3 ngày');
    expect(originalOnly.createdAt).toBe('3 ngày');
    // Kiểm tra logic xác định bài cũ dựa vào postedLabel:
    const isOlder = (t?: string) => {
      if (!t) return false;
      const s = t.toLowerCase();
      const d = s.match(/(\d+)\s*ngày/);
      if (d) return +d[1] > 1;
      return /tháng|năm|20\d{2}/i.test(s);
    };
    expect(isOlder(originalOnly.postedLabel)).toBe(true);
  });

  // T06: Bài gốc thiếu địa điểm, ngày và số lượng, comment bổ sung -> Các trường thiếu vẫn là null
  it('T06: leaves missing fields as null rather than taking them from comments', () => {
    const incompletePost = {
      groupStt: 7,
      groupName: 'Hội MICE',
      author: 'Đặng F',
      permalink: 'https://www.facebook.com/groups/mice/posts/777888999/',
      text: 'Cần tìm phòng họp hội thảo cho công ty.',
      comments: [
        { author: 'Đặng F', text: 'Bổ sung: Cần phòng 100 người tại Hà Nội ngày 25/10 nhé cả nhà' }
      ]
    };

    const originalOnly = toOriginalPostOnly(incompletePost as any);
    expect(originalOnly.content).toBe('Cần tìm phòng họp hội thảo cho công ty.');
    expect(originalOnly.content).not.toContain('100 người');
    expect(originalOnly.content).not.toContain('Hà Nội ngày 25/10');
  });

  // T07: Bài gốc có Xem thêm và bên dưới có Xem thêm bình luận, bình luận chứa SĐT -> Chỉ giữ text bài gốc
  it('T07: extracts only expanded post body and does not include comment text or phone', () => {
    const postWithSeeMore = {
      groupStt: 8,
      groupName: 'Hội Team Building',
      author: 'Phạm G',
      permalink: 'https://www.facebook.com/groups/tb/posts/888999000/',
      text: 'Công ty mình dự kiến tổ chức team building cho 80 nhân sự vào tháng 11 tại Hạ Long. Yêu cầu bãi biển rộng và kịch bản hấp dẫn.',
      comments: [
        { author: 'Agency H', text: 'Inbox em nhé 0977.111.222', commentButtons: ['Xem thêm bình luận'] }
      ]
    };

    const originalOnly = toOriginalPostOnly(postWithSeeMore as any);
    expect(originalOnly.content).toContain('80 nhân sự vào tháng 11 tại Hạ Long');
    expect(originalOnly.contact).toBeNull();
  });

  // T08: Comment ghim do tác giả viết chứa ngân sách, bài gốc không ghi ngân sách -> Ngân sách không bị trích xuất
  it('T08: ignores pinned comment budget, preserving original post content', () => {
    const postWithPinnedComment = {
      groupStt: 9,
      groupName: 'Hội Gala Dinner',
      author: 'Bùi H',
      permalink: 'https://www.facebook.com/groups/gala/posts/999000111/',
      text: 'Cần book tiệc teabreak 150 suất cho hội nghị tại Đống Đa sáng thứ 7.',
      pinnedComment: {
        author: 'Bùi H',
        text: 'Ngân sách khoảng 50 triệu trọn gói gồm hoa quả bánh ngọt'
      }
    };

    const originalOnly = toOriginalPostOnly(postWithPinnedComment as any);
    expect(originalOnly.content).not.toContain('50 triệu');
    expect((originalOnly as any).pinnedComment).toBeUndefined();
  });

  // T09: Bài gốc bị che/không tách rõ DOM -> Đánh dấu isUnclearOrObscured và xử lý HOLD
  it('T09: flags isUnclearOrObscured and does not backfill from clear comments', () => {
    const obscuredPost = {
      groupStt: 10,
      groupName: 'Hội Sự Kiện',
      author: 'Ngô I',
      permalink: 'https://www.facebook.com/groups/event/posts/101112131/',
      text: '', // DOM bị che khuất, không đọc được body
      isUnclearOrObscured: true,
      comments: [
        { author: 'Người Xem', text: 'Bạn này đang tìm thuê âm thanh ánh sáng' }
      ]
    };

    const originalOnly = toOriginalPostOnly(obscuredPost as any);
    expect(originalOnly.isUnclearOrObscured).toBe(true);
    expect(originalOnly.content).toBe('');
  });

  // T10: Bài đăng trùng đã có, comment bổ sung deadline -> Không UPDATE chỉ vì comment
  it('T10: does not trigger update or duplicate bypass when comment adds deadline', () => {
    const existingCandidate: Candidate = {
      groupStt: 1,
      groupName: 'Hội Sự Kiện',
      canonicalGroupUrl: 'https://www.facebook.com/groups/event',
      author: 'Nguyễn Văn A',
      permalink: 'https://www.facebook.com/groups/event/posts/12345/',
      text: 'Cần tìm đối tác quay phim recap sự kiện',
      contact: undefined,
      images: [],
      classification: {
        buyerIntent: true,
        decision: 'NEW',
        services: ['Media'],
        temperature: 'WARM',
        needSummary: 'Quay phim recap sự kiện',
        confidence: 0.9,
        requiresHumanReview: false,
        exclusionReason: null
      },
      canonicalKey: 'key_12345',
      contactKey: '',
      needFingerprint: fingerprint('Nguyễn Văn A', ['Media'], 'Quay phim recap sự kiện')
    };

    const incomingCandidateWithCommentDeadline: Candidate = {
      ...existingCandidate,
      permalink: 'https://www.facebook.com/groups/event/posts/12345/',
      // Nội dung bài gốc vẫn giữ nguyên:
      text: 'Cần tìm đối tác quay phim recap sự kiện'
    };

    // Kiểm tra deduplication:
    const history = [
      ['STT', 'UUID', 'Ngày', 'Nhân sự', 'Sản phẩm', 'Thông tin Data (Link/SĐT)', 'Dịch vụ yêu cầu', 'Nguồn'],
      ['1', 'D-TEST1234', '09/10/2026', 'Phương Dung', 'Media', 'https://www.facebook.com/groups/event/posts/12345/', 'Quay phim recap sự kiện', 'Seeding']
    ];

    const dedupResult = decideDuplicate(incomingCandidateWithCommentDeadline, history, []);
    expect(dedupResult.decision).toBe('DUPLICATE');
    expect(dedupResult.rule).toBe('LINK');
  });

  // T11: Bài gốc sửa nội dung bổ sung quy mô mới, comment không đổi -> Đánh giá từ bài gốc
  it('T11: recognizes content change from original post body, not from comments', () => {
    const originalPostV1 = toOriginalPostOnly({
      author: 'Đỗ K',
      permalink: 'https://www.facebook.com/groups/event/posts/777/',
      text: 'Cần tìm 1 MC sự kiện'
    });

    const originalPostV2 = toOriginalPostOnly({
      author: 'Đỗ K',
      permalink: 'https://www.facebook.com/groups/event/posts/777/',
      text: 'Cần tìm 1 MC song ngữ Anh-Việt và 1 vũ đoàn 6 người cho gala 500 khách'
    });

    expect(originalPostV1.content).not.toBe(originalPostV2.content);
    expect(originalPostV2.content).toContain('MC song ngữ Anh-Việt');
  });

  // Formatting Google Sheet: Khi bài gốc không có SĐT, không đưa SĐT ảo hay SĐT comment vào Sheet
  it('formats raw data row cleanly when original post has no phone number', () => {
    const candidateWithoutPhone: Candidate = {
      groupStt: 1,
      groupName: 'Hội Sự Kiện',
      canonicalGroupUrl: 'https://www.facebook.com/groups/event',
      author: 'Lê C',
      permalink: 'https://www.facebook.com/groups/event/posts/333444555/',
      text: 'Cần đơn vị tổ chức sự kiện khai trương showroom tại Ba Đình.',
      contact: undefined,
      images: [],
      classification: {
        buyerIntent: true,
        decision: 'NEW',
        services: ['Sự kiện'],
        temperature: 'WARM',
        needSummary: 'Tổ chức sự kiện khai trương showroom Ba Đình',
        contact: null,
        confidence: 0.95,
        requiresHumanReview: false,
        exclusionReason: null
      },
      canonicalKey: 'key_333444555',
      contactKey: '',
      needFingerprint: fingerprint('Lê C', ['Sự kiện'], 'Tổ chức sự kiện khai trương showroom Ba Đình')
    };

    const row = formatRawDataRow(candidateWithoutPhone);
    const [, , , , contactInfo, needReq] = row;

    // Contact info chỉ chứa permalink của bài gốc, không chứa SĐT:
    expect(contactInfo).toBe('https://www.facebook.com/groups/event/posts/333444555/');
    expect(contactInfo).not.toMatch(/(?:0|\+84)\d{8,10}/);
    expect(needReq).toBe('Tổ chức sự kiện khai trương showroom Ba Đình');
  });
});
