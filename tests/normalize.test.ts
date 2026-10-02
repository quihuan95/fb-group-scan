import { describe, it, expect } from 'vitest';
import { canonicalFacebookUrl, contactKey, fingerprint } from '../src/utils/normalize.js';
import { parseCsv } from '../src/utils/csv.js';

describe('normalize', () => {
  it('canonicalizes facebook links', () => expect(canonicalFacebookUrl('https://m.facebook.com/groups/1/posts/2/?x=1#y')).toBe('https://www.facebook.com/groups/1/posts/2'));
  it('normalizes VN phone', () => expect(contactKey('+84 912-345-678')).toBe('0912345678'));
  it('fingerprint stable', () => expect(fingerprint('A', ['Xe', 'Vé'], ' Cần xe ')).toBe(fingerprint('A', ['Vé', 'Xe'], 'Cần xe')));
  it('parses CSV with multiline and quotes', () => {
    const csv = '"1","Sự kiện","Hà Nội\nĐà Nẵng","A"\n"2","Thiết bị","TP.HCM","B"';
    const rows = parseCsv(csv);
    expect(rows.length).toBe(2);
    expect(rows[0][0]).toBe('1');
    expect(rows[0][1]).toBe('Sự kiện');
    expect(rows[0][2]).toBe('Hà Nội\nĐà Nẵng');
    expect(rows[1][1]).toBe('Thiết bị');
  });
});
