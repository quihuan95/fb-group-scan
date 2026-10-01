import { runScan, report, status } from './jobs/runner.js';
import { loginFacebook } from './browser/scanner.js';

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'scan') {
  const limitArg = args.find(x => x.startsWith('--limit=') || x.startsWith('-n='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  
  // Hỗ trợ cả cú pháp `scan 20` (nếu chỉ truyền 1 số duy nhất thì kiểm tra xem có phải limit hay stt)
  // và `scan --limit=20`, hoặc danh sách STT cụ thể `scan 1,2,3,4,5`
  const rawStt = args.find(x => x.startsWith('--stt='))?.split('=')[1] || 
    (!limitArg && args.length > 0 ? args.join(' ').match(/\d+/g)?.join(',') : undefined);
    
  const stt = rawStt ? rawStt.split(',').map(Number) : undefined;
  
  console.log(await runScan({ stt, limit }));
} else if (cmd === 'preview') {
  const rawStt = args.find(x => x.startsWith('--stt='))?.split('=')[1] || args.find(x => /^\d+$/.test(x)) || '1';
  const stt = Number(rawStt);
  const { loadGroups } = await import('./sheets/repository.js');
  const { FacebookScanner } = await import('./browser/scanner.js');
  const groups = await loadGroups();
  const target = groups.find(g => g.stt === stt) || groups[0];
  console.log(`\n🔍 Đang quét thử nhóm [STT: ${target.stt}] ${target.name} (${target.url})...`);
  const scanner = new FacebookScanner();
  await scanner.start();
  try {
    const res = await scanner.scanGroup(target);
    console.log(`\n==================================================`);
    console.log(`✅ Kết quả: Cào được ${res.posts.length} bài viết thực tế từ Facebook!`);
    console.log(`==================================================\n`);
    res.posts.slice(0, 5).forEach((p, i) => {
      console.log(`--- [Bài viết #${i + 1}] ---`);
      console.log(`👤 Tác giả: ${p.author}`);
      console.log(`⏰ Thời gian: ${p.postedLabel || 'N/A'}`);
      console.log(`📞 SĐT: ${p.contact || 'Không có'}`);
      console.log(`🔗 Link bài: ${p.permalink || 'N/A'}`);
      console.log(`📝 Nội dung: ${p.text.slice(0, 250).replace(/\n+/g, ' ')}...\n`);
    });
    if (res.posts.length > 5) console.log(`... và còn ${res.posts.length - 5} bài viết khác.`);
  } finally {
    await scanner.stop();
  }
} else if (cmd === 'login') {
  await loginFacebook();
} else if (cmd === 'status') {
  console.log(status(args[0]));
} else if (cmd === 'report') {
  console.log(JSON.stringify(report(args[0]), null, 2));
} else {
  console.log('Usage: npm run login | npm run preview [stt] | npm run scan [--limit=20] [stt] | tsx src/cli.ts status [runId] | report <runId>');
}
