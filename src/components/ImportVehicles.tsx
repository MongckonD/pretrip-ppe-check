/**
 * Settings → import box → "ทะเบียนรถ": add / update vehicles from Excel or CSV (columns ทะเบียน · ประเภทรถ).
 * The server matches plates the way the database does (spaces, "-" and "." ignored); a vehicle that was
 * deleted (switched off) comes back with its history. Checked first, then imported in one atomic request.
 */
import { useRef, useState } from 'react';
import { importVehicles, isTestMode, type VehImportIn, type VehImportOut, type VehImportResult } from '../lib/api';
import { readSheet, toCsvBom } from '../lib/sheet';
import { downloadText, errMsg } from '../lib/utils';
import { useMaster } from './MasterContext';
import { useToast } from './Toast';

const HEAD = { plate: 'ทะเบียน', type: 'ประเภทรถ' } as const;
const ALIASES: Record<'plate' | 'type', string[]> = {
  plate: ['ทะเบียน', 'ทะเบียนรถ', 'เลขทะเบียน', 'plate', 'plateno', 'licenseplate', 'registration', 'vehicleno', 'license'],
  type: ['ประเภทรถ', 'ประเภท', 'type', 'vehicletype', 'model'],
};
const key = (s: string) => s.toLowerCase().replace(/[\s._\-()/:]/g, '');
function fieldOf(h: string): 'plate' | 'type' | null {
  const k = key(h);
  return (['plate', 'type'] as const).find((f) => ALIASES[f].some((a) => key(a) === k)) ?? null;
}
const TXT: Record<VehImportOut['vehicle'], [string, string]> = {
  new: ['รถใหม่', 'p'], update: ['อัปเดต', 'w'], same: ['มีอยู่แล้ว', 'x'], error: ['มีปัญหา', 'f'],
};
type Step = 'idle' | 'checking' | 'checked' | 'importing' | 'done';

export function ImportVehicles() {
  const { reload } = useMaster();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('idle');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<VehImportIn[]>([]);
  const [check, setCheck] = useState<VehImportResult | null>(null);
  const [done, setDone] = useState<VehImportResult | null>(null);
  const [error, setError] = useState('');

  function template() {
    downloadText('vehicle-import-template.csv', toCsvBom([
      [HEAD.plate, HEAD.type],
      ['1กก 1234', '6 ล้อ'],
      ['82-7541', '4 ล้อ'],
    ]), 'text/csv;charset=utf-8');
  }

  async function pick(file: File) {
    setError(''); setCheck(null); setDone(null); setFileName(file.name); setStep('checking');
    try {
      const sheet = await readSheet(file);
      const h = sheet.slice(0, 10).findIndex((r) => r.some((c) => fieldOf(c) === 'plate'));
      if (h < 0) throw new Error(`ไม่พบหัวคอลัมน์ "${HEAD.plate}" ในไฟล์ — ใช้ไฟล์ตัวอย่างเป็นแบบ`);
      const cols = sheet[h].map(fieldOf);
      const list: VehImportIn[] = [];
      sheet.slice(h + 1).forEach((r, i) => {
        if (!r.some((c) => String(c ?? '').trim())) return;
        const get = (f: 'plate' | 'type') => { const j = cols.indexOf(f); return j >= 0 ? String(r[j] ?? '').trim() : ''; };
        list.push({ line: h + i + 2, plate: get('plate'), type: get('type') });
      });
      if (!list.length) throw new Error('ไฟล์ไม่มีแถวข้อมูลใต้หัวคอลัมน์');
      setRows(list);
      setCheck(await importVehicles(list, false));
      setStep('checked');
    } catch (e) {
      setError(errMsg(e)); setStep('idle');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function run() {
    if (!check) return;
    const good = rows.filter((_, i) => !check.rows[i].errors.length);
    if (!good.length) return;
    const skip = check.summary.errors ? `\n• ข้าม ${check.summary.errors} แถวที่มีปัญหา` : '';
    if (!window.confirm(`นำเข้า ${good.length} แถว?\n\n• รถใหม่ ${check.summary.new_vehicles} คัน · อัปเดต ${check.summary.updated_vehicles} คัน${skip}`)) return;
    setStep('importing'); setError('');
    try {
      const res = await importVehicles(good, true);
      setDone(res); setStep('done');
      await reload();
      toast(`นำเข้าทะเบียนรถแล้ว ${res.rows.filter((r) => !r.errors.length).length} แถว`);
    } catch (e) {
      setError(`นำเข้าไม่สำเร็จ: ${errMsg(e)} — ยังไม่มีอะไรถูกบันทึก`); setStep('checked');
    }
  }
  function reset() { setStep('idle'); setCheck(null); setDone(null); setRows([]); setFileName(''); setError(''); }

  if (isTestMode) return <div className="empty">โหมดทดสอบ: ใช้ได้เมื่อเชื่อมระบบจริง</div>;
  const shown = done ?? check;

  return (
    <>
      <ol className="imp-steps">
        <li>
          <b>ดาวน์โหลดไฟล์ตัวอย่าง</b> แล้วกรอกใน Excel (หรือใช้ไฟล์ที่ export จาก SAP ที่มีหัวคอลัมน์ตรงกัน)
          <div className="row mt-s"><button type="button" className="btn ghost sm" onClick={template}>⬇ ไฟล์ตัวอย่าง (.csv)</button></div>
          <details className="imp-help">
            <summary>คอลัมน์ในไฟล์</summary>
            <table className="imp-cols">
              <tbody>
                <tr><th>{HEAD.plate} *</th><td>ถ้ามีในระบบแล้วจะอัปเดตคันเดิม (เทียบโดยไม่สนช่องว่าง - และ .) · รถที่เคยลบไปจะเปิดใช้งานคืนพร้อมประวัติเดิม</td></tr>
                <tr><th>{HEAD.type}</th><td>เช่น 4 ล้อ, 6 ล้อ · เว้นว่าง = ใช้ประเภทเดิม</td></tr>
              </tbody>
            </table>
          </details>
        </li>
        <li>
          <b>เลือกไฟล์</b> ระบบจะตรวจทุกแถวก่อน ยังไม่บันทึกอะไร
          <div className="row mt-s">
            <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="imp-file" aria-label="เลือกไฟล์ทะเบียนรถ Excel หรือ CSV" disabled={step === 'checking' || step === 'importing'}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
          </div>
        </li>
      </ol>

      {step === 'checking' && <div className="note">กำลังอ่านและตรวจไฟล์ {fileName}…</div>}
      {error && <div className="form-error" role="alert">{error}</div>}

      {shown && (
        <div className="imp-result">
          {done ? <div className="imp-done">✓ นำเข้าแล้ว {done.rows.filter((r) => !r.errors.length).length} แถวจาก {fileName}</div> : check && (
            <div className="imp-sum">
              <span><b>{check.summary.rows}</b> แถว</span>
              <span className="new"><b>{check.summary.new_vehicles}</b> รถใหม่</span>
              <span className="upd"><b>{check.summary.updated_vehicles}</b> อัปเดต</span>
              {check.summary.errors > 0 && <span className="err"><b>{check.summary.errors}</b> แถวมีปัญหา (จะข้าม)</span>}
            </div>
          )}
          <div className="imp-scroll">
            <table className="vs-tbl imp-tbl">
              <thead><tr><th className="num">แถว</th><th>ทะเบียน</th><th>ประเภทรถ</th><th>ผล</th><th>รายละเอียด</th></tr></thead>
              <tbody>
                {shown.rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'imp-bad' : ''}>
                    <td className="num">{r.line}</td>
                    <td>{r.plate || '—'}</td>
                    <td className="note">{r.type || '—'}</td>
                    <td><span className={`pill ${TXT[r.vehicle][1]}`}>{TXT[r.vehicle][0]}</span></td>
                    <td className="imp-detail">{r.errors.length ? r.errors.join(' · ') : r.changes.join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row spread">
            <button type="button" className="btn ghost sm" onClick={reset}>{done ? 'นำเข้าไฟล์อื่น' : 'ยกเลิก'}</button>
            {!done && check && (
              <button type="button" className="btn" disabled={step === 'importing' || check.summary.rows === check.summary.errors} onClick={run}>
                {step === 'importing' ? 'กำลังนำเข้า…' : `นำเข้า ${check.summary.rows - check.summary.errors} แถว`}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
