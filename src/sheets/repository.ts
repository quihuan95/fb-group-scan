import crypto from 'node:crypto';
import { append, update, values } from './client.js';
import type { GroupRow, ProductRule, Candidate, Service } from '../types/index.js';
import { env } from '../config/env.js';
import { canonicalFacebookUrl, hash } from '../utils/normalize.js';

const split = (v: any) => String(v || '').split(';').map(x => x.trim()).filter(Boolean);

export const PRODUCT_STAFF_MAP: Record<string, string> = {
  'Tour Nội địa': 'Thùy Anh',
  'Hội nghị - MICE': 'Nhật Chung',
  'Hội nghị MICE': 'Nhật Chung',
  'Sự kiện': 'Bích Hiển',
  'Thiết bị': 'Phương Dung',
  'Thi công': 'Phương Dung',
  'Tour Inbound': 'Hà Đỗ',
  'Tour Outbound': 'Hà Đỗ',
  'Tiệc': 'Nhật Chung',
  'Media': 'Phương Dung',
  'Xe': 'Thùy Anh',
  'Vé': 'Thùy Anh'
};

export function normalizeServiceName(service: string): string {
  if (service === 'Hội nghị MICE') return 'Hội nghị - MICE';
  return service;
}

export async function loadGroups(): Promise<GroupRow[]> {
  const a = await values(`'MASTER GROUP'!A4:N1000`, env.SPREADSHEET_ID);
  return a
    .slice(1)
    .map((r: any[], i) => ({
      row: i + 5,
      stt: +r[0],
      primary: r[1],
      secondary: split(r[2]) as Service[],
      name: r[3],
      url: r[4],
      priority: r[6],
      batch: +r[7] || 999,
      status: r[9] || '',
      keywords: r[10] || ''
    }))
    .filter(g => g.url && !/Tạm dừng|Không truy cập/i.test(g.status))
    .sort((a, b) => 'ABC'.indexOf(a.priority) - 'ABC'.indexOf(b.priority) || a.batch - b.batch || a.stt - b.stt);
}

export async function loadRules(): Promise<ProductRule[]> {
  const a = await values(`'CẤU HÌNH SẢN PHẨM'!A4:J30`, env.SPREADSHEET_ID);
  return a
    .slice(1)
    .filter(r => r[1])
    .map(r => ({
      service: r[1] as Service,
      target: r[2] || '',
      needs: r[3] || '',
      main: split(r[4]),
      expanded: split(r[5]),
      excluded: split(r[6]),
      hotWarm: r[8] || '',
      notes: r[9] || ''
    }));
}

/**
 * Đọc toàn bộ Lead đã có từ sheet đích (Tháng 10/26, Tháng 9/26 hoặc LEAD OUTPUT) để phục vụ deduplication
 */
export async function loadLeadOutput(): Promise<any[][]> {
  const destId = env.DATA_DESTINATION_SPREADSHEET_ID || env.SPREADSHEET_ID;
  const destSheet = env.DATA_DESTINATION_SHEET || 'Tháng 10/26';

  let allRows: any[][] = [];

  try {
    const curMonthRows = await values(`'${destSheet}'!A5:H2000`, destId);
    if (curMonthRows && curMonthRows.length > 0) {
      allRows = allRows.concat(curMonthRows);
    }
  } catch (e: any) {
    console.warn(`⚠️ Không thể tải dữ liệu từ sheet '${destSheet}':`, e.message);
  }

  // Nếu là Tháng 10/26, nạp thêm dữ liệu từ Tháng 9/26 để chống trùng các bài đã lấy trong tháng trước
  if (destSheet === 'Tháng 10/26') {
    try {
      const prevMonthRows = await values(`'Tháng 9/26'!A5:H2000`, destId);
      if (prevMonthRows && prevMonthRows.length > 1) {
        // Bỏ dòng header của Tháng 9/26
        allRows = allRows.concat(prevMonthRows.slice(1));
      }
    } catch {
      // bỏ qua nếu không đọc được Tháng 9
    }
  }

  // Nếu không có dữ liệu từ sheet đích, fallback kiểm tra sheet 'LEAD OUTPUT' cũ
  if (allRows.length === 0) {
    try {
      return await values(`'LEAD OUTPUT'!A4:X1000`, env.SPREADSHEET_ID);
    } catch {
      return [];
    }
  }

  return allRows;
}

export async function markGroup(row: number, leadCount: number) {
  await update(`'MASTER GROUP'!L${row}:M${row}`, [[new Date().toLocaleDateString('vi-VN'), leadCount]], env.SPREADSHEET_ID);
}

function parsePostedDateTime(label?: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayVN = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;

  if (!label) {
    return {
      date: todayVN,
      time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };
  }

  const s = label.toLowerCase();
  if (s.includes('hôm qua')) {
    const y = new Date(now.getTime() - 86400000);
    const m = s.match(/(\d{1,2}):(\d{2})/);
    return {
      date: `${pad(y.getDate())}/${pad(y.getMonth() + 1)}/${y.getFullYear()}`,
      time: m ? `${m[1]}:${m[2]}` : '12:00'
    };
  }

  if (s.includes('phút') || s.includes('giờ') || s.includes('vừa xong')) {
    let ms = 0;
    const mp = s.match(/(\d+)\s*phút/);
    if (mp) ms = +mp[1] * 60000;
    const mg = s.match(/(\d+)\s*giờ/);
    if (mg) ms = +mg[1] * 3600000;
    const p = new Date(now.getTime() - ms);
    return {
      date: `${pad(p.getDate())}/${pad(p.getMonth() + 1)}/${p.getFullYear()}`,
      time: p.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };
  }

  return { date: todayVN, time: label };
}

/**
 * Định dạng candidate thành 7 cột tương ứng với B:H trong sheet Data thô:
 * [UUID, Ngày, Nhân sự, Sản phẩm, Thông tin Data (Link/SĐT), Dịch vụ yêu cầu, Nguồn]
 */
export function formatRawDataRow(c: Candidate): string[] {
  const x = c.classification;

  // 1. UUID: D-XXXXXXXX (8 hex ký tự in hoa)
  const hexPart = (hash(c.canonicalKey || c.permalink || `${c.groupStt}|${c.author}|${c.text}`) || crypto.randomUUID().replace(/-/g, ''))
    .slice(0, 8)
    .toUpperCase();
  const uuid = `D-${hexPart}`;

  // 2. Ngày: DD/MM/YYYY
  const dt = parsePostedDateTime(c.postedAt || c.postedLabel);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayVN = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const dateStr = dt.date || todayVN;

  // 3. Sản phẩm: chuẩn hóa tên dịch vụ
  const rawService = x.services?.[0] || 'Sự kiện';
  const service = normalizeServiceName(rawService);

  // 4. Nhân sự: phân công theo Sản phẩm
  const staff = PRODUCT_STAFF_MAP[service] || PRODUCT_STAFF_MAP[rawService] || 'Phương Branding';

  // 5. Thông tin Data (Link/SĐT)
  const phone = c.contact || x.contact;
  const link = c.permalink || '';
  let contactInfo = '';
  if (phone && link) {
    contactInfo = `${phone}\n\n${link}`;
  } else if (link) {
    contactInfo = link;
  } else if (phone) {
    contactInfo = phone;
  } else {
    contactInfo = c.canonicalGroupUrl || '';
  }

  // 6. Dịch vụ yêu cầu (needSummary)
  const needReq = x.needSummary || (c.text || '').slice(0, 200).replace(/\n+/g, ' ');

  // 7. Nguồn: 'Seeding'
  const source = 'Seeding';

  return [uuid, dateStr, staff, service, contactInfo, needReq, source];
}

let _checkedA6 = false;
let _cachedNextRow: number | null = null;

async function ensureArrayFormula(destSheet: string, destId: string) {
  if (_checkedA6) return;
  _checkedA6 = true;
  try {
    const a6Val = await values(`'${destSheet}'!A6`, destId);
    if (!a6Val || !a6Val.length || !a6Val[0] || !a6Val[0][0]) {
      await update(
        `'${destSheet}'!A6`,
        [['=ARRAYFORMULA(IF(C6:C="";"";MATCH(ROW(C6:C);FILTER(ROW(C6:C);C6:C<>"");0)))']],
        destId
      );
    }
  } catch (err: any) {
    console.warn('⚠️ Không thể kiểm tra công thức A6:', err.message);
  }
}

async function getNextRow(destSheet: string, destId: string): Promise<number> {
  const colB = await values(`'${destSheet}'!B5:B`, destId);
  const fetchedNext = 5 + (colB ? colB.length : 1);
  if (_cachedNextRow === null || fetchedNext > _cachedNextRow) {
    _cachedNextRow = fetchedNext;
  }
  return _cachedNextRow;
}

export async function writeLead(c: Candidate, runId?: string) {
  if (!env.WRITE_LEADS) return;
  await writeLeads([c], runId);
}

export async function writeLeads(candidates: Candidate[], runId?: string) {
  if (!env.WRITE_LEADS || candidates.length === 0) return;

  const destId = env.DATA_DESTINATION_SPREADSHEET_ID || env.SPREADSHEET_ID;
  const destSheet = env.DATA_DESTINATION_SHEET || 'Tháng 10/26';

  await ensureArrayFormula(destSheet, destId);

  const startRow = await getNextRow(destSheet, destId);
  const rows = candidates.map(formatRawDataRow);
  const endRow = startRow + rows.length - 1;
  _cachedNextRow = endRow + 1;

  await update(`'${destSheet}'!B${startRow}:H${endRow}`, rows, destId);

  for (let i = 0; i < candidates.length; i++) {
    const rowIdx = startRow + i;
    const uuid = rows[i][0];
    const service = rows[i][3];
    const staff = rows[i][2];
    console.log(`  📝 Đã ghi lead vào Google Sheet '${destSheet}' [Dòng ${rowIdx} | UUID: ${uuid} | ${service} -> ${staff}]`);
  }
}
