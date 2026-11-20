/**
 * Admin home → "ร้านค้าที่ต้องส่ง": the stores each vehicle must deliver to on the chosen day.
 *   - import the day's delivery list exported from SAP (Excel .xlsx or CSV), or add stores one by one
 *   - grouped by vehicle, in delivery order; remove a store, or clear the day
 *
 * TRIAL (design only): kept in this browser (localStorage, per day) — NOT in the database yet, so the staff
 * phones do not see it. The tables come after the database design is agreed; then the staff store picker
 * (บันทึกเวลาส่งสินค้า) will show the vehicle's list for the day.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMaster } from '../components/MasterContext';
import { useToast } from '../components/Toast';
import { readSheet, toCsvBom } from '../lib/sheet';
import { STORE_TYPES, storeTypeName, type StoreType } from '../lib/storeVisit';
import { downloadText, errMsg } from '../lib/utils';

export interface PlanStop {
  id: string; plate: string; seq: number;
  store_code: string; store_name: string; store_type: StoreType | '';
  address: string; cases: number | null; bill_no: string;
}

const KEY = 'delivery-plan-trial-v1';
type Saved = Record<string, PlanStop[]>; // date → stops
function loadAll(): Saved {
  let saved: Saved;
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved; } catch { return {}; }
  // lists saved before the one-store-one-vehicle rule may hold repeats: keep the first one added, drop the rest
  for (const d of Object.keys(saved)) saved[d] = dedupe(saved[d] ?? []);
  return saved;
}
/** drops a store already in the list (same or other vehicle), then numbers each vehicle's stops 1, 2, 3… */
function dedupe(list: PlanStop[]): PlanStop[] {
  const kept: PlanStop[] = [];
  for (const s of list) if (!kept.some((k) => sameStore(k, s))) kept.push(s);
  const n = new Map<string, number>();
  return [...kept].sort((a, b) => a.plate.localeCompare(b.plate) || a.seq - b.seq)
    .map((s) => { const k = (n.get(s.plate) ?? 0) + 1; n.set(s.plate, k); return { ...s, seq: k }; });
}
function saveAll(s: Saved) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/* ---- file columns (Thai / English / common SAP names) ---- */
type Field = 'plate' | 'seq' | 'code' | 'name' | 'type' | 'address' | 'cases' | 'bill';
const HEAD: Record<Field, string> = {
  plate: 'ทะเบียนรถ', seq: 'ลำดับ', code: 'รหัสร้าน', name: 'ชื่อร้าน', type: 'ประเภทร้าน',
  address: 'ที่อยู่', cases: 'จำนวนลัง', bill: 'เลขที่บิล',
};
const ALIASES: Record<Field, string[]> = {
  plate: ['ทะเบียนรถ', 'ทะเบียน', 'plate', 'vehicle', 'vehicleno', 'truck', 'licenseplate'],
  seq: ['ลำดับ', 'ลำดับส่ง', 'seq', 'sequence', 'stop', 'stopno', 'item'],
  code: ['รหัสร้าน', 'รหัสลูกค้า', 'customer', 'customerno', 'customercode', 'soldto', 'shipto', 'kunnr'],
  name: ['ชื่อร้าน', 'ชื่อลูกค้า', 'ร้าน', 'customername', 'name', 'shiptoname', 'storename'],
  type: ['ประเภทร้าน', 'ประเภท', 'type', 'customertype', 'channel'],
  address: ['ที่อยู่', 'address', 'street', 'city'],
  cases: ['จำนวนลัง', 'ลัง', 'cases', 'qty', 'quantity', 'cs'],
  bill: ['เลขที่บิล', 'บิล', 'invoice', 'billing', 'billingdoc', 'delivery', 'deliveryno', 'vbeln'],
};
const key = (s: string) => s.toLowerCase().replace(/[\s._\-()/:]/g, '');
const fieldOf = (h: string) => (Object.keys(ALIASES) as Field[]).find((f) => ALIASES[f].some((a) => key(a) === key(h))) ?? null;
const typeOf = (v: string): StoreType | '' => {
  const k = key(v);
  return STORE_TYPES.find((t) => key(t.name) === k || key(t.en) === k || key(t.code) === k)?.code ?? '';
};
const plateKey = (p: string) => p.replace(/[\s.-]/g, '').toUpperCase();

/**
 * One store = one stop per day, on ONE vehicle (two trucks never go to the same store).
 * Same store: same SAP code when both have one; otherwise the same name (spaces / case / dots ignored).
 */
const codeKey = (c: string) => c.replace(/[\s.-]/g, '').toUpperCase();
const nameKey = (n: string) => n.toLowerCase().replace(/[\s.\-,()'"]/g, '');
const sameStore = (a: { store_code: string; store_name: string }, b: { store_code: string; store_name: string }) => {
  const ca = codeKey(a.store_code), cb = codeKey(b.store_code);
  return ca && cb ? ca === cb : nameKey(a.store_name) === nameKey(b.store_name);
};
const storeLabel = (s: { store_code: string; store_name: string }) => (s.store_code ? `${s.store_name} (${s.store_code})` : s.store_name);

export function DeliveryPlan({ date }: { date: string }) {
  const { vehicles } = useMaster();
  const toast = useToast();
  const [all, setAll] = useState<Saved>(loadAll);
  useEffect(() => { saveAll(all); }, [all]);
  const stops = useMemo(() => all[date] ?? [], [all, date]);
  const setStops = (f: (s: PlanStop[]) => PlanStop[]) => setAll((a) => ({ ...a, [date]: f(a[date] ?? []) }));

  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: string; rows: PlanStop[]; problems: string[]; errors: string[] } | null>(null);
  const [addErr, setAddErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ plate: '', name: '', code: '', type: '' as StoreType | '', cases: '' });
  const [open, setOpen] = useState(true);
  const [openPlates, setOpenPlates] = useState<Set<string>>(new Set()); // vehicles whose store list is shown

  const knownPlate = (p: string) => vehicles.find((v) => v.active && plateKey(v.plate) === plateKey(p))?.plate;
  const byPlate = useMemo(() => {
    const m = new Map<string, PlanStop[]>();
    for (const s of [...stops].sort((a, b) => a.plate.localeCompare(b.plate) || a.seq - b.seq)) m.set(s.plate, [...(m.get(s.plate) ?? []), s]);
    return [...m.entries()];
  }, [stops]);
  const totalCases = stops.reduce((n, s) => n + (s.cases ?? 0), 0);

  function template() {
    downloadText('delivery-plan-template.csv', toCsvBom([
      [HEAD.plate, HEAD.seq, HEAD.code, HEAD.name, HEAD.type, HEAD.address, HEAD.cases, HEAD.bill],
      [vehicles[0]?.plate ?? '1กก 1234', 1, 'C10021', 'ร้านเจ๊หมวย ขายส่ง', 'ร้านขายส่ง', '45/2 ถ.เพชรเกษม', 120, '9000123456'],
      [vehicles[0]?.plate ?? '1กก 1234', 2, 'C10045', 'ครัวคุณต๋อย', 'ร้านอาหาร', '88 ถ.กาญจนาภิเษก', 15, '9000123457'],
    ]), 'text/csv;charset=utf-8');
  }

  async function pick(file: File) {
    try {
      const sheet = await readSheet(file);
      const h = sheet.slice(0, 10).findIndex((r) => r.some((c) => fieldOf(c) === 'name'));
      if (h < 0) throw new Error(`ไม่พบหัวคอลัมน์ "${HEAD.name}" ในไฟล์ — ใช้ไฟล์ตัวอย่างเป็นแบบ`);
      const cols = sheet[h].map(fieldOf);
      const rows: PlanStop[] = [];
      const problems: string[] = [];
      const errors: string[] = [];
      const seqOf = new Map<string, number>();
      sheet.slice(h + 1).forEach((r, i) => {
        if (!r.some((c) => String(c ?? '').trim())) return;
        const get = (f: Field) => { const j = cols.indexOf(f); return j >= 0 ? String(r[j] ?? '').trim() : ''; };
        const line = h + i + 2;
        const name = get('name');
        const plateIn = get('plate');
        if (!name) { problems.push(`แถว ${line}: ไม่มีชื่อร้าน — ข้าม`); return; }
        if (!plateIn) { problems.push(`แถว ${line}: ${name} ไม่มีทะเบียนรถ — ข้าม`); return; }
        const p = knownPlate(plateIn) ?? plateIn;
        const seq = Number(get('seq')) || (seqOf.get(p) ?? 0) + 1;
        seqOf.set(p, Math.max(seq, seqOf.get(p) ?? 0));
        const cases = get('cases') ? Number(get('cases').replace(/[^\d.]/g, '')) : null;
        const t = get('type');
        if (t && !typeOf(t)) problems.push(`แถว ${line}: ประเภทร้าน "${t}" ไม่รู้จัก — เว้นว่างไว้`);
        const row: PlanStop = { id: uid(), plate: p, seq, store_code: get('code'), store_name: name, store_type: t ? typeOf(t) : '',
          address: get('address'), cases: cases !== null && Number.isFinite(cases) ? cases : null, bill_no: get('bill') };
        const prev = rows.find((x) => sameStore(x, row));
        if (prev && prev.plate !== p) {
          // the same store on two vehicles: never allowed — the file must be fixed
          errors.push(`แถว ${line}: ${storeLabel(row)} อยู่ทั้งรถ ${prev.plate} และรถ ${p} — ร้านเดียวกันส่งได้คันเดียว`);
          return;
        }
        if (prev) {
          // the same store again on the same vehicle (e.g. one row per bill in SAP): one stop, cases and bills added up
          prev.cases = prev.cases === null && row.cases === null ? null : (prev.cases ?? 0) + (row.cases ?? 0);
          prev.bill_no = [prev.bill_no, row.bill_no].filter(Boolean).join(', ');
          prev.store_code ||= row.store_code; prev.store_type ||= row.store_type; prev.address ||= row.address;
          problems.push(`แถว ${line}: ${storeLabel(row)} ซ้ำในรถ ${p} — รวมเป็นจุดส่งเดียว`);
          return;
        }
        rows.push(row);
      });
      if (!rows.length && !errors.length) throw new Error('ไฟล์ไม่มีร้านค้าที่นำเข้าได้');
      // delivery order per vehicle as 1, 2, 3… (merged repeats leave no gaps)
      const n = new Map<string, number>();
      rows.sort((a, b) => a.plate.localeCompare(b.plate) || a.seq - b.seq)
        .forEach((r) => { const k = (n.get(r.plate) ?? 0) + 1; n.set(r.plate, k); r.seq = k; });
      setPreview({ file: file.name, rows, problems, errors });
    } catch (e) {
      toast('อ่านไฟล์ไม่สำเร็จ: ' + errMsg(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** appending the file to today's list: stores already on another vehicle block it; already on the same vehicle are skipped */
  const vsToday = useMemo(() => {
    if (!preview) return { clash: [] as string[], already: [] as PlanStop[] };
    const clash: string[] = [];
    const already: PlanStop[] = [];
    for (const r of preview.rows) {
      const s = stops.find((x) => sameStore(x, r));
      if (!s) continue;
      if (s.plate === r.plate) already.push(r);
      else clash.push(`${storeLabel(r)}: ในไฟล์อยู่รถ ${r.plate} แต่วันนี้อยู่ในรถ ${s.plate} แล้ว`);
    }
    return { clash, already };
  }, [preview, stops]);

  function applyImport(mode: 'replace' | 'append') {
    if (!preview || preview.errors.length) return;
    if (mode === 'append' && vsToday.clash.length) return;
    const skip = new Set(vsToday.already.map((r) => r.id));
    const rows = mode === 'replace' ? preview.rows : preview.rows.filter((r) => !skip.has(r.id));
    setStops((cur) => {
      if (mode === 'replace') return rows;
      // same vehicle: the new stores go after the ones it already has (seq continues, file order kept)
      const last = new Map<string, number>();
      for (const s of cur) last.set(s.plate, Math.max(s.seq, last.get(s.plate) ?? 0));
      const added = [...rows].sort((a, b) => a.plate.localeCompare(b.plate) || a.seq - b.seq).map((s) => {
        const seq = (last.get(s.plate) ?? 0) + 1;
        last.set(s.plate, seq);
        return { ...s, seq };
      });
      return [...cur, ...added];
    });
    toast(`นำเข้า ${rows.length} ร้านแล้ว${mode === 'append' && skip.size ? ` (ข้าม ${skip.size} ร้านที่มีอยู่แล้ว)` : ''}`);
    setPreview(null);
    setOpen(true);
  }

  function addOne() {
    const plate = knownPlate(form.plate) ?? form.plate.trim();
    if (!plate || !form.name.trim()) return toast('เลือกทะเบียนรถและกรอกชื่อร้านก่อน');
    const dup = stops.find((s) => sameStore(s, { store_code: form.code.trim(), store_name: form.name.trim() }));
    if (dup) {
      return setAddErr(dup.plate === plate
        ? `${storeLabel(dup)} อยู่ในรถ ${plate} ลำดับ ${dup.seq} แล้ว`
        : `${storeLabel(dup)} อยู่ในรถ ${dup.plate} ลำดับ ${dup.seq} แล้ว — ร้านเดียวกันส่งได้คันเดียว (ถ้าจะย้ายคัน ให้ลบออกจากรถ ${dup.plate} ก่อน)`);
    }
    setAddErr('');
    const seq = Math.max(0, ...stops.filter((s) => s.plate === plate).map((s) => s.seq)) + 1;
    setStops((cur) => [...cur, { id: uid(), plate, seq, store_code: form.code.trim(), store_name: form.name.trim(), store_type: form.type,
      address: '', cases: form.cases ? Number(form.cases) : null, bill_no: '' }]);
    setForm({ plate, name: '', code: '', type: '', cases: '' }); // keep the vehicle for the next store
    toast(`เพิ่ม ${form.name.trim()} ให้รถ ${plate} แล้ว`);
  }

  const remove = (id: string) => setStops((cur) => cur.filter((s) => s.id !== id));
  function clearDay() {
    if (!window.confirm(`ล้างรายการร้านค้าที่ต้องส่งของวันนี้ทั้งหมด (${stops.length} ร้าน)?`)) return;
    setStops(() => []);
  }

  return (
    <section className="panel plan">
      <div className="plan-head">
        <div>
          <h2 className="flush">ร้านค้าที่ต้องส่ง <span className="plan-trial">ทดลอง · ยังไม่บันทึกลงระบบ</span></h2>
          <span className="note">
            {stops.length ? <>{stops.length} ร้าน · {byPlate.length} คัน{totalCases ? ` · ${totalCases.toLocaleString('th-TH')} ลัง` : ''}</> : 'ยังไม่มีรายการของวันนี้'}
          </span>
        </div>
        <div className="row plan-actions">
          <input ref={fileRef} type="file" hidden accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>นำเข้าไฟล์จาก SAP</button>
          <button type="button" className="btn ghost sm" onClick={() => setAdding((a) => !a)}>＋ เพิ่มร้านค้า</button>
          <button type="button" className="btn ghost sm" onClick={template}>⬇ ไฟล์ตัวอย่าง</button>
          {stops.length > 0 && <button type="button" className="btn ghost sm" onClick={() => setOpen((o) => !o)}>{open ? 'ซ่อนรายการ' : 'แสดงรายการ'}</button>}
        </div>
      </div>

      {/* import preview */}
      {preview && (
        <div className="plan-preview">
          <b>ไฟล์ {preview.file}: {preview.rows.length} ร้าน · {new Set(preview.rows.map((r) => r.plate)).size} คัน</b>
          {preview.problems.length > 0 && (
            <ul className="plan-problems">{preview.problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
              {preview.problems.length > 8 && <li>…และอีก {preview.problems.length - 8} รายการ</li>}</ul>
          )}
          {preview.errors.length > 0 && (
            <div className="form-error" role="alert">
              <b>นำเข้าไม่ได้ — มีร้านเดียวกันอยู่ในรถหลายคัน ({preview.errors.length} รายการ) แก้ไฟล์แล้วนำเข้าใหม่</b>
              <ul className="plan-problems">{preview.errors.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
                {preview.errors.length > 8 && <li>…และอีก {preview.errors.length - 8} รายการ</li>}</ul>
            </div>
          )}
          {!preview.errors.length && stops.length > 0 && vsToday.clash.length > 0 && (
            <div className="form-error" role="alert">
              <b>เพิ่มต่อจากรายการเดิมไม่ได้ — ร้านในไฟล์อยู่ในรถคันอื่นของวันนี้แล้ว</b>
              <ul className="plan-problems">{vsToday.clash.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
                {vsToday.clash.length > 8 && <li>…และอีก {vsToday.clash.length - 8} รายการ</li>}</ul>
            </div>
          )}
          {!preview.errors.length && stops.length > 0 && !vsToday.clash.length && vsToday.already.length > 0 && (
            <span className="note">ถ้าเพิ่มต่อ: {vsToday.already.length} ร้านมีอยู่ในรถคันเดิมแล้ว จะข้ามไม่เพิ่มซ้ำ</span>
          )}
          <div className="row">
            <button type="button" className="btn sm" disabled={preview.errors.length > 0} onClick={() => applyImport('replace')}>ใช้รายการนี้แทนของวันนี้</button>
            {stops.length > 0 && (
              <button type="button" className="btn ghost sm" disabled={preview.errors.length > 0 || vsToday.clash.length > 0}
                onClick={() => applyImport('append')}>เพิ่มต่อจากรายการเดิม</button>
            )}
            <button type="button" className="btn ghost sm" onClick={() => setPreview(null)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {/* add one store */}
      {adding && (
        <div className="plan-add">
          <select aria-label="ทะเบียนรถ" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })}>
            <option value="">— ทะเบียนรถ * —</option>
            {vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.plate}>{v.plate}</option>)}
          </select>
          <input aria-label="ชื่อร้าน" placeholder="ชื่อร้าน *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input aria-label="รหัสร้าน" placeholder="รหัสร้าน (SAP)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <select aria-label="ประเภทร้าน" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as StoreType | '' })}>
            <option value="">ประเภทร้าน</option>
            {STORE_TYPES.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
          <input aria-label="จำนวนลัง" placeholder="ลัง" inputMode="numeric" value={form.cases}
            onChange={(e) => setForm({ ...form, cases: e.target.value.replace(/\D/g, '') })} />
          <div className="row">
            <button type="button" className="btn sm" onClick={addOne} disabled={!form.plate || !form.name.trim()}>เพิ่ม</button>
            <button type="button" className="btn ghost sm" onClick={() => { setAdding(false); setAddErr(''); }}>ปิด</button>
          </div>
          {addErr && <div className="form-error plan-add-err" role="alert">{addErr}</div>}
        </div>
      )}

      {/* the plan, by vehicle */}
      {open && byPlate.length > 0 && (
        <div className="plan-trucks">
          {byPlate.map(([plate, list]) => {
            const shown = openPlates.has(plate);
            const cases = list.reduce((n, s) => n + (s.cases ?? 0), 0);
            return (
            <div className={`plan-truck ${shown ? 'open' : ''}`} key={plate}>
              <div className="plan-truck-head">
                <b className="plan-plate">{plate}</b>
                <span className="plan-count"><b className="mono">{list.length}</b> ร้าน</span>
                <span className="plan-count"><b className="mono">{list.some((s) => s.cases !== null) ? cases.toLocaleString('th-TH') : '–'}</b> ลัง</span>
                <span className="plan-route note">{list.map((s) => s.store_name).join(' → ')}</span>
                <button type="button" className="btn ghost sm plan-more" aria-expanded={shown}
                  onClick={() => setOpenPlates((cur) => { const n = new Set(cur); if (n.has(plate)) n.delete(plate); else n.add(plate); return n; })}>
                  {shown ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'} <span className="plan-chev" aria-hidden>›</span>
                </button>
              </div>
              {shown && <ol>
                {list.map((s) => (
                  <li key={s.id}>
                    <span className="plan-seq mono">{s.seq}</span>
                    <span className="plan-store">
                      <b>{s.store_name}</b>
                      <span className="note">{[s.store_code, s.store_type && storeTypeName(s.store_type), s.address, s.bill_no && `บิล ${s.bill_no}`].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    <span className="mono plan-cases">{s.cases ?? '–'}<small> ลัง</small></span>
                    <button type="button" className="btn ghost sm plan-del" onClick={() => remove(s.id)} aria-label={`ลบ ${s.store_name}`}>✕</button>
                  </li>
                ))}
              </ol>}
            </div>
            );
          })}
        </div>
      )}
      {stops.length > 0 && open && (
        <div className="row plan-foot">
          <span className="note">ข้อมูลนี้อยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น ฝั่งพนักงานยังไม่เห็น — จะเชื่อมเมื่อสร้างฐานข้อมูลร้านค้า</span>
          <button type="button" className="btn danger sm" onClick={clearDay}>ล้างรายการของวันนี้</button>
        </div>
      )}
    </section>
  );
}
