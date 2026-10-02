import fs from 'node:fs';
import { loadRules } from '../src/sheets/repository.js';
import { values } from '../src/sheets/client.js';
import { env } from '../src/config/env.js';

async function main() {
  console.log('Fetching raw sheet values...');
  const rawSheet = await values(`'CẤU HÌNH SẢN PHẨM'!A1:J30`, env.SPREADSHEET_ID);
  
  const rules = await loadRules();
  
  // Save raw data
  fs.writeFileSync('product_rules_raw.json', JSON.stringify(rawSheet, null, 2), 'utf8');
  
  // Filter out any dummy rows
  const validRules = rules.filter(r => 
    ['Sự kiện', 'Thiết bị', 'Media', 'Thi công', 'Hội nghị MICE', 'Tiệc', 'Tour Inbound', 'Tour Outbound', 'Tour Nội địa', 'Xe', 'Vé'].includes(r.service)
  );

  fs.writeFileSync('product_rules.json', JSON.stringify(validRules, null, 2), 'utf8');
  console.log(`Saved ${validRules.length} valid product rules to product_rules.json`);
}

main().catch(console.error);
