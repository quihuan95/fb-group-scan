import fs from 'node:fs';

interface Rule {
  service: string;
  target: string;
  needs: string;
  main: string[];
  expanded: string[];
  excluded: string[];
  hotWarm: string;
  notes: string;
}

const rules: Rule[] = JSON.parse(fs.readFileSync('product_rules.json', 'utf8'));

const staffMap: Record<string, string> = {
  'Sự kiện': 'Bích Hiển',
  'Thiết bị': 'Phương Dung',
  'Media': 'Phương Dung',
  'Thi công': 'Phương Dung',
  'Hội nghị MICE': 'Nhật Chung',
  'Tiệc': 'Nhật Chung',
  'Tour Inbound': 'Hà Đỗ',
  'Tour Outbound': 'Hà Đỗ',
  'Tour Nội địa': 'Thùy Anh',
  'Xe': 'Thùy Anh',
  'Vé': 'Thùy Anh'
};

let md = '# 📋 BẢNG TỔNG HỢP QUY TẮC TÌM KIẾM & PHÂN LOẠI 11 HẠNG MỤC SẢN PHẨM\n\n';
md += '> **Tài liệu tham chiếu chuẩn** được trích xuất trực tiếp từ tab **CẤU HÌNH SẢN PHẨM** của hệ thống The HBG Lead Scanner.\n\n';

md += '## 📑 MỤC LỤC\n\n';
rules.forEach((r, idx) => {
  const staff = staffMap[r.service] || 'Team';
  md += `${idx + 1}. [${r.service} (Phụ trách: ${staff})](#hạng-mục-${idx + 1}-${r.service.toLowerCase().replace(/[\s\/-]+/g, '-')})\n`;
});

md += '\n---\n\n## 📊 BẢNG TỔNG QUAN 11 HẠNG MỤC DỊCH VỤ\n\n';
md += '| STT | Hạng mục dịch vụ | Phụ trách | Tỷ lệ khách hàng mục tiêu | Từ khóa chính tiêu biểu | Điểm loại trừ cốt lõi |\n';
md += '|:---:|:---|:---|:---|:---|:---|\n';

rules.forEach((r, idx) => {
  const staff = staffMap[r.service] || 'Team';
  const mainKw = (r.main || []).slice(0, 3).join(', ');
  const exc = (r.excluded || []).slice(0, 3).join(', ');
  const targetBrief = (r.target || '').split('\n')[0].replace(/\|/g, '/');
  md += `| ${idx + 1} | **${r.service}** | \`${staff}\` | ${targetBrief} | ${mainKw} | ${exc} |\n`;
});

md += '\n---\n\n## 🔍 CHI TIẾT QUY TẮC TỪNG HẠNG MỤC\n\n';

rules.forEach((r, idx) => {
  const staff = staffMap[r.service] || 'Team';
  const anchor = `hạng-mục-${idx + 1}-${r.service.toLowerCase().replace(/[\s\/-]+/g, '-')}`;
  md += `### <a id="${anchor}"></a>${idx + 1}. Hạng mục: ${r.service}\n\n`;
  md += `- **Nhân sự phụ trách tiếp nhận Lead:** \`${staff}\`\n\n`;

  md += `#### 🎯 1. Đối tượng khách hàng mục tiêu\n`;
  md += (r.target || '_Chưa có mô tả_')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => `> ${l}`)
    .join('\n\n') + '\n\n';

  md += `#### 💡 2. Nhu cầu cụ thể & Trigger nhận diện\n`;
  md += `${r.needs || '_Chưa có mô tả_'}\n\n`;

  md += `#### 🔑 3. Bộ từ khóa chính (Main Keywords)\n`;
  if (r.main && r.main.length > 0) {
    md += r.main.map(k => `- \`${k}\``).join('\n') + '\n\n';
  } else {
    md += '_Không có_\n\n';
  }

  md += `#### 🌐 4. Bộ từ khóa mở rộng (Expanded Keywords)\n`;
  if (r.expanded && r.expanded.length > 0) {
    md += r.expanded.map(k => `- \`${k}\``).join('\n') + '\n\n';
  } else {
    md += '_Không có_\n\n';
  }

  md += `#### 🚫 5. Bộ từ khóa & Dấu hiệu LOẠI TRỪ (Excluded Keywords)\n`;
  if (r.excluded && r.excluded.length > 0) {
    md += r.excluded.map(k => `- ❌ \`${k}\``).join('\n') + '\n\n';
  } else {
    md += '_Không có_\n\n';
  }

  md += `#### 🔥 6. Tiêu chuẩn đánh giá độ nóng (HOT / WARM)\n`;
  md += (r.hotWarm || '_Chưa có tiêu chí_')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => `> ${l}`)
    .join('\n\n') + '\n\n';

  md += `#### 📌 7. Lưu ý quan trọng khi quét & tư vấn\n`;
  md += `${r.notes || '_Không có lưu ý đặc biệt_'}\n\n`;

  md += '---\n\n';
});

fs.writeFileSync('RULES_TIM_KIEM_CAC_HANG_MUC.md', md, 'utf8');
console.log('Successfully written RULES_TIM_KIEM_CAC_HANG_MUC.md');
