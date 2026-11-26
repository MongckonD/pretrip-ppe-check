/**
 * Settings → "นำเข้าพนักงานจากไฟล์": add / update employees and create their sign-in accounts from Excel or CSV.
 *   1. download the template: 3 columns (code · name · role) — or an export from SAP with the same columns.
 *      Optional extra columns are still understood (สิทธิ์ · สร้างบัญชี · รหัสผ่านเริ่มต้น); without them everyone
 *      gets an account with role "user" and a temporary password
 *   2. choose the file → the server checks every row (nothing is written yet) → a table shows what will happen
 *   3. "นำเข้า" → rows without problems are imported in small chunks; new accounts get a temporary password
 *      (shown once, can be downloaded) and must set their own at the first sign-in
 * Matching is by employee code. Column names are matched loosely (Thai / English / common SAP names).
 */
import { useRef, useState } from 'react';
import { importEmployees, isTestMode, type ImportResult, type ImportRowIn, type ImportRowOut } from '../lib/api';
import { readSheet, toCsvBom } from '../lib/sheet';
import { downloadText, errMsg, today } from '../lib/utils';
import { CfgHead } from './CfgUi';
import { ConfirmButton } from './ConfirmButton';
import { ImportVehicles } from './ImportVehicles';
import { DownloadIcon, TableIcon } from './Icons';
import { useMaster } from './MasterContext';
import { useToast } from './Toast';

type Field = 'code' | 'name' | 'role' | 'access' | 'account' | 'password';
const HEAD: Record<Field, string> = {
  code: 'รหัสพนักงาน', name: 'ชื่อ-นามสกุล', role: 'ตำแหน่ง', access: 'สิทธิ์', account: 'สร้างบัญชี', password: 'รหัสผ่านเริ่มต้น',
};
/** header text → field (compared without spaces / punctuation, lower case) */
const ALIASES: Record<Field, string[]> = {
  code: ['รหัสพนักงาน', 'รหัส', 'employeecode', 'empcode', 'employeeno', 'employeenumber', 'personnelnumber', 'persno', 'pernr', 'employeeid', 'staffid'],
  name: ['ชื่อนามสกุล', 'ชื่อ', 'ชื่อพนักงาน', 'name', 'fullname', 'employeename', 'nameofemployee'],
  role: ['ตำแหน่ง', 'position', 'role', 'job', 'jobtitle'],
  access: ['สิทธิ์', 'สิทธิ์การใช้งาน', 'สิทธิการใช้งาน', 'access', 'permission', 'userrole'],
  account: ['สร้างบัญชี', 'บัญชี', 'account', 'createaccount'],
  password: ['รหัสผ่านเริ่มต้น', 'รหัสผ่าน', 'password', 'initialpassword'],
};
const key = (s: string) => s.toLowerCase().replace(/[\s._\-()/:]/g, '');
function fieldOf(header: string): Field | null {
  const k = key(header);
  return (Object.keys(ALIASES) as Field[]).find((f) => ALIASES[f].some((a) => key(a) === k)) ?? null;
}

type Step = 'idle' | 'checking' | 'checked' | 'importing' | 'done';

/** The import box in Settings: one place, two kinds of file — employees (+ accounts) or vehicles. */
export function ImportBox() {
  const [kind, setKind] = useState<'emp' | 'veh'>('emp');
  return (
    <section className="panel cfg-box imp-box">
      <CfgHead icon={<TableIcon />} title="นำเข้าข้อมูลจากไฟล์"
        sub="เพิ่ม / อัปเดตข้อมูลทีละหลายรายการจากไฟล์ Excel (.xlsx) หรือ CSV · ตรวจทุกแถวก่อนบันทึก" />
      <div className="imp-kind" role="tablist" aria-label="ข้อมูลที่จะนำเข้า">
        <button type="button" role="tab" aria-selected={kind === 'emp'} onClick={() => setKind('emp')}>พนักงาน + บัญชีเข้าสู่ระบบ</button>
        <button type="button" role="tab" aria-selected={kind === 'veh'} onClick={() => setKind('veh')}>ทะเบียนรถ</button>
      </div>
      {kind === 'emp' ? <ImportEmployees /> : <ImportVehicles />}
    </section>
  );
}

export function ImportEmployees() {
  const { roles, reload } = useMaster();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('idle');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRowIn[]>([]);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportRowOut[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  function template() {
    downloadText('employee-import-template.csv', toCsvBom([
      [HEAD.code, HEAD.name, HEAD.role],
      ['650123', 'สมชาย ใจดี', roles[0] ?? ''],
      ['650124', 'สมหญิง รักงาน', roles[1] ?? roles[0] ?? ''],
    ]), 'text/csv;charset=utf-8');
  }

  async function pick(file: File) {
    setError(''); setCheck(null); setDone([]); setFileName(file.name); setStep('checking');
    try {
      const sheet = await readSheet(file);
      // header row = first row (within the first 10) that has an employee-code column
      const h = sheet.slice(0, 10).findIndex((r) => r.some((c) => fieldOf(c) === 'code'));
      if (h < 0) throw new Error(`ไม่พบหัวคอลัมน์ "${HEAD.code}" ในไฟล์ — ใช้ไฟล์ตัวอย่างเป็นแบบ`);
      const cols = sheet[h].map(fieldOf);
      const list: ImportRowIn[] = [];
      sheet.slice(h + 1).forEach((r, i) => {
        if (!r.some((c) => String(c ?? '').trim())) return; // empty row
        const get = (f: Field) => { const j = cols.indexOf(f); return j >= 0 ? String(r[j] ?? '').trim() : ''; };
        list.push({ line: h + i + 2, code: get('code'), name: get('name'), role: get('role'), access: get('access'), account: get('account'), password: get('password') });
      });
      if (!list.length) throw new Error('ไฟล์ไม่มีแถวข้อมูลใต้หัวคอลัมน์');
      setRows(list);
      setCheck(await importEmployees(list, false));
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
    setStep('importing'); setProgress(0); setError('');
    const size = check.chunk ?? 10;
    const out: ImportRowOut[] = [];
    try {
      for (let i = 0; i < good.length; i += size) {
        const res = await importEmployees(good.slice(i, i + size), true);
        out.push(...res.rows);
        setProgress(Math.min(good.length, i + size));
      }
      setDone(out); setStep('done');
      await reload();
      toast(`นำเข้าแล้ว ${out.filter((r) => !r.errors.length).length} แถว`);
    } catch (e) {
      // chunks already sent stay imported; show what went in and what failed
      setDone(out); setStep('done');
      setError(`นำเข้าไม่ครบ: ${errMsg(e)} — นำเข้าแล้ว ${out.length} แถว เลือกไฟล์เดิมอีกครั้งเพื่อทำต่อ (แถวที่เข้าแล้วจะขึ้นว่า "มีอยู่แล้ว")`);
      await reload();
    }
  }

  const withPw = done.filter((r) => r.temp_password);
  function downloadPasswords() {
    downloadText(`new-accounts-${today()}.csv`, toCsvBom([
      ['รหัสพนักงาน (ใช้เข้าสู่ระบบ)', 'ชื่อ-นามสกุล', 'รหัสผ่านชั่วคราว'],
      ...withPw.map((r) => [r.code, r.name, r.temp_password ?? '']),
    ]), 'text/csv;charset=utf-8');
  }
  function reset() { setStep('idle'); setCheck(null); setDone([]); setRows([]); setFileName(''); setError(''); }

  return (
    <>
      {isTestMode ? <div className="empty">โหมดทดสอบ: ใช้ได้เมื่อเชื่อมระบบจริง (ต้องสร้างบัญชีผู้ใช้)</div> : (<>
        <ol className="imp-steps">
          <li>
            <b>ดาวน์โหลดไฟล์ตัวอย่าง</b> แล้วกรอกใน Excel (หรือใช้ไฟล์ที่ export จาก SAP ที่มีหัวคอลัมน์ตรงกัน)
            <div className="row mt-s"><button type="button" className="btn ghost sm" onClick={template}><span className="ii" aria-hidden><DownloadIcon /></span>ไฟล์ตัวอย่าง (.csv)</button></div>
            <details className="imp-help">
              <summary>คอลัมน์ในไฟล์</summary>
              <table className="imp-cols">
                <tbody>
                  <tr><th>{HEAD.code} *</th><td>ใช้เข้าสู่ระบบ · ตัวอักษรภาษาอังกฤษ ตัวเลข หรือ - · ถ้ามีในระบบแล้วจะอัปเดตคนเดิม</td></tr>
                  <tr><th>{HEAD.name} *</th><td>บังคับสำหรับพนักงานใหม่ · เว้นว่าง = ใช้ชื่อเดิม</td></tr>
                  <tr><th>{HEAD.role}</th><td>ใช้ได้: {roles.join(', ') || '—'}</td></tr>
                </tbody>
              </table>
              <p className="note">ทุกคนในไฟล์ได้บัญชีเข้าสู่ระบบด้วยรหัสพนักงาน สิทธิ์ "ผู้ใช้" และรหัสผ่านเริ่มต้น 123456 (ต้องตั้งใหม่ตอนเข้าครั้งแรก)
                · คนที่มีบัญชีอยู่แล้วจะไม่ถูกแก้ · เปลี่ยนเป็นผู้ดูแลระบบได้ที่การ์ดผู้ใช้</p>
            </details>
          </li>
          <li>
            <b>เลือกไฟล์</b> ระบบจะตรวจทุกแถวก่อน ยังไม่บันทึกอะไร
            <div className="row mt-s">
              <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="imp-file" aria-label="เลือกไฟล์ Excel หรือ CSV" disabled={step === 'checking' || step === 'importing'}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
            </div>
          </li>
        </ol>

        {step === 'checking' && <div className="note">กำลังอ่านและตรวจไฟล์ {fileName}…</div>}
        {error && <div className="form-error" role="alert">{error}</div>}

        {check && step !== 'done' && (
          <div className="imp-result">
            <div className="imp-sum">
              <span><b>{check.summary.rows}</b> แถว</span>
              <span className="new"><b>{check.summary.new_employees}</b> พนักงานใหม่</span>
              <span className="upd"><b>{check.summary.updated_employees}</b> อัปเดต</span>
              <span className="acc"><b>{check.summary.new_accounts}</b> บัญชีใหม่</span>
              {check.summary.errors > 0 && <span className="err"><b>{check.summary.errors}</b> แถวมีปัญหา (จะข้าม)</span>}
            </div>
            <ResultTable rows={check.rows} />
            <div className="row spread">
              <button type="button" className="btn ghost sm" onClick={reset}>ยกเลิก</button>
              {/* tap twice (no pop-up): the second tap text says what will happen */}
              <ConfirmButton className="btn" disabled={step === 'importing' || check.summary.rows === check.summary.errors} onConfirm={() => void run()}
                confirmText={`แตะอีกครั้ง: พนักงานใหม่ ${check.summary.new_employees} · อัปเดต ${check.summary.updated_employees} · บัญชีใหม่ ${check.summary.new_accounts}${check.summary.errors ? ` · ข้าม ${check.summary.errors} แถว` : ''}`}>
                {step === 'importing' ? `กำลังนำเข้า… ${progress}/${check.summary.rows - check.summary.errors}` : `นำเข้า ${check.summary.rows - check.summary.errors} แถว`}
              </ConfirmButton>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="imp-result">
            <div className="imp-done">✓ นำเข้าแล้ว {done.filter((r) => !r.errors.length).length} แถวจาก {fileName}</div>
            {withPw.length > 0 && (
              <div className="imp-pw">
                <b>รหัสผ่านชั่วคราวของบัญชีใหม่ {withPw.length} บัญชี</b>
                <p className="note">แสดงครั้งเดียว — ดาวน์โหลดหรือจดไว้แจกพนักงาน แล้วลบไฟล์ทิ้งหลังแจกเสร็จ · ทุกคนต้องตั้งรหัสผ่านใหม่ตอนเข้าครั้งแรก</p>
                <table className="vs-tbl imp-tbl">
                  <thead><tr><th>รหัสพนักงาน</th><th>ชื่อ</th><th>รหัสผ่านชั่วคราว</th></tr></thead>
                  <tbody>{withPw.map((r) => <tr key={r.code}><td className="mono">{r.code}</td><td>{r.name}</td><td className="mono"><b>{r.temp_password}</b></td></tr>)}</tbody>
                </table>
                <div className="row"><button type="button" className="btn sm" onClick={downloadPasswords}><span className="ii" aria-hidden><DownloadIcon /></span>ดาวน์โหลดรายชื่อ + รหัสผ่าน (.csv)</button></div>
              </div>
            )}
            <ResultTable rows={done} />
            <div className="row"><button type="button" className="btn ghost sm" onClick={reset}>นำเข้าไฟล์อื่น</button></div>
          </div>
        )}
      </>)}
    </>
  );
}

const EMP_TXT: Record<ImportRowOut['employee'], [string, string]> = {
  new: ['พนักงานใหม่', 'p'], update: ['อัปเดต', 'w'], same: ['มีอยู่แล้ว', 'x'], error: ['มีปัญหา', 'f'],
};
const ACC_TXT: Record<ImportRowOut['account'], [string, string]> = {
  new: ['สร้างบัญชี', 'p'], exists: ['มีบัญชีแล้ว', 'x'], skip: ['ไม่สร้าง', 'x'], error: ['—', 'f'],
};

function ResultTable({ rows }: { rows: ImportRowOut[] }) {
  return (
    <div className="imp-scroll">
      <table className="vs-tbl imp-tbl">
        <thead><tr><th className="num">แถว</th><th>รหัสพนักงาน</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>พนักงาน</th><th>บัญชี</th><th>รายละเอียด</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.line} className={r.errors.length ? 'imp-bad' : ''}>
              <td className="num">{r.line}</td>
              <td className="mono">{r.code || '—'}</td>
              <td>{r.name || '—'}</td>
              <td className="note">{r.role || '—'}</td>
              <td><span className={`pill ${EMP_TXT[r.employee][1]}`}>{EMP_TXT[r.employee][0]}</span></td>
              <td><span className={`pill ${ACC_TXT[r.account][1]}`}>{ACC_TXT[r.account][0]}</span></td>
              <td className="imp-detail">{r.errors.length ? r.errors.join(' · ') : r.changes.join(' · ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
