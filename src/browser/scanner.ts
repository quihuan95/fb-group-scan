import { chromium, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import readline from 'node:readline';
import type { GroupRow, RawPost } from '../types/index.js';
import { canonicalFacebookUrl, phones } from '../utils/normalize.js';
import { env } from '../config/env.js';

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
];

function hasInstalledChrome(): boolean {
  return CHROME_PATHS.some(p => p && fs.existsSync(p));
}

export async function createBrowserContext(headless = false): Promise<BrowserContext> {
  fs.mkdirSync('browser-profile', { recursive: true });
  const useRealChrome = hasInstalledChrome();

  const context = await chromium.launchPersistentContext('browser-profile', {
    channel: useRealChrome ? 'chrome' : undefined,
    headless,
    locale: 'vi-VN',
    viewport: null,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  return context;
}

export async function loginFacebook() {
  console.log('🚀 Đang mở trình duyệt Google Chrome (chống bot checkpoint 2FA)...');
  const context = await createBrowserContext(false);
  const page = context.pages()[0] || await context.newPage();

  await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
  console.log('\n=============================================================');
  console.log('👉 Vui lòng đăng nhập Facebook và hoàn thành xác minh 2FA.');
  console.log('👉 Sau khi đã vào được trang chủ (bảng tin) Facebook:');
  console.log('👉 Quay lại cửa sổ terminal này và nhấn phím [ENTER] để lưu phiên.');
  console.log('=============================================================\n');

  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Nhấn [ENTER] khi bạn đã vào được Facebook thành công: ', () => {
      rl.close();
      resolve();
    });
  });

  console.log('💾 Đang kiểm tra và lưu phiên đăng nhập...');
  try {
    const cookies = await context.cookies();
    const hasCUser = cookies.some(c => c.name === 'c_user');
    if (hasCUser) {
      console.log('✅ Đã xác nhận phiên đăng nhập hợp lệ (cookie c_user)!');
    } else {
      console.log('ℹ️ Đang lưu profile phiên hiện tại vào browser-profile/...');
    }
    if (!page.isClosed()) {
      await page.waitForTimeout(2000);
    }
  } catch {}

  try {
    await context.close();
  } catch {}
  console.log('🎉 Đăng nhập hoàn tất! Dữ liệu phiên đã được lưu vào thư mục browser-profile/.');
}

export class FacebookScanner {
  context!: BrowserContext;
  async start() {
    this.context = await createBrowserContext(env.HEADLESS);
  }
  async stop() {
    try {
      await this.context?.close();
    } catch {}
  }

  async scanGroup(g: GroupRow): Promise<{ canonical: string; posts: RawPost[]; complete: boolean; lastTime?: string }> {
    try {
      return await this._doScanGroup(g);
    } catch (e: any) {
      if (/Target page, context or browser has been closed|Target closed|browser has been closed|page has been closed/i.test(e.message)) {
        console.warn(`\n  ⚠️ Trình duyệt bị đóng hoặc mất kết nối, đang tự động khởi động lại để quét tiếp nhóm [STT: ${g.stt}]...`);
        try { await this.context?.close(); } catch {}
        this.context = await createBrowserContext(env.HEADLESS);
        return await this._doScanGroup(g);
      }
      throw e;
    }
  }

  private async _doScanGroup(g: GroupRow): Promise<{ canonical: string; posts: RawPost[]; complete: boolean; lastTime?: string }> {
    const p = this.context.pages()[0] || await this.context.newPage();
    await p.goto(`${g.url}${g.url.includes('?') ? '&' : '?'}sorting_setting=CHRONOLOGICAL`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(1500);
    if (/login|checkpoint|captcha/i.test(p.url())) {
      if (!env.HEADLESS) {
        console.log(`\n⚠️ Group ${g.stt} (${g.name}): Facebook yêu cầu đăng nhập.`);
        console.log('👉 Vui lòng đăng nhập trên trình duyệt (đang đợi tối đa 3 phút)...');
        const start = Date.now();
        while (/login|checkpoint|captcha/i.test(p.url()) && Date.now() - start < 180000) {
          await p.waitForTimeout(2000);
        }
        if (/login|checkpoint|captcha/i.test(p.url())) {
          throw new Error('FACEBOOK_AUTH_REQUIRED');
        }
        console.log('✅ Đăng nhập thành công! Tiếp tục quét nhóm...');
        await p.goto(`${g.url}${g.url.includes('?') ? '&' : '?'}sorting_setting=CHRONOLOGICAL`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p.waitForTimeout(1500);
      } else {
        throw new Error('FACEBOOK_AUTH_REQUIRED');
      }
    }
    const canonical = canonicalFacebookUrl(p.url().replace(/\?.*$/, ''));
    const posts = new Map<string, RawPost>();
    let stable = 0, old = false, lastSize = -1, lastTime: string | undefined;
    for (let pass = 0; pass < 20; pass++) {
      await this.expand(p);
      await p.waitForTimeout(300);
      const visible = await this.extract(p, g, canonical);
      for (const x of visible) {
        posts.set(x.permalink || `${x.author}|${x.postedLabel}|${x.text.slice(0, 160)}`, x);
        lastTime = x.postedLabel || lastTime;
        if (this.isOlder(x.postedLabel)) old = true;
      }
      stable = posts.size === lastSize ? stable + 1 : 0;
      lastSize = posts.size;
      if (old || stable >= 2) break;
      await p.mouse.wheel(0, 1500);
    }
    return { canonical, posts: [...posts.values()], complete: old || stable >= 2, lastTime };
  }

  private async expand(p: Page) {
    try {
      await p.evaluate(() => {
        // Danh sách các vùng chứa comment/reply để loại trừ tuyệt đối
        const commentSelector = [
          '[aria-label*="bình luận" i]',
          '[aria-label*="comment" i]',
          'form',
          'ul[role="group"]',
          '[role="article"] [role="article"]',
          '[aria-label*="Bình luận của" i]',
          '[aria-label*="câu trả lời" i]'
        ].join(',');

        const buttons = document.querySelectorAll('div[role="button"], span[role="button"]');
        buttons.forEach((el) => {
          const t = el.textContent?.trim();
          // Chỉ mở "Xem thêm" / "See more" của chính BÀI ĐĂNG GỐC.
          // Tuyệt đối không click:
          // 1. Nút nằm trong khu vực bình luận.
          // 2. Nút mở thêm bình luận ("Xem thêm bình luận", "Xem câu trả lời", etc.)
          if (t === 'Xem thêm' || t === 'See more') {
            if (!el.closest(commentSelector)) {
              (el as HTMLElement).click();
            }
          }
        });
      });
    } catch {}
  }

  private isOlder(t?: string) {
    if (!t) return false;
    const s = t.toLowerCase();
    const d = s.match(/(\d+)\s*ngày/);
    if (d) return +d[1] > 1;
    return /tháng|năm|20\d{2}/i.test(s);
  }

  private async extract(p: Page, g: GroupRow, canonical: string): Promise<RawPost[]> {
    return p.locator('[aria-label^="Hành động đối với bài viết này"]').evaluateAll((acts, args: any) => acts.map((a: any) => {
      let e = a;
      while (e?.parentElement) {
        e = e.parentElement;
        if (e.querySelectorAll('[aria-label^="Hành động đối với bài viết này"]').length === 1 && (e.innerText || '').length > 40) break;
      }

      // Ranh giới DOM: loại trừ toàn bộ khu vực bình luận, reply, thanh tương tác và form comment
      const commentSelector = [
        '[aria-label*="bình luận" i]',
        '[aria-label*="comment" i]',
        'form',
        '[role="toolbar"]',
        '[aria-label*="Bình luận của" i]',
        '[aria-label*="câu trả lời" i]',
        '[aria-label*="Thích" i]',
        '[aria-label*="Chia sẻ" i]',
        '[data-visualcompletion="ignore-dynamic-and-static"]',
        '[role="article"] [role="article"]'
      ].join(',');

      const isInsideComment = (node: any) => !!node?.closest?.(commentSelector);

      // 1. Trích xuất thời gian đăng: CHỈ LẤY TỪ HEADER BÀI ĐĂNG GỐC (bỏ qua mọi thời gian trong comment)
      let time: string | undefined;
      for (const x of e?.querySelectorAll('[aria-labelledby]') || []) {
        if (isInsideComment(x)) continue;
        const t = document.getElementById(x.getAttribute('aria-labelledby'))?.textContent?.trim();
        if (t && /vừa xong|phút|giờ|ngày|hôm qua|tháng|năm|20\d{2}/i.test(t)) {
          time = t;
          break;
        }
      }
      if (!time) {
        for (const x of e?.querySelectorAll('a') || []) {
          if (isInsideComment(x)) continue;
          const t = x.textContent?.trim();
          if (t && /^(vừa xong|\d+\s*(phút|giờ|ngày)|hôm qua|tháng|năm|20\d{2})/i.test(t)) {
            time = t;
            break;
          }
        }
      }

      // 2. Trích xuất liên kết: CHỈ LẤY TỪ BÀI ĐĂNG GỐC (bỏ qua link trong comment)
      const links = [...(e?.querySelectorAll('a[href]') || [])]
        .filter((x: any) => !isInsideComment(x))
        .map((x: any) => x.href);

      // 3. Trích xuất nội dung: CHỈ LẤY TỪ NỘI DUNG BÀI ĐĂNG GỐC
      const messageEl = e?.querySelector?.('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
      let text = '';
      let isUnclearOrObscured = false;

      if (messageEl) {
        text = (messageEl.innerText || messageEl.textContent || '').trim();
      } else {
        // Fallback an toàn: clone container và xóa sạch mọi phần tử comment/toolbar trước khi lấy text
        try {
          const clone = e.cloneNode(true);
          clone.querySelectorAll(commentSelector).forEach((el: any) => el.remove());
          clone.querySelectorAll('[aria-label^="Hành động đối với bài viết này"]').forEach((el: any) => el.remove());
          text = (clone.innerText || clone.textContent || '').replace(/^(Facebook\s*)+/, '').trim();
        } catch {
          text = '';
        }
        if (!text || text.length < 5) {
          isUnclearOrObscured = true;
        }
      }

      // 4. Trích xuất SĐT/contact: CHỈ TỪ NỘI DUNG BÀI ĐĂNG GỐC
      const contactMatch = text.match(/(?:\+?84|0)[\s.\-]?(?:\d[\s.\-]?){8,10}/);
      const contact = contactMatch ? contactMatch[0].replace(/[.\-\s]+$/, '').trim() : undefined;

      // 5. Ảnh/attachments: CHỈ TỪ BÀI ĐĂNG GỐC
      const images = [...(e?.querySelectorAll('[aria-label^="Có thể là hình ảnh"]') || [])]
        .filter((x: any) => !isInsideComment(x))
        .map((x: any) => x.getAttribute('aria-label') || '');

      return {
        groupStt: args.stt,
        groupName: args.name,
        canonicalGroupUrl: args.canonical,
        author: (a.getAttribute('aria-label') || '').replace(/^Hành động đối với bài viết này của\s*/, '').trim(),
        authorUrl: links.find((x: string) => /\/user\/|profile\.php/.test(x)),
        postedLabel: time,
        permalink: links.find((x: string) => /\/groups\/[^/]+\/(posts|permalink)\//.test(x)),
        text,
        originalBodyText: text,
        contact,
        images,
        isUnclearOrObscured
      };
    }), { stt: g.stt, name: g.name, canonical });
  }
}

