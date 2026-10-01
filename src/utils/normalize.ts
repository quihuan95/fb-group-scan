import {createHash} from 'node:crypto';
export const clean=(s='')=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
export const canonicalFacebookUrl=(u='')=>{try{const x=new URL(u);x.search='';x.hash='';x.hostname='www.facebook.com';return x.toString().replace(/\/$/,'')}catch{return clean(u)}};
export const contactKey=(s='')=>{const d=s.replace(/\D/g,'');return d.startsWith('84')?'0'+d.slice(2):d};
export const phones=(s='')=>[...new Set((s.match(/(?:\+?84|0)[\s.\-]?(?:\d[\s.\-]?){8,10}/g)||[]).map(contactKey).filter(x=>x.length>=9))];
export const hash=(s:string)=>createHash('sha256').update(clean(s).toLowerCase()).digest('hex');
export const fingerprint=(author:string,services:string[],need:string)=>hash(`${clean(author)}|${[...services].sort().join(',')}|${clean(need)}`);
