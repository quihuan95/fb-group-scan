import fs from 'node:fs';
import http from 'node:http';
import url from 'node:url';
import { google } from 'googleapis';

const TOKEN_PATH = 'tokens.json';
const OAUTH_PATH = 'oauth-credentials.json';

export async function authorizeGoogle() {
  if (!fs.existsSync(OAUTH_PATH)) {
    throw new Error(`⚠️ Không tìm thấy ${OAUTH_PATH}`);
  }

  const fileData = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
  const creds = fileData.installed || fileData.web;
  if (!creds) {
    throw new Error('⚠️ File credentials không chứa thông tin "installed" hoặc "web".');
  }

  const port = 3000;
  const redirectUri = `http://localhost:${port}`;
  const oauth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/spreadsheets']
  });

  console.log('\n=============================================================');
  console.log('🔗 XÁC THỰC GOOGLE OAUTH2 CHO GOOGLE SHEET');
  console.log('👉 Vui lòng mở đường link sau trên trình duyệt để cấp quyền:');
  console.log(`\n${authUrl}\n`);
  console.log('👉 Đang chờ phản hồi xác thực tại http://localhost:3000...');
  console.log('=============================================================\n');

  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url) return;
        const parsedUrl = url.parse(req.url, true);
        const code = parsedUrl.query.code as string;

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>✅ Xác thực thành công! Bạn có thể đóng tab này và quay lại terminal.</h1>');

          const { tokens } = await oauth2Client.getToken(code);
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
          console.log(`✅ Đã lưu token thành công vào ${TOKEN_PATH}!`);
          server.close();
          resolve();
        } else if (parsedUrl.query.error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>❌ Xác thực thất bại: ${parsedUrl.query.error}</h1>`);
          server.close();
          reject(new Error(String(parsedUrl.query.error)));
        }
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.listen(port, () => {});
    server.on('error', (err) => {
      console.error('Lỗi khởi động local server OAuth:', err);
      reject(err);
    });
  });
}

if (process.argv[1]?.endsWith('auth.ts') || process.argv[1]?.endsWith('auth.js')) {
  authorizeGoogle().catch(console.error);
}
