import {chromium,type BrowserContext,type Page}from'playwright';import fs from'node:fs';import readline from'node:readline';import type{GroupRow,RawPost}from'../types/index.js';import{canonicalFacebookUrl,phones}from'../utils/normalize.js';import{env}from'../config/env.js';

export async function loginFacebook(){
  fs.mkdirSync('browser-profile',{recursive:true});
  console.log('🚀 Đang mở trình duyệt Chromium (profile: browser-profile/)...');
  const context=await chromium.launchPersistentContext('browser-profile',{headless:false,locale:'vi-VN',viewport:{width:1440,height:950}});
  const page=context.pages()[0]||await context.newPage();
  await page.goto('https://www.facebook.com',{waitUntil:'domcontentloaded'});
  console.log('\n=============================================================');
  console.log('👉 Vui lòng đăng nhập Facebook trên cửa sổ trình duyệt.');
  console.log('👉 Sau khi đăng nhập xong, quay lại đây và nhấn phím ENTER để lưu phiên.');
  console.log('=============================================================\n');

  await new Promise<void>((resolve)=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout});
    rl.question('Nhấn [ENTER] khi bạn đã đăng nhập thành công: ',()=>{
      rl.close();
      resolve();
    });
  });

  console.log('💾 Đang lưu phiên đăng nhập...');
  await page.waitForTimeout(2000);
  await context.close();
  console.log('🎉 Đăng nhập hoàn tất! Dữ liệu phiên đã được lưu vào thư mục browser-profile/.');
}

export class FacebookScanner{context!:BrowserContext;async start(){fs.mkdirSync('browser-profile',{recursive:true});this.context=await chromium.launchPersistentContext('browser-profile',{headless:env.HEADLESS,locale:'vi-VN',viewport:{width:1440,height:950}})}async stop(){await this.context?.close()}
 async scanGroup(g:GroupRow):Promise<{canonical:string;posts:RawPost[];complete:boolean;lastTime?:string}> {const p=this.context.pages()[0]||await this.context.newPage();await p.goto(`${g.url}${g.url.includes('?')?'&':'?'}sorting_setting=CHRONOLOGICAL`,{waitUntil:'domcontentloaded',timeout:45000});await p.waitForTimeout(1500);
 if(/login|checkpoint|captcha/i.test(p.url())){
   if(!env.HEADLESS){
     console.log(`\n⚠️ Group ${g.stt} (${g.name}): Facebook yêu cầu đăng nhập.`);
     console.log('👉 Vui lòng đăng nhập trên trình duyệt (đang đợi tối đa 3 phút)...');
     const start=Date.now();
     while(/login|checkpoint|captcha/i.test(p.url())&&Date.now()-start<180000){
       await p.waitForTimeout(2000);
     }
     if(/login|checkpoint|captcha/i.test(p.url())){
       throw new Error('FACEBOOK_AUTH_REQUIRED');
     }
     console.log('✅ Đăng nhập thành công! Tiếp tục quét nhóm...');
     await p.goto(`${g.url}${g.url.includes('?')?'&':'?'}sorting_setting=CHRONOLOGICAL`,{waitUntil:'domcontentloaded',timeout:45000});
     await p.waitForTimeout(1500);
   }else{
     throw new Error('FACEBOOK_AUTH_REQUIRED');
   }
 }
 const canonical=canonicalFacebookUrl(p.url().replace(/\?.*$/,''));const posts=new Map<string,RawPost>();let stable=0,old=false,lastSize=-1,lastTime:string|undefined;
 for(let pass=0;pass<30;pass++){await this.expand(p);await p.waitForTimeout(500);const visible=await this.extract(p,g,canonical);for(const x of visible){posts.set(x.permalink||`${x.author}|${x.postedLabel}|${x.text.slice(0,160)}`,x);lastTime=x.postedLabel||lastTime;if(this.isOlder(x.postedLabel))old=true}stable=posts.size===lastSize?stable+1:0;lastSize=posts.size;if(old||stable>=3)break;await p.mouse.wheel(0,1400)}return{canonical,posts:[...posts.values()],complete:old||stable>=3,lastTime}}
 private async expand(p:Page){for(const b of await p.getByRole('button',{name:'Xem thêm',exact:true}).all()){try{await b.click({timeout:300})}catch{}}}
 private isOlder(t?:string){if(!t)return false;const s=t.toLowerCase();const d=s.match(/(\d+)\s*ngày/);if(d)return +d[1]>1;return /tháng|năm|20\d{2}/i.test(s)}
 private async extract(p:Page,g:GroupRow,canonical:string):Promise<RawPost[]>{return p.locator('[aria-label^="Hành động đối với bài viết này"]').evaluateAll((acts,args:any)=>acts.map((a:any)=>{let e=a;while(e?.parentElement){e=e.parentElement;if(e.querySelectorAll('[aria-label^="Hành động đối với bài viết này"]').length===1&&(e.innerText||'').length>40)break}let time;for(const x of e?.querySelectorAll('[aria-labelledby]')||[]){const t=document.getElementById(x.getAttribute('aria-labelledby'))?.textContent?.trim();if(t&&/vừa xong|phút|giờ|ngày|hôm qua|tháng|năm|20\d{2}/i.test(t)){time=t;break}}const links=[...(e?.querySelectorAll('a[href]')||[])].map((x:any)=>x.href);const text=(e?.innerText||'').replace(/^(Facebook\s*)+/,'').trim();return{groupStt:args.stt,groupName:args.name,canonicalGroupUrl:args.canonical,author:(a.getAttribute('aria-label')||'').replace(/^Hành động đối với bài viết này của\s*/,''),authorUrl:links.find((x:string)=>/\/user\/|profile\.php/.test(x)),postedLabel:time,permalink:links.find((x:string)=>/\/groups\/[^/]+\/(posts|permalink)\//.test(x)),text,contact:(text.match(/(?:\+?84|0)[\s.\-]?(?:\d[\s.\-]?){8,10}/)||[])[0],images:[...(e?.querySelectorAll('[aria-label^="Có thể là hình ảnh"]')||[])].map((x:any)=>x.getAttribute('aria-label'))}}),{stt:g.stt,name:g.name,canonical})}
}

