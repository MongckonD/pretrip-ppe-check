/**
 * Admin home → "ร้านค้าที่ต้องส่ง": the stores each vehicle must deliver to on the chosen day (database:
 * stores · delivery_plan · delivery_bills, see worker/delivery-routes.ts). Staff see their vehicle's list under
 * Time activities → ร้านค้าที่ต้องส่ง.
 *   - import the list exported from SAP (Excel .xlsx or CSV): each row has its own delivery date (วันที่ส่ง; blank =
 *     the date shown on this block), so one file may hold several days. The server checks the file first (preview),
 *     then replaces every date in the file or appends to it; stores new to the system are created (by SAP code)
 *   - its own date picker (today, tomorrow, …) to plan ahead; past days are view only (locked)
 *   - or add one store by hand (SAP code required, so the same store is always recognised)
 *   - one row per vehicle; "ดูรายละเอียด" lists its stores in file order, with their bills; remove a store, clear the day
 * Rules (enforced by the server and the database): a store is on ONE vehicle per day; several bills of the same
 * store on the same vehicle stay one stop with several bills; a bill number is one delivery only (never on two
 * stores or days); past days cannot be changed.
 * Only shown when the storeDelivery feature switch is on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmButton } from '../components/ConfirmButton';
import { DownloadIcon, PinIcon } from '../components/Icons';
import { useMaster } from '../components/MasterContext';
import { useToast } from '../components/Toast';
import { addDeliveryStop, clearDeliveryPlan, importDeliveryPlan, listDeliveryPlan, removeDeliveryStop } from '../lib/api';
import { readSheet, toCsvBom } from '../lib/sheet';
import { STORE_TYPES, hhmm, minutes1, storeTypeName, type StoreType } from '../lib/storeVisit';
import type { DeliveryImportResult, DeliveryRowIn, DeliveryStop } from '../lib/types';
import { downloadText, errMsg, today } from '../lib/utils';

/* ---- file columns (Thai / English / common SAP names) ---- */
type Field = 'date' | 'plate' | 'code' | 'name' | 'type' | 'address' | 'cases' | 'bill';
const HEAD: Record<Field, string> = {
  date: 'วันที่ส่ง', plate: 'ทะเบียนรถ', code: 'รหัสร้าน (Ship-to)', name: 'ชื่อร้าน', type: 'ประเภทร้าน', address: 'ที่อยู่', cases: 'จำนวนลัง', bill: 'เลขที่บิล',
};
const ALIASES: Record<Field, string[]> = {
  date: ['วันที่ส่ง', 'วันส่ง', 'วันที่จัดส่ง', 'วันที่', 'deliverydate', 'date', 'plandate', 'shipdate', 'gidate', 'goodsissuedate', 'loadingdate'],
  plate: ['ทะเบียนรถ', 'ทะเบียน', 'plate', 'vehicle', 'vehicleno', 'truck', 'licenseplate'],
  // first = preferred: the delivery point (Ship-to) wins over the buyer (Sold-to / Customer) when a file has both
  code: ['รหัสร้านshipto', 'รหัสร้าน', 'shipto', 'shiptoparty', 'รหัสลูกค้า', 'customer', 'customerno', 'customercode', 'kunnr', 'soldto', 'soldtoparty'],
  name: ['ชื่อร้าน', 'shiptoname', 'shiptopartyname', 'ชื่อลูกค้า', 'ร้าน', 'storename', 'customername', 'name', 'soldtoname'],
  type: ['ประเภทร้าน', 'ประเภท', 'type', 'customertype', 'channel'],
  address: ['ที่อยู่', 'address', 'street', 'city'],
  cases: ['จำนวนลัง', 'ลัง', 'cases', 'qty', 'quantity', 'cs'],
  bill: ['เลขที่บิล', 'บิล', 'invoice', 'billing', 'billingdoc', 'delivery', 'deliveryno', 'vbeln'],
};
const key = (s: string) => s.toLowerCase().replace(/[\s._\-()/:]/g, '');
const fieldOf = (h: string) => (Object.keys(ALIASES) as Field[]).find((f) => ALIASES[f].some((a) => key(a) === key(h))) ?? null;
/** header row → column of each field; when several columns fit one field, the one with the more preferred name wins */
function columnsOf(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  const rank: Partial<Record<Field, number>> = {};
  header.forEach((h, j) => {
    for (const f of Object.keys(ALIASES) as Field[]) {
      const r = ALIASES[f].findIndex((a) => key(a) === key(String(h ?? '')));
      if (r >= 0 && (rank[f] === undefined || r < rank[f]!)) { rank[f] = r; out[f] = j; }
    }
  });
  return out;
}
/** store type from the file (Thai / English name or code) → our code; unknown → '' */
const typeOf = (v: string): StoreType | '' => {
  const k = key(v);
  return STORE_TYPES.find((t) => key(t.name) === k || key(t.en) === k || key(t.code) === k)?.code ?? '';
};
/**
 * Delivery date from the file → YYYY-MM-DD. Accepts 2026-11-24 · 24.11.2026 (SAP) · 24/11/2026 · 24/11/69 · 20261124 ·
 * Thai (Buddhist) years (2569) · Excel date numbers. Anything else is sent as typed so the server reports the row.
 */
export function parseDeliveryDate(v: string): string {
  const t = v.trim();
  if (!t) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (y: number, m: number, d: number) => {
    let yy = y < 100 ? (y > 50 ? 2500 + y : 2000 + y) : y; // 2-digit years: 69 → 2569, 26 → 2026
    if (yy > 2400) yy -= 543; // Thai (Buddhist) year
    const out = `${yy}-${pad(m)}-${pad(d)}`;
    const ok = !Number.isNaN(Date.parse(`${out}T00:00:00Z`)) && new Date(`${out}T00:00:00Z`).toISOString().slice(0, 10) === out;
    return ok ? out : t;
  };
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  if (/^\d{5}(\.\d+)?$/.test(t)) { // Excel serial day number
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000).toISOString().slice(0, 10);
  }
  return t;
}
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const thaiDate = (d: string) => new Date(`${d}T00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const typeName = (t: string) => (t ? storeTypeName(t as StoreType) : '');
const casesText = (n: number | null) => (n === null ? '–' : n.toLocaleString('th-TH'));
const sumCases = (list: { cases: number | null }[]) =>
  (list.some((x) => x.cases !== null) ? list.reduce((n, x) => n + (x.cases ?? 0), 0) : null);

interface Preview { file: string; rows: DeliveryRowIn[]; replace: DeliveryImportResult; append: DeliveryImportResult | null; typeNotes: string[] }

export function DeliveryPlan({ date: pageDate }: { date: string }) {
  const { vehicles } = useMaster();
  // own delivery date: starts on the home page's date, can go ahead (tomorrow …) to plan; past days are view only
  const [date, setDate] = useState(pageDate);
  useEffect(() => { setDate(pageDate); }, [pageDate]);
  const locked = date < today();
  const tomorrow = addDays(today(), 1);
  const toast = useToast();
  const [stops, setStops] = useState<DeliveryStop[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState('');
  const [form, setForm] = useState({ plate: '', name: '', code: '', type: '' as StoreType | '', cases: '', bill: '' });
  const [open, setOpen] = useState(true);
  const [openPlates, setOpenPlates] = useState<Set<string>>(new Set()); // vehicles whose store list is shown

  const load = useCallback(async () => {
    setError('');
    try { setStops(await listDeliveryPlan(date)); } catch (e) { setStops([]); setError(errMsg(e)); }
  }, [date]);
  useEffect(() => { setStops(null); setPreview(null); load(); }, [load]);
  // the browser-only trial kept its list here; the database replaces it
  useEffect(() => { try { localStorage.removeItem('delivery-plan-trial-v1'); } catch { /* ignore */ } }, []);

  const list = useMemo(() => stops ?? [], [stops]);
  const byPlate = useMemo(() => {
    const m = new Map<string, DeliveryStop[]>();
    for (const s of list) m.set(s.plate, [...(m.get(s.plate) ?? []), s]);
    return [...m.entries()];
  }, [list]);
  const totalCases = sumCases(list);
  const totalBills = list.reduce((n, s) => n + s.bills.length, 0);

  function template() {
    downloadText('delivery-plan-template.csv', toCsvBom([
      [HEAD.date, HEAD.plate, HEAD.code, HEAD.name, HEAD.type, HEAD.address, HEAD.cases, HEAD.bill],
      [tomorrow, vehicles[0]?.plate ?? '1กก 1234', 'C10021', 'ร้านเจ๊หมวย ขายส่ง', 'ร้านขายส่ง', '45/2 ถ.เพชรเกษม', 80, '9000123456'],
      [tomorrow, vehicles[0]?.plate ?? '1กก 1234', 'C10021', 'ร้านเจ๊หมวย ขายส่ง', 'ร้านขายส่ง', '45/2 ถ.เพชรเกษม', 40, '9000123457'],
      [tomorrow, vehicles[0]?.plate ?? '1กก 1234', 'C10045', 'ครัวคุณต๋อย', 'ร้านอาหาร', '88 ถ.กาญจนาภิเษก', 15, '9000123458'],
    ]), 'text/csv;charset=utf-8');
  }

  /** read the file, then let the server check it (nothing is saved yet) */
  async function pick(file: File) {
    setBusy(true);
    try {
      const sheet = await readSheet(file);
      const h = sheet.slice(0, 10).findIndex((r) => r.some((c) => fieldOf(c) === 'name'));
      if (h < 0) throw new Error(`ไม่พบหัวคอลัมน์ "${HEAD.name}" ในไฟล์ — ใช้ไฟล์ตัวอย่างเป็นแบบ`);
      const col = columnsOf(sheet[h]);
      const missing = (['plate', 'code', 'name'] as Field[]).filter((f) => col[f] === undefined).map((f) => `"${HEAD[f]}"`);
      if (missing.length) throw new Error(`ไม่พบหัวคอลัมน์ ${missing.join(', ')} ในไฟล์ — ใช้ไฟล์ตัวอย่างเป็นแบบ`);
      const typeNotes: string[] = [];
      const rows: DeliveryRowIn[] = [];
      sheet.slice(h + 1).forEach((r, i) => {
        if (!r.some((c) => String(c ?? '').trim())) return;
        const get = (f: Field) => { const j = col[f]; return j !== undefined ? String(r[j] ?? '').trim() : ''; };
        const line = h + i + 2;
        const t = get('type');
        if (t && !typeOf(t)) typeNotes.push(`แถว ${line}: ประเภทร้าน "${t}" ไม่รู้จัก — เว้นว่างไว้`);
        rows.push({ line, date: parseDeliveryDate(get('date')), plate: get('plate'), code: get('code'), name: get('name'), type: t ? typeOf(t) : '',
          address: get('address'), cases: get('cases'), bill: get('bill') });
      });
      if (!rows.length) throw new Error('ไฟล์ไม่มีแถวข้อมูล');
      // append is offered when the day(s) in the file may already have a plan
      const otherDays = rows.some((r) => r.date && r.date !== date);
      const [replace, append] = await Promise.all([
        importDeliveryPlan(date, 'replace', rows, false),
        list.length || otherDays ? importDeliveryPlan(date, 'append', rows, false) : Promise.resolve(null),
      ]);
      setPreview({ file: file.name, rows, replace, append, typeNotes });
    } catch (e) {
      toast('อ่านไฟล์ไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function applyImport(mode: 'replace' | 'append') {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await importDeliveryPlan(date, mode, preview.rows, true);
      const ds = r.summary.dates.map((x) => x.date);
      toast(`นำเข้าแล้ว ${r.summary.stores} ร้าน · ${r.summary.bills} บิล${ds.length > 1 ? ` · ${ds.length} วัน` : ''}${r.summary.new_stores ? ` · ร้านใหม่ ${r.summary.new_stores} ร้าน` : ''}`);
      setPreview(null);
      setOpen(true);
      // this day is not in the file: show the first day that was imported
      if (ds.length && !ds.includes(date)) setDate(ds[0]); else await load();
    } catch (e) {
      toast('นำเข้าไม่สำเร็จ: ' + errMsg(e));
    } finally { setBusy(false); }
  }

  async function addOne() {
    if (!form.plate || !form.code.trim() || !form.name.trim()) return setAddErr('เลือกทะเบียนรถ และกรอกรหัสร้านกับชื่อร้านก่อน');
    setBusy(true);
    try {
      await addDeliveryStop({ date, plate: form.plate, code: form.code, name: form.name, type: form.type, cases: form.cases, bill: form.bill });
      setAddErr('');
      toast(`เพิ่ม ${form.name.trim()} ให้รถ ${form.plate} แล้ว`);
      setForm({ plate: form.plate, name: '', code: '', type: '', cases: '', bill: '' }); // keep the vehicle for the next store
      setOpenPlates((cur) => new Set(cur).add(form.plate));
      await load();
    } catch (e) {
      setAddErr(errMsg(e));
    } finally { setBusy(false); }
  }

  async function remove(s: DeliveryStop) {
    try { await removeDeliveryStop(s.id); await load(); } catch (e) { toast('ลบไม่สำเร็จ: ' + errMsg(e)); }
  }
  async function clearDay() {
    try { await clearDeliveryPlan(date); await load(); toast('ล้างรายการของวันนี้แล้ว'); } catch (e) { toast('ล้างไม่สำเร็จ: ' + errMsg(e)); }
  }

  const pv = preview;
  // "แทนที่ไม่ได้" (stores that already have a delivery status) blocks replacing only — not the file, not "เพิ่มต่อ"
  const isLock = (e: string) => e.startsWith('แทนที่ไม่ได้');
  const lockErrors = pv?.replace.errors.filter(isLock) ?? [];
  const fileErrors = pv?.replace.errors.filter((e) => !isLock(e)) ?? [];
  // stores of this day that already have a delivery status cannot leave the plan
  const withStatus = list.filter((s) => s.visit).length;
  const appendErrors = pv?.append?.errors.filter((e) => !fileErrors.includes(e)) ?? [];
  const notes = [...(pv?.typeNotes ?? []), ...(pv?.replace.notes ?? [])];

  return (
    <section className="panel plan">
      <div className="plan-head">
        <div>
          <h2 className="flush">ร้านค้าที่ต้องส่ง</h2>
          <div className="row plan-date">
            <input type="date" aria-label="วันที่ส่ง" value={date} max={addDays(today(), 60)}
              onChange={(e) => setDate(e.target.value || today())} />
            <button type="button" className={`btn ghost sm ${date === today() ? 'on' : ''}`} onClick={() => setDate(today())}>วันนี้</button>
            <button type="button" className={`btn ghost sm ${date === tomorrow ? 'on' : ''}`} onClick={() => setDate(tomorrow)}>พรุ่งนี้</button>
          </div>
          <span className="note">
            {thaiDate(date)}{locked ? ' · ผ่านมาแล้ว ดูได้อย่างเดียว' : ''} · {stops === null ? 'กำลังโหลด…' : list.length
              ? <>{list.length} ร้าน · {byPlate.length} คัน · {totalBills} บิล{totalCases !== null ? ` · ${casesText(totalCases)} ลัง` : ''}</>
              : 'ยังไม่มีรายการ'}
          </span>
        </div>
        <div className="row plan-actions">
          <input ref={fileRef} type="file" hidden accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
          {/* a file may hold other (future) days, so importing is allowed while viewing a past day */}
          <button type="button" className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}>{busy && !pv ? 'กำลังอ่านไฟล์…' : 'นำเข้าไฟล์จาก SAP'}</button>
          {!locked && <button type="button" className="btn ghost sm" onClick={() => setAdding((a) => !a)}>＋ เพิ่มร้านค้า</button>}
          <button type="button" className="btn ghost sm" onClick={template}><span className="ii" aria-hidden><DownloadIcon /></span>ไฟล์ตัวอย่าง</button>
          {list.length > 0 && <button type="button" className="btn ghost sm" onClick={() => setOpen((o) => !o)}>{open ? 'ซ่อนรายการ' : 'แสดงรายการ'}</button>}
        </div>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}

      {/* import preview: the server's check of the file (nothing saved yet) */}
      {pv && (
        <div className="plan-preview">
          <b>ไฟล์ {pv.file}: {pv.replace.summary.stores} ร้าน · {pv.replace.summary.vehicles} คัน · {pv.replace.summary.bills} บิล
            {pv.replace.summary.cases ? ` · ${casesText(pv.replace.summary.cases)} ลัง` : ''}
            {pv.replace.summary.new_stores ? ` · ร้านใหม่ ${pv.replace.summary.new_stores} ร้าน` : ''}</b>
          {/* one line per delivery date in the file */}
          {pv.replace.summary.dates.length > 0 && (
            <ul className="plan-days">
              {pv.replace.summary.dates.map((x) => (
                <li key={x.date}><b>{thaiDate(x.date)}</b> · {x.stores} ร้าน · {x.vehicles} คัน · {x.bills} บิล{x.cases ? ` · ${casesText(x.cases)} ลัง` : ''}</li>
              ))}
            </ul>
          )}
          {notes.length > 0 && (
            <ul className="plan-problems">{notes.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
              {notes.length > 8 && <li>…และอีก {notes.length - 8} รายการ</li>}</ul>
          )}
          {fileErrors.length > 0 && (
            <div className="form-error" role="alert">
              <b>นำเข้าไม่ได้ — ไฟล์มีปัญหา {fileErrors.length} รายการ แก้ไฟล์แล้วนำเข้าใหม่</b>
              <ul className="plan-problems">{fileErrors.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
                {fileErrors.length > 8 && <li>…และอีก {fileErrors.length - 8} รายการ</li>}</ul>
            </div>
          )}
          {!fileErrors.length && lockErrors.length > 0 && (
            <div className="form-error" role="alert">
              {lockErrors.map((p) => <div key={p}>{p}</div>)}
            </div>
          )}
          {!fileErrors.length && appendErrors.length > 0 && (
            <div className="form-error" role="alert">
              <b>เพิ่มต่อจากรายการเดิมไม่ได้ — ชนกับรายการที่บันทึกไว้แล้ว</b>
              <ul className="plan-problems">{appendErrors.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
                {appendErrors.length > 8 && <li>…และอีก {appendErrors.length - 8} รายการ</li>}</ul>
            </div>
          )}
          {!fileErrors.length && !appendErrors.length && pv.append && pv.append.summary.already > 0 && (
            <span className="note">ถ้าเพิ่มต่อ: {pv.append.summary.already} ร้านอยู่ในรถคันเดิมแล้ว — เพิ่มเฉพาะบิลใหม่ของร้านนั้น</span>
          )}
          <div className="row">
            {/* replacing days that may already have a plan: tap twice (no pop-up) */}
            {pv.append ? (
              <ConfirmButton className="btn sm" disabled={busy || fileErrors.length > 0 || lockErrors.length > 0} onConfirm={() => applyImport('replace')}
                confirmText={`แตะอีกครั้ง: แทนที่รายการเดิมของ ${pv.replace.summary.dates.map((x) => thaiDate(x.date)).join(', ')}`}>
                ใช้แทนรายการเดิมของวันที่ในไฟล์
              </ConfirmButton>
            ) : (
              <button type="button" className="btn sm" disabled={busy || fileErrors.length > 0 || lockErrors.length > 0} onClick={() => applyImport('replace')}>นำเข้ารายการนี้</button>
            )}
            {pv.append && (
              <button type="button" className="btn ghost sm" disabled={busy || fileErrors.length > 0 || appendErrors.length > 0}
                onClick={() => applyImport('append')}>เพิ่มต่อจากรายการเดิม</button>
            )}
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setPreview(null)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {/* add one store */}
      {adding && !locked && (
        <div className="plan-add">
          <select aria-label="ทะเบียนรถ" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })}>
            <option value="">— ทะเบียนรถ * —</option>
            {vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.plate}>{v.plate}</option>)}
          </select>
          <input aria-label="รหัสร้าน" placeholder="รหัสร้าน (SAP) *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input aria-label="ชื่อร้าน" placeholder="ชื่อร้าน *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select aria-label="ประเภทร้าน" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as StoreType | '' })}>
            <option value="">ประเภทร้าน</option>
            {STORE_TYPES.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
          <input aria-label="เลขที่บิล" placeholder="เลขที่บิล" value={form.bill} onChange={(e) => setForm({ ...form, bill: e.target.value })} />
          <input aria-label="จำนวนลัง" placeholder="ลัง" inputMode="numeric" value={form.cases}
            onChange={(e) => setForm({ ...form, cases: e.target.value.replace(/\D/g, '') })} />
          <div className="row">
            <button type="button" className="btn sm" onClick={addOne} disabled={busy || !form.plate || !form.code.trim() || !form.name.trim()}>เพิ่ม</button>
            <button type="button" className="btn ghost sm" onClick={() => { setAdding(false); setAddErr(''); }}>ปิด</button>
          </div>
          {addErr && <div className="form-error plan-add-err" role="alert">{addErr}</div>}
        </div>
      )}

      {/* the plan: one row per vehicle */}
      {open && byPlate.length > 0 && (
        <div className="plan-trucks">
          {byPlate.map(([plate, rows]) => {
            const shown = openPlates.has(plate);
            const cases = sumCases(rows);
            return (
              <div className={`plan-truck ${shown ? 'open' : ''}`} key={plate}>
                <div className="plan-truck-head">
                  <b className="plan-plate">{plate}</b>
                  <span className="plan-count"><b className="mono">{rows.length}</b> ร้าน</span>
                  <span className="plan-count"><b className="mono">{casesText(cases)}</b> ลัง</span>
                  <span className="plan-route note">{rows.map((s) => s.name).join(' · ')}</span>
                  <button type="button" className="btn ghost sm plan-more" aria-expanded={shown}
                    onClick={() => setOpenPlates((cur) => { const n = new Set(cur); if (n.has(plate)) n.delete(plate); else n.add(plate); return n; })}>
                    {shown ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'} <span className="plan-chev" aria-hidden>›</span>
                  </button>
                </div>
                {shown && <ul>
                  {rows.map((s) => (
                    <li key={s.id}>
                      <span className="plan-store">
                        <span className="plan-store-top">
                          <b className="plan-store-name">{s.name}</b>
                          <span className="plan-tag mono">{s.code}</span>
                          {s.type && <span className="plan-tag">{typeName(s.type)}</span>}
                        </span>
                        {s.address && <span className="plan-addr"><span className="ii" aria-hidden><PinIcon /></span>{s.address}</span>}
                        {/* delivery status from the store timer (times stamped by the server) */}
                        {s.visit && <VisitTag v={s.visit} />}
                        {s.bills.length > 0 && (
                          <span className="plan-bills">
                            <span className="plan-bills-label">{s.bills.length} บิล</span>
                            {s.bills.map((b, i) => (
                              <span key={`${b.bill_no}-${i}`} className="plan-bill">
                                <span className="mono">{b.bill_no || 'ไม่มีเลขบิล'}</span>
                                {b.cases !== null && <b className="mono">{casesText(b.cases)} ลัง</b>}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="mono plan-cases">{casesText(s.cases)}<small> ลัง</small></span>
                      {!locked && !s.visit && (
                        <ConfirmButton className="btn ghost sm plan-del" onConfirm={() => remove(s)} ariaLabel={`ลบ ${s.name}`} confirmText="ลบ?">✕</ConfirmButton>
                      )}
                    </li>
                  ))}
                </ul>}
              </div>
            );
          })}
        </div>
      )}
      {list.length > 0 && open && !locked && (
        <div className="row plan-foot">
          <span className="note">{withStatus ? `มี ${withStatus} ร้านที่บันทึกสถานะการส่งแล้ว — ลบร้านเหล่านี้ไม่ได้` : ''}</span>
          <ConfirmButton className="btn danger sm" disabled={withStatus > 0} onConfirm={clearDay}
            confirmText={`แตะอีกครั้งเพื่อล้างทั้ง ${list.length} ร้านของ ${thaiDate(date)}`}>ล้างรายการของวันนี้ทั้งหมด</ConfirmButton>
        </div>
      )}
    </section>
  );
}

/** the store's delivery status today: ส่งสำเร็จ (times, minutes, cases) / กำลังส่ง / ส่งไม่สำเร็จ (note) */
function VisitTag({ v }: { v: NonNullable<DeliveryStop['visit']> }) {
  if (v.status === 'done' && v.started_at && v.ended_at) {
    const sec = Math.max(0, (Date.parse(v.ended_at) - Date.parse(v.started_at)) / 1000);
    return (
      <span className="plan-visit done">
        ✓ ส่งสำเร็จ {hhmm(v.started_at)}–{hhmm(v.ended_at)} น. · {minutes1(sec)} นาที · {casesText(v.cases)} ลัง{v.by ? ` · ${v.by}` : ''}
      </span>
    );
  }
  if (v.status === 'failed') return <span className="plan-visit failed">✗ ส่งไม่สำเร็จ · {v.note}{v.by ? ` · ${v.by}` : ''}</span>;
  return <span className="plan-visit running">● กำลังส่ง{v.started_at ? ` · จอด ${hhmm(v.started_at)} น.` : ''}{v.ended_at ? ' · รอบันทึก' : ''}</span>;
}
