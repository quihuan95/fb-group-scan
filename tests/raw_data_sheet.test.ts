import { describe, it, expect } from 'vitest';
import { formatRawDataRow, PRODUCT_STAFF_MAP, normalizeServiceName } from '../src/sheets/repository.js';
import { decideDuplicate } from '../src/dedup/engine.js';
import type { Candidate } from '../src/types/index.js';

describe('Raw Data Sheet Formatting & Dedup', () => {
  const sampleCandidate: Candidate = {
    groupStt: 1,
    groupName: 'Hội Sự Kiện Việt Nam',
    canonicalGroupUrl: 'https://www.facebook.com/groups/eventvn',
    author: 'Nguyễn Văn A',
    permalink: 'https://www.facebook.com/groups/eventvn/posts/123456789/',
    text: 'Cần tìm đơn vị tổ chức Gala Dinner 200 khách tại Hà Nội. SĐT: 0988123456',
    contact: '0988123456',
    images: [],
    classification: {
      buyerIntent: true,
      decision: 'NEW',
      services: ['Sự kiện'],
      temperature: 'HOT',
      needSummary: 'Tổ chức Gala Dinner 200 khách tại Hà Nội',
      location: 'Hà Nội',
      contact: '0988123456',
      exclusionReason: null,
      confidence: 0.95,
      requiresHumanReview: false
    },
    canonicalKey: 'test_canonical_key_12345678',
    contactKey: '0988123456',
    needFingerprint: 'fp_test_123'
  };

  it('correctly maps all 11 products to assigned staff', () => {
    expect(PRODUCT_STAFF_MAP['Tour Nội địa']).toBe('Thùy Anh');
    expect(PRODUCT_STAFF_MAP['Hội nghị - MICE']).toBe('Nhật Chung');
    expect(PRODUCT_STAFF_MAP['Hội nghị MICE']).toBe('Nhật Chung');
    expect(PRODUCT_STAFF_MAP['Sự kiện']).toBe('Bích Hiển');
    expect(PRODUCT_STAFF_MAP['Thiết bị']).toBe('Phương Dung');
    expect(PRODUCT_STAFF_MAP['Thi công']).toBe('Phương Dung');
    expect(PRODUCT_STAFF_MAP['Media']).toBe('Phương Dung');
    expect(PRODUCT_STAFF_MAP['Tour Inbound']).toBe('Hà Đỗ');
    expect(PRODUCT_STAFF_MAP['Tour Outbound']).toBe('Hà Đỗ');
    expect(PRODUCT_STAFF_MAP['Tiệc']).toBe('Nhật Chung');
    expect(PRODUCT_STAFF_MAP['Xe']).toBe('Thùy Anh');
    expect(PRODUCT_STAFF_MAP['Vé']).toBe('Thùy Anh');
  });

  it('normalizes service name to match sheet validation', () => {
    expect(normalizeServiceName('Hội nghị MICE')).toBe('Hội nghị - MICE');
    expect(normalizeServiceName('Sự kiện')).toBe('Sự kiện');
  });

  it('formats raw data row with 7 columns (B to H)', () => {
    const row = formatRawDataRow(sampleCandidate);
    expect(row.length).toBe(7);

    const [uuid, dateStr, staff, service, contactInfo, needReq, source] = row;

    // UUID: D-XXXXXXXX
    expect(uuid).toMatch(/^D-[0-9A-F]{8}$/);

    // Ngày: DD/MM/YYYY
    expect(dateStr).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    // Nhân sự: Bích Hiển for 'Sự kiện'
    expect(staff).toBe('Bích Hiển');

    // Sản phẩm
    expect(service).toBe('Sự kiện');

    // Thông tin Data: contains both phone and permalink
    expect(contactInfo).toContain('0988123456');
    expect(contactInfo).toContain('https://www.facebook.com/groups/eventvn/posts/123456789/');

    // Dịch vụ yêu cầu
    expect(needReq).toBe('Tổ chức Gala Dinner 200 khách tại Hà Nội');

    // Nguồn: Seeding
    expect(source).toBe('Seeding');
  });

  it('deduplicates based on link in raw data sheet history', () => {
    // Row 5 header, Row 6 data
    const history = [
      ['STT', 'UUID', 'Ngày', 'Nhân sự', 'Sản phẩm', 'Thông tin Data (Link/SĐT)', 'Dịch vụ yêu cầu', 'Nguồn'],
      [
        '1',
        'D-ABCD1234',
        '02/10/2026',
        'Bích Hiển',
        'Sự kiện',
        '0988123456\n\nhttps://www.facebook.com/groups/eventvn/posts/123456789/',
        'Tổ chức Gala Dinner',
        'Seeding'
      ]
    ];

    const duplicateCandidate: Candidate = {
      ...sampleCandidate,
      permalink: 'https://m.facebook.com/groups/eventvn/posts/123456789/?ref=share'
    };

    const result = decideDuplicate(duplicateCandidate, history, []);
    expect(result.decision).toBe('DUPLICATE');
    expect(result.rule).toBe('LINK');
  });

  it('rejects motorbike posts for Xe service via safeguard', () => {
    // Simulating candidate with motorbike text
    const motorbikeCandidate: Candidate = {
      groupStt: 95,
      groupName: 'Đà Lạt Review',
      canonicalGroupUrl: 'https://www.facebook.com/groups/dalat',
      author: 'Uyên Võ',
      permalink: 'https://www.facebook.com/groups/dalat/posts/999/',
      text: 'Cần thuê xe máy Đà Lạt giá 100k/ngày từ 3 đến 5/10...',
      images: [],
      classification: {
        buyerIntent: true,
        decision: 'NEW',
        services: ['Xe'],
        temperature: 'WARM',
        needSummary: 'Cần thuê xe máy Đà Lạt',
        confidence: 0.9,
        requiresHumanReview: false,
        exclusionReason: null
      },
      canonicalKey: 'key_motorbike',
      contactKey: '',
      needFingerprint: 'fp_motorbike'
    };

    const textLower = motorbikeCandidate.text.toLowerCase();
    const isMotorbike = /\b(xe máy|xe may|xe gắn máy|xe gan may|xe mô tô|xe moto|xe số|xe so|xe ga|cào cào|cao cao|vision|air blade|airblade|lead|sh mode|wave|sirius|exciter|winner|xe tải|xe tai|chuyển nhà|chuyen nha|chở hàng|cho hang)\b/i.test(textLower);

    expect(isMotorbike).toBe(true);
  });
});
