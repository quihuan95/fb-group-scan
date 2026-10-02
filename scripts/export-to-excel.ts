import fs from 'node:fs';
import ExcelJS from 'exceljs';

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

async function createExcelWorkbook() {
  const rules: Rule[] = JSON.parse(fs.readFileSync('product_rules.json', 'utf8'));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'The HBG Lead Scanner';
  workbook.created = new Date();

  // Color Palette
  const headerFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E79' } // Deep Navy Blue
  };
  const headerFont: Partial<ExcelJS.Font> = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFFFF' }
  };
  const bodyFont: Partial<ExcelJS.Font> = {
    name: 'Segoe UI',
    size: 10
  };
  const borderStyle: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
    left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
    bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
    right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
  };

  // -------------------------------------------------------------
  // SHEET 1: Chi tiết 11 Hạng mục (Đầy đủ thuộc tính)
  // -------------------------------------------------------------
  const wsDetail = workbook.addWorksheet('Chi tiết 11 Hạng mục', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  wsDetail.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Hạng mục dịch vụ', key: 'service', width: 18 },
    { header: 'Nhân sự phụ trách', key: 'staff', width: 18 },
    { header: 'Đối tượng khách hàng mục tiêu', key: 'target', width: 45 },
    { header: 'Nhu cầu cụ thể & Trigger nhận diện', key: 'needs', width: 45 },
    { header: 'Từ khóa chính (Main)', key: 'main', width: 35 },
    { header: 'Từ khóa mở rộng (Expanded)', key: 'expanded', width: 45 },
    { header: 'Từ khóa loại trừ (Excluded)', key: 'excluded', width: 35 },
    { header: 'Tiêu chuẩn HOT / WARM', key: 'hotWarm', width: 40 },
    { header: 'Lưu ý vận hành & Bán hàng', key: 'notes', width: 40 }
  ];

  rules.forEach((r, idx) => {
    const row = wsDetail.addRow({
      stt: idx + 1,
      service: r.service,
      staff: staffMap[r.service] || 'Team',
      target: r.target || '',
      needs: r.needs || '',
      main: (r.main || []).join('\n'),
      expanded: (r.expanded || []).join('\n'),
      excluded: (r.excluded || []).join('\n'),
      hotWarm: r.hotWarm || '',
      notes: r.notes || ''
    });

    row.font = bodyFont;
    row.alignment = { vertical: 'top', wrapText: true };

    // Zebra striping
    if (idx % 2 === 1) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF9FAFB' }
      };
    }

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = borderStyle;
    });
  });

  // Style Header Row Sheet 1
  const headerRow1 = wsDetail.getRow(1);
  headerRow1.height = 30;
  headerRow1.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = borderStyle;
  });

  // -------------------------------------------------------------
  // SHEET 2: Tổng quan & Tra cứu nhanh (Compact Summary)
  // -------------------------------------------------------------
  const wsSummary = workbook.addWorksheet('Tổng quan & Tra cứu nhanh', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  wsSummary.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Hạng mục dịch vụ', key: 'service', width: 20 },
    { header: 'Nhân sự phụ trách', key: 'staff', width: 18 },
    { header: 'Tỷ lệ & Đối tượng mục tiêu', key: 'targetBrief', width: 40 },
    { header: 'Từ khóa chính tiêu biểu', key: 'mainBrief', width: 35 },
    { header: 'Dấu hiệu loại trừ cốt lõi', key: 'excludedBrief', width: 35 },
    { header: 'Tiêu chí Lead HOT', key: 'hotBrief', width: 35 }
  ];

  rules.forEach((r, idx) => {
    const mainSample = (r.main || []).slice(0, 5).join(', ');
    const excludedSample = (r.excluded || []).slice(0, 5).join(', ');
    const targetBrief = (r.target || '').split('\n').filter(Boolean).slice(0, 2).join('\n');
    const hotLines = (r.hotWarm || '').split('\n').filter(l => /hot/i.test(l) || l.includes('gấp')).join('\n') || (r.hotWarm || '').split('\n')[0];

    const row = wsSummary.addRow({
      stt: idx + 1,
      service: r.service,
      staff: staffMap[r.service] || 'Team',
      targetBrief,
      mainBrief: mainSample,
      excludedBrief: excludedSample,
      hotBrief: hotLines
    });

    row.font = bodyFont;
    row.alignment = { vertical: 'top', wrapText: true };

    if (idx % 2 === 1) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF9FAFB' }
      };
    }

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = borderStyle;
    });
  });

  const headerRow2 = wsSummary.getRow(1);
  headerRow2.height = 30;
  headerRow2.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = borderStyle;
  });

  // -------------------------------------------------------------
  // SHEET 3: Danh sách từ khóa phẳng (Flat Keywords List)
  // -------------------------------------------------------------
  const wsKeywords = workbook.addWorksheet('Danh sách từ khóa (Keywords)', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  wsKeywords.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Hạng mục dịch vụ', key: 'service', width: 20 },
    { header: 'Phân loại từ khóa', key: 'type', width: 22 },
    { header: 'Từ khóa / Cụm từ', key: 'keyword', width: 45 }
  ];

  let kwStt = 1;
  rules.forEach((r) => {
    (r.main || []).forEach(kw => {
      wsKeywords.addRow({
        stt: kwStt++,
        service: r.service,
        type: '1. Từ khóa chính (Main)',
        keyword: kw
      });
    });
    (r.expanded || []).forEach(kw => {
      wsKeywords.addRow({
        stt: kwStt++,
        service: r.service,
        type: '2. Từ khóa mở rộng (Expanded)',
        keyword: kw
      });
    });
    (r.excluded || []).forEach(kw => {
      wsKeywords.addRow({
        stt: kwStt++,
        service: r.service,
        type: '3. Từ khóa LOẠI TRỪ (Excluded)',
        keyword: kw
      });
    });
  });

  wsKeywords.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.height = 28;
      row.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = borderStyle;
      });
    } else {
      row.font = bodyFont;
      row.alignment = { vertical: 'middle' };
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = borderStyle;
      });
      const typeVal = String(row.getCell('type').value || '');
      if (typeVal.includes('LOẠI TRỪ')) {
        row.getCell('type').font = { ...bodyFont, color: { argb: 'FFDC2626' }, bold: true };
      } else if (typeVal.includes('chính')) {
        row.getCell('type').font = { ...bodyFont, color: { argb: 'FF16A34A' }, bold: true };
      }
    }
  });

  // Enable AutoFilter for Sheet 3
  wsKeywords.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: kwStt, column: 4 }
  };

  const outputPath = 'QUY_TAC_TIM_KIEM_11_HANG_MUC.xlsx';
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Excel file created successfully: ${outputPath}`);

  // Generate CSV (UTF-8 BOM for Excel compatibility)
  function escapeCsv(val: any): string {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  const csvHeaders = ['STT', 'Hạng mục dịch vụ', 'Nhân sự phụ trách', 'Đối tượng khách hàng mục tiêu', 'Nhu cầu cụ thể & Trigger', 'Từ khóa chính', 'Từ khóa mở rộng', 'Từ khóa loại trừ', 'Tiêu chuẩn HOT / WARM', 'Lưu ý vận hành'];
  let csvContent = '\uFEFF' + csvHeaders.map(escapeCsv).join(',') + '\r\n';

  rules.forEach((r, idx) => {
    const row = [
      idx + 1,
      r.service,
      staffMap[r.service] || 'Team',
      r.target || '',
      r.needs || '',
      (r.main || []).join('; '),
      (r.expanded || []).join('; '),
      (r.excluded || []).join('; '),
      r.hotWarm || '',
      r.notes || ''
    ];
    csvContent += row.map(escapeCsv).join(',') + '\r\n';
  });

  fs.writeFileSync('QUY_TAC_TIM_KIEM_11_HANG_MUC.csv', csvContent, 'utf8');
  console.log('CSV file created successfully: QUY_TAC_TIM_KIEM_11_HANG_MUC.csv');
}

createExcelWorkbook().catch(console.error);
