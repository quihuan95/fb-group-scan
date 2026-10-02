import type { Candidate } from '../types/index.js';
import { canonicalFacebookUrl } from '../utils/normalize.js';

function extractLink(r: any[]): string {
  if (r.length <= 14 && r[5]) {
    const text = String(r[5]);
    const m = text.match(/https?:\/\/[^\s]+/);
    if (m) return m[0];
  }
  return String(r[19] || r[6] || '');
}

function extractContact(r: any[]): string {
  if (r.length <= 14 && r[5]) {
    const text = String(r[5]);
    const m = text.match(/(?:SĐT\/Zalo:\s*|\b)(0\d{8,10}|\+84\d{8,10})\b/);
    if (m) return m[1];
  }
  return String(r[9] || '');
}

function extractFp(r: any[]): string {
  if (r.length <= 14) {
    return String(r[1] || '');
  }
  return String(r[16] || '');
}

function extractRowKey(r: any[]): string {
  return String(r[1] || r[6] || r[0] || '');
}

export function decideDuplicate(c: Candidate, history: any[][], batch: Candidate[]) {
  const all = [
    ...history.slice(1).map(r => ({
      link: extractLink(r),
      contact: extractContact(r),
      fp: extractFp(r),
      row: extractRowKey(r)
    })),
    ...batch.map(x => ({
      link: x.permalink || '',
      contact: x.contactKey,
      fp: x.needFingerprint,
      row: x.canonicalKey
    }))
  ];

  const link = canonicalFacebookUrl(c.permalink || '');
  let m = all.find(x => link && canonicalFacebookUrl(x.link.split('|')[0].trim()) === link);
  if (m) return { decision: 'DUPLICATE' as const, rule: 'LINK', matched: m.row };

  m = all.find(x => (c.contactKey && x.contact === c.contactKey) || (c.needFingerprint && x.fp && x.fp === c.needFingerprint));
  if (m) return { decision: 'DUPLICATE' as const, rule: 'CONTACT_NEED', matched: m.row };

  return { decision: 'NEW' as const, rule: 'NONE', matched: '' };
}
