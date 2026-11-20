/**
 * Read the first sheet of an .xlsx or .csv file into rows of text — no library.
 *   .xlsx = a zip of XML files: unzipped with the browser's DecompressionStream, read with DOMParser.
 *   .csv  = UTF-8 (with or without BOM); a Thai CSV saved by Excel as "CSV (Comma delimited)" is
 *           Windows-874, detected when UTF-8 decoding fails.
 * Old binary .xls is not supported (open it in Excel and save as .xlsx or CSV).
 */

export async function readSheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith('.xls') && !isZip(buf)) throw new Error('ไฟล์ .xls แบบเก่ายังอ่านไม่ได้ — เปิดใน Excel แล้วบันทึกเป็น .xlsx หรือ CSV');
  if (isZip(buf)) return readXlsx(buf);
  if (name.endsWith('.csv') || name.endsWith('.txt') || !name.includes('.')) return parseCsv(decodeText(buf));
  throw new Error('รองรับเฉพาะไฟล์ .xlsx และ .csv');
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

function decodeText(b: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-874').decode(b);
  }
}

/** RFC 4180 CSV (quotes, "" escapes, CRLF / LF) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* ---------------- xlsx ---------------- */

async function unzip(b: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // end of central directory: last 0x06054b50 within the final 64 KB
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ไฟล์ Excel เสียหรือไม่ใช่ไฟล์ .xlsx');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    // only the parts we read
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = b.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflate(raw));
  }
  return files;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์นี้อ่านไฟล์ Excel ไม่ได้ — ใช้ไฟล์ CSV หรืออัปเดตเบราว์เซอร์');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const xml = (b?: Uint8Array) => (b ? new DOMParser().parseFromString(new TextDecoder().decode(b), 'application/xml') : null);
const byTag = (d: Document | Element, tag: string) => [...d.getElementsByTagName(tag)];
const textOf = (el: Element) => byTag(el, 't').map((t) => t.textContent ?? '').join('');

/** "AB12" → column index 27 */
const colIndex = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

async function readXlsx(b: Uint8Array): Promise<string[][]> {
  const files = await unzip(b);
  // first sheet in workbook order → its file through the relationships
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = xml(files.get('xl/workbook.xml'));
  const rels = xml(files.get('xl/_rels/workbook.xml.rels'));
  const first = wb && byTag(wb, 'sheet')[0];
  const rid = first?.getAttribute('r:id');
  const target = rid && rels && byTag(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
  if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheet = xml(files.get(sheetPath));
  if (!sheet) throw new Error('ไม่พบแผ่นงานในไฟล์ Excel');

  const ssDoc = xml(files.get('xl/sharedStrings.xml'));
  const shared = ssDoc ? byTag(ssDoc, 'si').map(textOf) : [];

  const rows: string[][] = [];
  for (const r of byTag(sheet, 'row')) {
    const rowNo = Number(r.getAttribute('r')) || rows.length + 1;
    const out: string[] = [];
    for (const c of byTag(r, 'c')) {
      const t = c.getAttribute('t');
      const v = byTag(c, 'v')[0]?.textContent ?? '';
      const val = t === 's' ? shared[Number(v)] ?? ''
        : t === 'inlineStr' ? textOf(c)
        : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
        : v;
      const ref = c.getAttribute('r');
      out[ref ? colIndex(ref) : out.length] = val;
    }
    rows[rowNo - 1] = Array.from(out, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}

/** CSV text with a BOM so Excel opens Thai correctly */
export function toCsvBom(rows: (string | number)[][]) {
  const q = (c: string | number) => { const s = String(c ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
}
