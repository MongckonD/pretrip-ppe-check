/**
 * Admin "PPE" (/admin/ppe): PPE results per person per day, laid out like สรุป / สถานะรถ.
 *   filters (date range, employee, plate, result, missing item) → cards → table (10 / page) → CSV
 * One row = one employee on one day: everyone on a vehicle team that day (expected, may be "ยังไม่ตรวจ")
 * plus anyone who has a PPE sheet. Same rule as the DB view v_daily_ppe_status. PPE needs no approval.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ComboText } from '../components/Fields';
import { useMaster } from '../components/MasterContext';
import { listPpeInspections, listVehicleInspections } from '../lib/api';
import type { PpeInspection, PpeResult, VehicleInspection } from '../lib/types';
import { AlertIcon, CheckCircleIcon, HourglassIcon, ListIcon, PercentIcon, UsersIcon } from '../components/Icons';
import { downloadText, errMsg, toCsv, today } from '../lib/utils';

type Result = 'ok' | 'missing' | 'partial' | 'none';
const RESULT: Record<Result, { text: string; cls: string }> = {
  ok: { text: 'ครบ', cls: 'p' },
  missing: { text: 'ขาดอุปกรณ์', cls: 'f' },
  partial: { text: 'ตรวจไม่ครบ', cls: 'w' },
  none: { text: 'ยังไม่ตรวจ', cls: 'x' },
};
const resultOf = (p?: PpeInspection): Result =>
  !p ? 'none' : p.status === 'ครบ' ? 'ok' : p.status === 'อุปกรณ์ไม่ครบ' ? 'missing' : 'partial';

interface Row {
  key: string; date: string; empId: string; name: string; position: string;
  duty: string; plate: string; inspector: string; expected: boolean;
  results: Record<string, PpeResult>; result: Result;
}
interface Filters { from: string; to: string; emp: string; plate: string; result: '' | Result; item: string }
const todayFilters = (): Filters => ({ from: today(), to: today(), emp: '', plate: '', result: '', item: '' });

const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const isoDay = (d: Date) => d.toLocaleDateString('sv-SE');
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
const has = (cell: string, q: string) => !q || cell.toLowerCase().includes(q.trim().toLowerCase());

export function PpeReportPage() {
  const { employees, vehicles, ppeItems, nameOf, codeOf } = useMaster();
  const items = useMemo(() => ppeItems.filter((p) => p.active).sort((a, b) => a.sort_order - b.sort_order), [ppeItems]);
  const [draft, setDraft] = useState<Filters>(todayFilters);
  const [applied, setApplied] = useState<Filters>(todayFilters);
  const [data, setData] = useState<{ veh: VehicleInspection[]; ppe: PpeInspection[] } | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    const opts = { from: applied.from, to: applied.to };
    try {
      const [veh, ppe] = await Promise.all([listVehicleInspections(opts), listPpeInspections(opts)]);
      setData({ veh, ppe }); setError('');
    } catch (e) { setError(errMsg(e)); }
  }, [applied.from, applied.to]);
  useEffect(() => { setData(null); load(); }, [load]);

  /** person-days: every crew member of the day's vehicle checks + anyone with a PPE sheet (= v_daily_ppe_status) */
  const all = useMemo<Row[]>(() => {
    if (!data) return [];
    const pos = new Map(employees.map((e) => [e.id, e.role]));
    const crew = new Map<string, { duty: string; plate: string }>();
    for (const c of data.veh) {
      const team: [string | null, string][] = [[c.dman_id, 'D-Man'], [c.helper1_id, 'Helper 1'], [c.helper2_id, 'Helper 2']];
      for (const [id, duty] of team) {
        const k = `${c.inspect_date}|${id}`;
        if (id && !crew.has(k)) crew.set(k, { duty, plate: c.plate });
      }
    }
    const sheet = new Map(data.ppe.map((p) => [`${p.inspect_date}|${p.employee_id}`, p]));
    const keys = new Set([...crew.keys(), ...sheet.keys()]);
    return [...keys].map((k) => {
      const [date, empId] = k.split('|');
      const c = crew.get(k), p = sheet.get(k);
      return {
        key: k, date, empId, name: nameOf(empId), position: pos.get(empId) ?? '',
        duty: c?.duty ?? 'ไม่อยู่ในทีมรถ', plate: c?.plate ?? p?.plate ?? '',
        inspector: p ? nameOf(p.inspector_id) : '', expected: !!c,
        results: p?.results ?? {}, result: resultOf(p),
      };
    }).sort((a, b) => b.date.localeCompare(a.date) || a.plate.localeCompare(b.plate, 'th') || a.duty.localeCompare(b.duty) || a.empId.localeCompare(b.empId));
  }, [data, employees, nameOf]);

  const rows = useMemo(() => all.filter((r) => (has(r.name, applied.emp) || has(codeOf(r.empId), applied.emp)) && has(r.plate, applied.plate)
    && (!applied.result || r.result === applied.result)
    && (!applied.item || r.results[applied.item] === 2)), [all, applied, codeOf]);
  useEffect(() => { setPage(0); }, [rows]);

  function search(next: Filters = draft) {
    if (!next.from || !next.to) return setMsg('เลือกวันที่เริ่มและวันที่สิ้นสุด');
    if (next.from > next.to) return setMsg('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    if ((Date.parse(next.to) - Date.parse(next.from)) / 86_400_000 > 366) return setMsg('เลือกช่วงวันที่ได้ไม่เกิน 1 ปี');
    setMsg(''); setDraft(next);
    if (next.from === applied.from && next.to === applied.to) load();
    setApplied(next);
  }
  const quick = (from: string, to: string) => search({ ...draft, from, to });
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const empOpts = useMemo(() => employees.filter((e) => e.name).map((e) => ({ value: e.name, label: e.code ? `${e.name} (${e.code})` : e.name })), [employees]);
  const plateOpts = useMemo(() => [...vehicles].sort((a, b) => a.plate.localeCompare(b.plate, 'th')).map((v) => ({ value: v.plate })), [vehicles]);

  // cards over the rows found
  const expected = rows.filter((r) => r.expected).length;
  const checked = rows.filter((r) => r.result !== 'none').length;
  const ok = rows.filter((r) => r.result === 'ok').length;
  const missing = rows.filter((r) => r.result === 'missing' || r.result === 'partial').length;
  const notYet = rows.filter((r) => r.result === 'none').length;
  const pct = checked ? Math.round((ok / checked) * 1000) / 10 : null;

  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const p = Math.min(page, pages - 1);
  const shown = rows.slice(p * 10, p * 10 + 10);

  function csv() {
    const head = ['ลำดับ', 'วันที่', 'รหัสพนักงาน', 'ชื่อ', 'ตำแหน่ง', 'หน้าที่บนรถ', 'ทะเบียนรถ', 'ผู้ตรวจ', ...items.map((i) => i.name), 'ผล'];
    downloadText(`ppe-${applied.from}_${applied.to}.csv`, toCsv([head, ...rows.map((r, i) => [
      i + 1, r.date, codeOf(r.empId), r.name, r.position, r.duty, r.plate, r.inspector,
      ...items.map((it) => (r.results[it.code] === 1 ? 'มี' : r.results[it.code] === 2 ? 'ไม่มี' : '')), RESULT[r.result].text,
    ])]));
  }

  return (
    <>
      <section className="panel rp-filters">
        <h2 className="rp-title"><span className="rp-dot" />รายงานผลการตรวจ PPE</h2>
        <div className="rp-grid">
          <label className="rp-field"><span className="ro-label">วันที่ตรวจจาก</span>
            <input type="date" aria-label="วันที่ตรวจจาก" value={draft.from} max={today()} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="rp-field"><span className="ro-label">วันที่ตรวจถึง</span>
            <input type="date" aria-label="วันที่ตรวจถึง" value={draft.to} max={today()} onChange={(e) => set('to', e.target.value)} /></label>
          <div className="rp-field"><span className="ro-label">พนักงาน</span>
            <ComboText value={draft.emp} onChange={(v) => set('emp', v)} options={empOpts} blank="— ทั้งหมด —" ariaLabel="ค้นหา พนักงาน" onEnter={() => search()} /></div>
          <div className="rp-field"><span className="ro-label">ทะเบียนรถ</span>
            <ComboText value={draft.plate} onChange={(v) => set('plate', v)} options={plateOpts} blank="— ทั้งหมด —" ariaLabel="ค้นหา ทะเบียนรถ" onEnter={() => search()} /></div>
          <label className="rp-field"><span className="ro-label">ผลการตรวจ</span>
            <select aria-label="ผลการตรวจ" value={draft.result} onChange={(e) => set('result', e.target.value as Filters['result'])}>
              <option value="">— ทั้งหมด —</option>
              <option value="ok">ครบ</option><option value="missing">ขาดอุปกรณ์</option>
              <option value="partial">ตรวจไม่ครบ</option><option value="none">ยังไม่ตรวจ</option>
            </select></label>
          <label className="rp-field"><span className="ro-label">อุปกรณ์ที่ขาด</span>
            <select aria-label="อุปกรณ์ที่ขาด" value={draft.item} onChange={(e) => set('item', e.target.value)}>
              <option value="">— ทั้งหมด —</option>
              {items.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
            </select></label>
        </div>
        <div className="row spread rp-actions">
          <div className="row rp-quick" role="group" aria-label="ช่วงวันที่ด่วน">
            <button type="button" className="btn ghost sm" onClick={() => quick(today(), today())}>วันนี้</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(addDays(today(), -1), addDays(today(), -1))}>เมื่อวาน</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(addDays(today(), -6), today())}>7 วันล่าสุด</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(today().slice(0, 8) + '01', today())}>เดือนนี้</button>
          </div>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => search(todayFilters())}>ล้างตัวกรอง</button>
            <button type="button" className="btn rp-search" onClick={() => search()}>🔍 ค้นหาข้อมูล</button>
          </div>
        </div>
        {msg && <div className="error">{msg}</div>}
        {error && <div className="error">{error}</div>}
      </section>

      {!data && !error && <div className="empty">กำลังโหลด…</div>}
      {data && (
        <div className="rp-cards">
          {[
            { icon: <UsersIcon />, label: 'ต้องตรวจ (ทีมบนรถ)', value: String(expected), tone: 'all' },
            { icon: <ListIcon />, label: 'ตรวจแล้ว', value: String(checked), tone: 'all' },
            { icon: <CheckCircleIcon />, label: 'ครบ', value: String(ok), tone: 'pass' },
            { icon: <AlertIcon />, label: 'ขาด / ตรวจไม่ครบ', value: String(missing), tone: 'fail' },
            { icon: <HourglassIcon />, label: 'ยังไม่ตรวจ', value: String(notYet), tone: 'wait' },
            { icon: <PercentIcon />, label: 'PPE ครบ (ของที่ตรวจแล้ว)', value: pct === null ? '–' : `${pct}%`, tone: 'time' },
          ].map((c) => (
            <div key={c.label} className={`rp-card ${c.tone}`}>
              <span className="rp-ico" aria-hidden="true">{c.icon}</span>
              <div><span>{c.label}</span><b>{c.value}</b></div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <section className="panel">
          <div className="row spread head-row">
            <span className="note">ช่วง {mdy(applied.from)}{applied.from === applied.to ? '' : ` – ${mdy(applied.to)}`} · {rows.length} แถว</span>
            {rows.length > 0 && <button className="btn ghost sm" onClick={csv}>ดาวน์โหลด CSV</button>}
          </div>
          {!rows.length ? <div className="empty">ไม่พบข้อมูลในช่วงหรือเงื่อนไขที่เลือก</div> : (
            <div className="tbl">
              <table className="sum-tbl rp-tbl ppe-tbl">
                <thead>
                  <tr>
                    <th className="num">ลำดับ</th><th>วันที่</th><th>พนักงาน</th><th>หน้าที่</th><th>ทะเบียนรถ</th><th>ผู้ตรวจ</th>
                    {items.map((i) => <th key={i.code} className="c">{i.name}</th>)}
                    <th>ผล</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.key} className={r.result === 'none' ? 'vs-none' : ''}>
                      <td className="num">{p * 10 + i + 1}</td>
                      <td className="mono">{mdy(r.date)}</td>
                      <td><b>{r.name}</b> <span className="note mono">{codeOf(r.empId)}</span>{r.position && <div className="note">{r.position}</div>}</td>
                      <td>{r.duty}</td>
                      <td><b>{r.plate || '–'}</b></td>
                      <td>{r.inspector || '–'}</td>
                      {items.map((it) => {
                        const v = r.results[it.code];
                        return <td key={it.code} className="c">{v === 1 ? <span className="vs-yes" title="มี">✓</span> : v === 2 ? <span className="vs-no" title="ไม่มี">✕</span> : <span className="note">–</span>}</td>;
                      })}
                      <td><span className={`pill ${RESULT[r.result].cls}`}>● {RESULT[r.result].text}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 10 && (
            <div className="pager" role="navigation" aria-label="เปลี่ยนหน้า">
              <span className="note">แถวที่ {p * 10 + 1}–{Math.min(rows.length, p * 10 + 10)} จาก {rows.length}</span>
              <div className="row">
                <button type="button" className="btn ghost sm" disabled={p === 0} onClick={() => setPage(p - 1)}>‹ ก่อนหน้า</button>
                <span className="pager-no">หน้า {p + 1}/{pages}</span>
                <button type="button" className="btn ghost sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>ถัดไป ›</button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
