import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { FacebookScanner } from '../browser/scanner.js';
import { loadGroups, loadRules, loadLeadOutput, markGroup, writeLead, writeLeads, formatRawDataRow } from '../sheets/repository.js';
import { classify } from '../ai/classifier.js';
import { canonicalFacebookUrl, contactKey, fingerprint, hash, toOriginalPostOnly } from '../utils/normalize.js';
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

  // 2. Lấy tất cả bài viết đã ghi trong Google Sheet
  history.slice(1).forEach(r => {
    let link = '';
    if (r.length <= 14 && r[5]) {
      const m = String(r[5]).match(/https?:\/\/[^\s]+/);
      if (m) link = m[0];
    }
    if (!link) link = String(r[19] || r[6] || '').trim();
    if (link) existingKeys.add(hash(canonicalFacebookUrl(link)));

    const uniqueKey = String(r[1] || r[16] || '').trim();
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
        console.log(`  └─ Cào được ${r.posts.length} bài viết. Đang kiểm tra trùng lặp...`);
        let leads = 0;
        let skippedDups = 0;

        // 1. Lọc trước các bài đã biết trong CSDL / Sheet -> 0 token, 0 thời gian
        const postsToClassify: { post: typeof r.posts[0]; postKey: string }[] = [];
        for (const post of r.posts) {
          const postKey = hash(canonicalFacebookUrl(post.permalink || `${g.stt}|${post.author}|${post.text}`));
          if (existingKeys.has(postKey) || batch.some(b => b.canonicalKey === postKey)) {
            skippedDups++;
          } else {
            postsToClassify.push({ post, postKey });
          }
        }

        // 2. TỐI ƯU ĐỘT PHÁ: Phân loại AI song song (Parallel Classification)
        let classifiedItems: { post: typeof r.posts[0]; postKey: string; cl: any }[] = [];
        if (postsToClassify.length > 0) {
          console.log(`  └─ Phân loại đồng thời ${postsToClassify.length} bài viết mới bằng AI (tốc độ cao)...`);
          classifiedItems = await Promise.all(
            postsToClassify.map(async (item) => {
              try {
                const cl = await classify(item.post, rules);
                return { ...item, cl };
              } catch (err: any) {
                console.error(`  ⚠️ Lỗi phân loại bài của ${item.post.author}:`, err.message);
                return { ...item, cl: null };
              }
            })
          );
        }

        // 3. Xử lý kết quả phân loại & lưu CSDL
        const groupNewLeads: Candidate[] = [];

        for (const item of classifiedItems) {
          const { post, postKey, cl } = item;
          if (!cl) continue;

          // Chuẩn hóa CHỈ DỮ LIỆU BÀI ĐĂNG GỐC trước khi lưu trữ
          const originalPost = toOriginalPostOnly(post);

          // Nếu bài viết không phải nhu cầu mua (quảng cáo, bán hàng, spam, etc.)
          if (!cl.buyerIntent || cl.decision === 'REJECT') {
            db.prepare(
              'INSERT INTO candidates(run_id,group_stt,canonical_key,contact_key,need_fingerprint,payload_json,decision,matched_existing) VALUES(?,?,?,?,?,?,?,?)'
            ).run(id, g.stt, postKey, '', '', JSON.stringify({ author: originalPost.author, permalink: originalPost.postUrl }), 'REJECT', '');
            existingKeys.add(postKey);
            continue;
          }

          const c: Candidate = {
            groupStt: post.groupStt,
            groupName: post.groupName,
            canonicalGroupUrl: post.canonicalGroupUrl,
            author: originalPost.author,
            authorUrl: originalPost.authorUrl,
            postedLabel: originalPost.postedLabel,
            postedAt: post.postedAt,
            permalink: originalPost.postUrl || post.permalink,
            postId: originalPost.postId,
            text: originalPost.content,
            originalBodyText: originalPost.content,
            contact: originalPost.contact || cl.contact || undefined,
            images: originalPost.attachments || [],
            isUnclearOrObscured: originalPost.isUnclearOrObscured,
            classification: cl,
            canonicalKey: postKey,
            contactKey: contactKey(originalPost.contact || cl.contact || ''),
            needFingerprint: fingerprint(originalPost.author, cl.services, cl.needSummary)
          };

          const d = decideDuplicate(c, history, batch);
          
          if (cl.decision === 'HOLD') {
            c.classification.decision = d.decision === 'DUPLICATE' ? 'DUPLICATE' : 'HOLD';
          } else {
            c.classification.decision = d.decision;
          }

          if (c.classification.decision === 'NEW') {
            batch.push(c);
            existingKeys.add(postKey);
            leads++;
            groupNewLeads.push(c);
            console.log(`  ⭐ Lead MỚI (${cl.temperature}): ${c.author} - ${cl.services.join(', ')} | "${cl.needSummary.slice(0, 60)}..."`);
          } else if (c.classification.decision === 'HOLD') {
            existingKeys.add(postKey);
            console.log(`  ⏸️ Bài viết diện RÀ SOÁT / HOLD: ${c.author} | "${cl.needSummary.slice(0, 60)}..."`);
          }

          db.prepare(
            'INSERT INTO candidates(run_id,group_stt,canonical_key,contact_key,need_fingerprint,payload_json,decision,matched_existing) VALUES(?,?,?,?,?,?,?,?)'
          ).run(id, g.stt, c.canonicalKey, c.contactKey, c.needFingerprint, JSON.stringify(c), c.classification.decision, d.matched);
        }

        // 4. Ghi batch tất cả lead mới của nhóm vào Google Sheet 1 lần duy nhất (nhanh gấp 3 lần ghi lẻ)
        if (groupNewLeads.length > 0) {
          await writeLeads(groupNewLeads, id);
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

      if (i < groups.length - 1) {
        const delaySec = Math.floor(Math.random() * 2) + 2; // 2-3s an toàn, tiết kiệm thời gian
        console.log(`  ⏳ Nghỉ an toàn ${delaySec}s trước khi chuyển nhóm tiếp theo...`);
        await new Promise(r => setTimeout(r, delaySec * 1000));
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

export async function syncLeadsToSheet() {
  const newCandidates = db.prepare("SELECT * FROM candidates WHERE decision='NEW'").all() as any[];
  if (!newCandidates.length) {
    console.log('ℹ️ Không có lead nào trong CSDL SQLite cần đồng bộ.');
    return { synced: 0 };
  }

  const history = await loadLeadOutput();
  const existingUuids = new Set<string>();
  const existingLinks = new Set<string>();
  const existingKeys = new Set<string>();

  history.slice(1).forEach(r => {
    // Col B (UUID)
    const uuid = String(r[1] || '').trim();
    if (uuid) existingUuids.add(uuid);

    // Link
    let link = '';
    if (r.length <= 14 && r[5]) {
      const m = String(r[5]).match(/https?:\/\/[^\s]+/);
      if (m) link = m[0];
    }
    if (!link) link = String(r[19] || r[6] || '').trim();
    if (link) {
      const cleanLink = canonicalFacebookUrl(link);
      existingLinks.add(cleanLink);
      existingKeys.add(hash(cleanLink));
    }
  });

  const toSync: Candidate[] = [];
  for (const c of newCandidates) {
    try {
      const payload: Candidate = JSON.parse(c.payload_json);
      const uuid = formatRawDataRow(payload)[0];
      const link = payload.permalink ? canonicalFacebookUrl(payload.permalink) : '';

      if (uuid && existingUuids.has(uuid)) continue;
      if (link && existingLinks.has(link)) continue;
      if (c.canonical_key && existingKeys.has(c.canonical_key)) continue;

      toSync.push(payload);
      if (uuid) existingUuids.add(uuid);
      if (link) {
        existingLinks.add(link);
        existingKeys.add(hash(link));
      }
      if (c.canonical_key) existingKeys.add(c.canonical_key);
    } catch (e) {
      console.error(`❌ Lỗi parse candidate #${c.id}:`, e);
    }
  }

  const destSheetName = env.DATA_DESTINATION_SHEET || 'Tháng 10/26';
  console.log(`\n⏳ Tìm thấy ${toSync.length} lead mới chưa có trên sheet '${destSheetName}'. Đang tiến hành ghi...`);

  let synced = 0;
  const CHUNK_SIZE = 50;
  for (let i = 0; i < toSync.length; i += CHUNK_SIZE) {
    const chunk = toSync.slice(i, i + CHUNK_SIZE);
    await writeLeads(chunk);
    synced += chunk.length;
    if (i + CHUNK_SIZE < toSync.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`✅ Đã đồng bộ thành công ${synced} lead lên Google Sheet '${destSheetName}'!`);
  return { synced, total: newCandidates.length };
}
