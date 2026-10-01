import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { FacebookScanner } from '../browser/scanner.js';
import { loadGroups, loadRules, loadLeadOutput, markGroup, writeLead } from '../sheets/repository.js';
import { classify } from '../ai/classifier.js';
import { canonicalFacebookUrl, contactKey, fingerprint, hash } from '../utils/normalize.js';
import { decideDuplicate } from '../dedup/engine.js';
import type { Candidate } from '../types/index.js';
import { env } from '../config/env.js';

export async function runScan(opts: { stt?: number[]; priority?: string[]; limit?: number } = {}) {
  const id = `scan_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${crypto.randomBytes(2).toString('hex')}`;
  let groups = await loadGroups();
  if (opts.stt?.length) groups = groups.filter(g => opts.stt!.includes(g.stt));
  if (opts.priority?.length) groups = groups.filter(g => opts.priority!.includes(g.priority));
  if (opts.limit && opts.limit > 0) groups = groups.slice(0, opts.limit);

  const rules = await loadRules();
  const history = await loadLeadOutput();
  const batch: Candidate[] = [];

  // Khởi tạo tập khóa trùng từ cả SQLite và Google Sheet
  const existingKeys = new Set<string>();

  // 1. Lấy tất cả bài viết đã từng quét (cả Lead lẫn Reject) trong SQLite
  const dbKeys = db.prepare('SELECT canonical_key FROM candidates WHERE canonical_key IS NOT NULL').all() as { canonical_key: string }[];
  dbKeys.forEach(k => existingKeys.add(k.canonical_key));

  // 2. Lấy tất cả bài viết đã ghi trong Google Sheet 'LEAD OUTPUT'
  history.slice(1).forEach(r => {
    const normLink = String(r[19] || r[6] || '').trim();
    if (normLink) existingKeys.add(hash(canonicalFacebookUrl(normLink)));
    const uniqueKey = String(r[16] || '').trim();
    if (uniqueKey) existingKeys.add(uniqueKey);
  });

  db.prepare('INSERT INTO scan_runs(id,status,started_at,window_hours,groups_total) VALUES(?,?,?,?,?)').run(
    id,
    'RUNNING',
    new Date().toISOString(),
    env.SCAN_WINDOW_HOURS,
    groups.length
  );

  console.log(`\n=============================================================`);
  console.log(`🚀 Bắt đầu phiên quét [ID: ${id}] cho ${groups.length} nhóm Facebook`);
  console.log(`=============================================================`);

  const scanner = new FacebookScanner();
  await scanner.start();

  try {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      console.log(`\n[${i + 1}/${groups.length}] 🔍 Đang quét nhóm [STT: ${g.stt}] ${g.name}...`);
      try {
        const r = await scanner.scanGroup(g);
        console.log(`  └─ Cào được ${r.posts.length} bài viết. Đang phân loại AI và lọc trùng...`);
        let leads = 0;
        let skippedDups = 0;

        for (const post of r.posts) {
          const postKey = hash(canonicalFacebookUrl(post.permalink || `${g.stt}|${post.author}|${post.text}`));

          // BỎ QUA TRƯỚC KHI GỌI AI: Nếu bài viết đã có trong DB hoặc Sheet -> 0 Token tiêu tốn!
          if (existingKeys.has(postKey) || batch.some(b => b.canonicalKey === postKey)) {
            skippedDups++;
            continue;
          }

          // Chỉ gọi AI phân loại đối với các bài viết MỚI chưa từng xuất hiện
          const cl = await classify(post, rules);

          // Nếu bài viết không phải nhu cầu mua (quảng cáo, bán hàng, spam, etc.)
          if (!cl.buyerIntent || cl.decision === 'REJECT') {
            // Lưu lại hash bài viết bị từ chối vào SQLite để các lần quét sau KHÔNG TỐN TOKEN phân loại lại!
            db.prepare(
              'INSERT INTO candidates(run_id,group_stt,canonical_key,contact_key,need_fingerprint,payload_json,decision,matched_existing) VALUES(?,?,?,?,?,?,?,?)'
            ).run(id, g.stt, postKey, '', '', JSON.stringify({ author: post.author, permalink: post.permalink }), 'REJECT', '');
            existingKeys.add(postKey);
            continue;
          }

          const c: Candidate = {
            ...post,
            classification: cl,
            canonicalKey: postKey,
            contactKey: contactKey(post.contact || ''),
            needFingerprint: fingerprint(post.author, cl.services, cl.needSummary)
          };

          const d = decideDuplicate(c, history, batch);
          c.classification.decision = d.decision;

          if (d.decision === 'NEW') {
            batch.push(c);
            existingKeys.add(postKey);
            leads++;
            console.log(`  ⭐ Lead MỚI (${cl.temperature}): ${c.author} - ${cl.services.join(', ')} | "${cl.needSummary.slice(0, 60)}..."`);
            await writeLead(c, id);
          }

          db.prepare(
            'INSERT INTO candidates(run_id,group_stt,canonical_key,contact_key,need_fingerprint,payload_json,decision,matched_existing) VALUES(?,?,?,?,?,?,?,?)'
          ).run(id, g.stt, c.canonicalKey, c.contactKey, c.needFingerprint, JSON.stringify(c), d.decision, d.matched);
        }

        db.prepare('INSERT OR REPLACE INTO checkpoints VALUES(?,?,?,?,?,?,?,?,?)').run(
          id,
          g.stt,
          r.canonical,
          'SUCCESS',
          r.posts.length,
          r.lastTime || '',
          leads,
          '',
          new Date().toISOString()
        );

        await markGroup(g.row, leads);
        db.prepare('UPDATE scan_runs SET groups_completed=groups_completed+1,posts_reviewed=posts_reviewed+?,new_count=new_count+? WHERE id=?').run(
          r.posts.length,
          leads,
          id
        );

        console.log(`  ✅ Hoàn tất nhóm STT ${g.stt}: Bỏ qua ${skippedDups} bài trùng (0 token) | Ghi nhận ${leads} lead mới.`);
      } catch (e) {
        console.error(`  ❌ Lỗi quét nhóm STT ${g.stt}:`, e);
        db.prepare('INSERT OR REPLACE INTO checkpoints VALUES(?,?,?,?,?,?,?,?,?)').run(
          id,
          g.stt,
          g.url,
          'ERROR',
          0,
          '',
          0,
          String(e),
          new Date().toISOString()
        );
      }
    }

    db.prepare('UPDATE scan_runs SET status=?,finished_at=? WHERE id=?').run('COMPLETED', new Date().toISOString(), id);
    console.log(`\n🎉 Đã hoàn tất phiên quét! Tổng cộng tìm được ${batch.length} lead mới.`);
    return { id, totalLeads: batch.length };
  } finally {
    await scanner.stop();
  }
}

export function status(id?: string) {
  return id
    ? db.prepare('SELECT * FROM scan_runs WHERE id=?').get(id)
    : db.prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1').get();
}

export function report(id: string) {
  return {
    run: status(id),
    groups: db.prepare('SELECT * FROM checkpoints WHERE run_id=? ORDER BY group_stt').all(id),
    candidates: db.prepare('SELECT decision,count(*) count FROM candidates WHERE run_id=? GROUP BY decision').all(id)
  };
}
