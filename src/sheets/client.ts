import fs from 'node:fs';
import { google } from 'googleapis';
import { env } from '../config/env.js';
import { parseCsv } from '../utils/csv.js';

let _sheetsInstance: ReturnType<typeof google.sheets> | null = null;

export function getSheetsClient(): ReturnType<typeof google.sheets> | null {
  if (_sheetsInstance) return _sheetsInstance;

  // 1. Kiểm tra tokens.json + oauth-credentials.json
  if (fs.existsSync('tokens.json') && fs.existsSync('oauth-credentials.json')) {
    try {
      const fileData = JSON.parse(fs.readFileSync('oauth-credentials.json', 'utf8'));
      const creds = fileData.installed || fileData.web;
      const tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf8'));
      const oauth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, 'http://localhost:3000');
      oauth2Client.setCredentials(tokens);
      _sheetsInstance = google.sheets({ version: 'v4', auth: oauth2Client });
      return _sheetsInstance;
    } catch (e) {
      console.warn('⚠️ Không thể tải token OAuth từ tokens.json:', e);
    }
  }

  // 2. Kiểm tra service-account.json
  if (fs.existsSync(env.GOOGLE_SERVICE_ACCOUNT_JSON)) {
    try {
      const credentials = JSON.parse(fs.readFileSync(env.GOOGLE_SERVICE_ACCOUNT_JSON, 'utf8'));
      if (credentials.client_email && credentials.private_key) {
        const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        _sheetsInstance = google.sheets({ version: 'v4', auth });
        return _sheetsInstance;
      }
    } catch (e) {
      console.warn('⚠️ Lỗi đọc file Service Account:', e);
    }
  }

  return null;
}

export const sheets = new Proxy({} as ReturnType<typeof google.sheets>, {
  get(_, prop: any) {
    const client = getSheetsClient();
    if (!client) {
      throw new Error('Chưa cấu hình quyền ghi Google Sheet (Cần chạy xác thực Google OAuth2 hoặc cung cấp Service Account).');
    }
    return (client as any)[prop];
  }
});

export async function values(range: string, spreadsheetId: string = env.SPREADSHEET_ID): Promise<any[][]> {
  const client = getSheetsClient();
  if (client) {
    try {
      const r = await client.spreadsheets.values.get({ spreadsheetId, range });
      if (r.data.values && r.data.values.length > 0) {
        return r.data.values;
      }
    } catch (err: any) {
      console.warn(`⚠️ Google Sheet API values.get gặp lỗi (${err.message}). Chuyển sang đọc trực tiếp qua Web export...`);
    }
  }

  // Fallback đọc dữ liệu công khai qua URL CSV export của Google Sheet
  return await fetchPublicSheetValues(range, spreadsheetId);
}

async function fetchPublicSheetValues(range: string, spreadsheetId: string = env.SPREADSHEET_ID): Promise<any[][]> {
  const match = range.match(/^'([^']+)'/);
  const sheetName = match ? match[1] : range.split('!')[0];
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Không thể đọc Google Sheet [${sheetName}]: HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseCsv(text);
}

export async function update(range: string, rows: unknown[][], spreadsheetId: string = env.SPREADSHEET_ID) {
  const s = getSheetsClient();
  if (!s) {
    console.warn(`⚠️ [Lưu ý] Chưa xác thực Google OAuth (hoặc Service Account). Dữ liệu cập nhật nhóm đã được lưu trong SQLite.`);
    return;
  }
  try {
    await s.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'USER_ENTERED', requestBody: { values: rows } });
  } catch (e: any) {
    console.error(`❌ Lỗi cập nhật Google Sheet (${range}):`, e.message);
  }
}

export async function append(range: string, rows: unknown[][], spreadsheetId: string = env.SPREADSHEET_ID) {
  const s = getSheetsClient();
  if (!s) {
    console.warn(`⚠️ [Lưu ý] Chưa xác thực Google OAuth (hoặc Service Account). Lead mới đã được lưu an toàn trong SQLite.`);
    return;
  }
  try {
    await s.spreadsheets.values.append({ spreadsheetId, range, valueInputOption: 'USER_ENTERED', insertDataOption: 'OVERWRITE', requestBody: { values: rows } });
    console.log(`  📝 Đã ghi thành công lead vào Google Sheet!`);
  } catch (e: any) {
    console.error(`❌ Lỗi ghi lead vào Google Sheet:`, e.message);
  }
}
