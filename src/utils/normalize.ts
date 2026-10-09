import {createHash} from 'node:crypto';
export const clean=(s='')=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
export const canonicalFacebookUrl=(u='')=>{try{const x=new URL(u);x.search='';x.hash='';x.hostname='www.facebook.com';return x.toString().replace(/\/$/,'')}catch{return clean(u)}};
export const contactKey=(s='')=>{const d=s.replace(/\D/g,'');return d.startsWith('84')?'0'+d.slice(2):d};
export const phones=(s='')=>[...new Set((s.match(/(?:\+?84|0)[\s.\-]?(?:\d[\s.\-]?){8,10}/g)||[]).map(contactKey).filter(x=>x.length>=9))];
export const hash=(s:string)=>createHash('sha256').update(clean(s).toLowerCase()).digest('hex');
export const fingerprint=(author:string,services:string[],need:string)=>hash(`${clean(author)}|${[...services].sort().join(',')}|${clean(need)}`);

import type { RawPost, OriginalPostOnly } from '../types/index.js';

/**
 * Chuẩn hóa và whitelist CHỈ DỮ LIỆU BÀI ĐĂNG GỐC (Original Post Only).
 * Loại bỏ tuyệt đối tất cả comments, replies, commentThreads, comment author/contact.
 */
export function toOriginalPostOnly(raw: (Partial<RawPost> | Partial<OriginalPostOnly>) & Record<string, any>): OriginalPostOnly {
  const content = clean(raw.originalBodyText || raw.text || raw.content || '');
  
  // SĐT/Zalo chỉ được lấy từ chính nội dung bài đăng gốc, không tìm trong comment
  const rawContactMatch = (content.match(/(?:\+?84|0)[\s.\-]?(?:\d[\s.\-]?){8,10}/) || [])[0];
  const contact = rawContactMatch ? rawContactMatch.replace(/[.\-\s]+$/, '').trim() : null;
  
  const permalink = raw.permalink || raw.postUrl;
  let postId = raw.postId;
  if (!postId && permalink) {
    const m = permalink.match(/\/(?:posts|permalink)\/(\d+)/);
    if (m) postId = m[1];
  }

  return {
    postId,
    postUrl: permalink ? canonicalFacebookUrl(permalink) : undefined,
    groupUrl: raw.canonicalGroupUrl || raw.groupUrl,
    groupName: raw.groupName,
    groupStt: raw.groupStt,
    author: clean(raw.author || ''),
    authorUrl: raw.authorUrl,
    createdAt: raw.postedAt || raw.postedLabel || raw.createdAt,
    postedLabel: raw.postedLabel,
    content,
    originalBodyText: content,
    attachments: Array.isArray(raw.attachments) 
      ? raw.attachments 
      : (Array.isArray(raw.images) ? raw.images : []),
    contact,
    ocrText: raw.ocrText ? clean(raw.ocrText) : undefined,
    isUnclearOrObscured: Boolean(raw.isUnclearOrObscured)
  };
}
