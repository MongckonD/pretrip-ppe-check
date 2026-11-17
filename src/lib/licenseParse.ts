/**
 * Pull the three fields we keep from the text OCR reads off a Thai driving licence:
 *   full name, licence number, expiry date (or "lifetime").
 * OCR text is noisy, so every rule has a fallback and the user always checks the result before saving.
 *
 * A Thai licence card reads roughly:
 *   ใบอนุญาตขับรถยนต์ส่วนบุคคล / Private Car Driving Licence
 *   ฉบับที่ / No. 65012345
 *   วันออกใบอนุญาต 12 มกราคม 2565   Date of Issue 12 January 2022
 *   วันสิ้นอายุ 12 มกราคม 2570       Date of Expiry 12 January 2027
 *   ชื่อ นาย สมชาย ใจดี               Mr. SOMCHAI JAIDEE
 *   เกิดวันที่ …                      Date of Birth …
 *   เลขประจำตัวประชาชน 1 2345 67890 12 3
 */

export interface ParsedLicense {
  fullName?: string;
  licenseNo?: string;
  /** YYYY-MM-DD (Gregorian) */
  expiry?: string;
  lifetime?: boolean;
}

const TH_MONTHS: [RegExp, number][] = [
  [/^ม\.?ค\.?$|^มกรา/, 1], [/^ก\.?พ\.?$|^กุมภา/, 2], [/^มี\.?ค\.?$|^มีนา/, 3], [/^เม\.?ย\.?$|^เมษา/, 4],
  [/^พ\.?ค\.?$|^พฤษภา/, 5], [/^มิ\.?ย\.?$|^มิถุนา/, 6], [/^ก\.?ค\.?$|^กรกฎา/, 7], [/^ส\.?ค\.?$|^สิงหา/, 8],
  [/^ก\.?ย\.?$|^กันยา/, 9], [/^ต\.?ค\.?$|^ตุลา/, 10], [/^พ\.?ย\.?$|^พฤศจิกา/, 11], [/^ธ\.?ค\.?$|^ธันวา/, 12],
];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const pad = (n: number) => String(n).padStart(2, '0');

function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/[.,]/g, '');
  const en = EN_MONTHS.findIndex((m) => w.startsWith(m));
  if (en >= 0) return en + 1;
  const th = TH_MONTHS.find(([re]) => re.test(word.trim()));
  return th ? th[1] : null;
}

/** Buddhist-era years (2400+) → Gregorian. */
const toAD = (y: number) => (y > 2400 ? y - 543 : y);

function validDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Every date in a piece of text: "12 January 2027", "12 ม.ค. 2570", "12/01/2570", "12-01-2027". */
export function findDates(text: string): string[] {
  const out: string[] = [];
  const word = /(\d{1,2})\s*([A-Za-z฀-๿.]{2,12})\s*(\d{4})/g;
  for (const m of text.matchAll(word)) {
    const mon = monthOf(m[2]);
    if (!mon) continue;
    const d = validDate(toAD(Number(m[3])), mon, Number(m[1]));
    if (d) out.push(d);
  }
  const num = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/g;
  for (const m of text.matchAll(num)) {
    const d = validDate(toAD(Number(m[3])), Number(m[2]), Number(m[1]));
    if (d) out.push(d);
  }
  return out;
}

export function normalizeOcr(raw: string): string {
  return raw
    .replace(/[๐-๙]/g, (c) => String(THAI_DIGITS.indexOf(c)))
    // OCR often splits Thai vowels/tone marks from their letter with a space
    .replace(/([฀-๿])\s+([ัิ-ฺ็-๎])/g, '$1$2')
    .replace(/[|¦]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

const EXPIRY_LABEL = /(สิ้นอายุ|หมดอายุ|expir|exp\.?\s*date|date\s*of\s*exp)/i;
const ISSUE_LABEL = /(ออกใบ|วันออก|issue)/i;
const BIRTH_LABEL = /(เกิด|birth)/i;

function findExpiry(lines: string[]): { expiry?: string; lifetime?: boolean } {
  const all = lines.join('\n');
  if (/ตลอดชีพ|life\s*time|\blife\b/i.test(all)) return { lifetime: true };
  // 1) a date on (or right after) the "expiry" line
  for (let i = 0; i < lines.length; i++) {
    if (!EXPIRY_LABEL.test(lines[i])) continue;
    const near = findDates(lines[i]).concat(findDates(lines[i + 1] ?? ''));
    if (near.length) return { expiry: near.sort()[near.length - 1] };
  }
  // 2) otherwise the latest date that is not on an issue/birth line (expiry is the latest date on the card)
  const candidates = lines.filter((l) => !ISSUE_LABEL.test(l) && !BIRTH_LABEL.test(l)).flatMap(findDates);
  const dates = candidates.length ? candidates : lines.flatMap(findDates);
  return dates.length ? { expiry: dates.sort()[dates.length - 1] } : {};
}

function findLicenseNo(lines: string[]): string | undefined {
  // 1) a number right after "ฉบับที่" / "เลขที่" / "No."
  for (const l of lines) {
    const m = /(ฉบับที่|เลขที่|\bno\b\.?)\s*[:./]?\s*([0-9][0-9 -]{5,14}[0-9])/i.exec(l);
    if (m) {
      const n = m[2].replace(/[ -]/g, '');
      if (n.length >= 6 && n.length <= 12) return n;
    }
  }
  // 2) a standalone 8-digit number that is not part of the 13-digit national ID or a date
  for (const l of lines) {
    if (/ประชาชน|identification|id\s*no/i.test(l)) continue;
    const compact = l.replace(/(\d) (?=\d)/g, '$1');
    for (const m of compact.matchAll(/(?<!\d)(\d{8})(?!\d)/g)) {
      const y = Number(m[1].slice(4));
      const looksLikeDate = /^\d{4}(19|20|25)\d{2}$/.test(m[1]) && y > 1900;
      if (!looksLikeDate) return m[1];
    }
  }
  return undefined;
}

const TH_TITLE = /(นางสาว|น\.ส\.|นาง|นาย|ว่าที่\s*ร\.?ต\.?)/;
const EN_TITLE = /\b(mr|mrs|miss|ms)\b\.?\s*/i;

function cleanThaiName(s: string): string {
  return s
    .replace(/^.*?ชื่อ\s*(-?\s*สกุล)?\s*:?\s*/, '')
    .replace(TH_TITLE, '')
    .replace(/[^฀-๿ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findName(lines: string[]): string | undefined {
  // Thai name: the line with a title (นาย / นาง / นางสาว) or after "ชื่อ"
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!TH_TITLE.test(l) && !/^ชื่อ/.test(l)) continue;
    let name = cleanThaiName(l);
    if (name.split(' ').length < 2 && lines[i + 1] && /[฀-๿]/.test(lines[i + 1]) && !/[0-9]/.test(lines[i + 1])) {
      name = cleanThaiName(`${l} ${lines[i + 1]}`);
    }
    if (name.replace(/\s/g, '').length >= 4 && name.includes(' ')) return name;
  }
  // English name: "Mr. SOMCHAI JAIDEE"
  for (const l of lines) {
    const m = EN_TITLE.exec(l);
    if (!m) continue;
    const name = l.slice(m.index + m[0].length).replace(/[^A-Za-z .'-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.split(' ').length >= 2 && name.length >= 5) return name.toUpperCase();
  }
  return undefined;
}

export function parseLicense(raw: string): ParsedLicense {
  const lines = normalizeOcr(raw).split('\n');
  const { expiry, lifetime } = findExpiry(lines);
  return { fullName: findName(lines), licenseNo: findLicenseNo(lines), expiry, lifetime };
}
