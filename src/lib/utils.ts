export const today = () => new Date().toLocaleDateString('sv-SE');
export const nowTime = () => new Date().toTimeString().slice(0, 5);
export const pad2 = (n: number | string) => String(n).padStart(2, '0');

export const PHOTO_STATUS: Record<number, string> = { 0: 'ยังไม่ส่ง', 2: 'ส่งไม่ครบ', 1: 'ส่งครบ' };

export function photoStatus(count: number, required: number): 0 | 1 | 2 {
  return count >= required ? 1 : count > 0 ? 2 : 0;
}

export function countBy<T>(obj: Record<string | number, T> | undefined, v: T) {
  return Object.values(obj ?? {}).filter((x) => x === v).length;
}

export function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${month}-${pad2(i + 1)}`);
}

export function monthRange(month: string) {
  const days = daysInMonth(month);
  return { from: days[0], to: days[days.length - 1] };
}

export function toCsv(rows: (string | number)[][]) {
  const q = (c: string | number) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errMsg(e: unknown) {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: string }).message);
  return String(e);
}
