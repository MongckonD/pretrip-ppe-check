/**
 * Admin report "สรุปผลการทำงาน" (/admin/summary): one table for any date range (day / month / custom),
 * laid out like a monitoring screen — filters on top, summary cards, then 1 row per vehicle per day:
 *   ลำดับ · วันที่ · ทะเบียนรถ · D-Man · Helper1 · Helper2 · ตรวจรถ · PPE · เริ่ม · จบ · เวลาทำงาน · สถานะ
 * Total / average hours per employee for any range: button "กดเพื่อดูชั่วโมงรวม" (HoursDialog).
 * The same per-day data is in the database view v_vehicle_day_summary.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ComboText } from '../components/Fields';
import { useMaster } from '../components/MasterContext';
import { listPpeInspections, listTripActivities, listVehicleInspections } from '../lib/api';
import type { PpeInspection, TripActivity, VehicleInspection } from '../lib/types';
import { AlertIcon, CheckCircleIcon, HourglassIcon, ListIcon } from '../components/Icons';
import { downloadText, errMsg, toCsv, today } from '../lib/utils';

interface Data { veh: VehicleInspection[]; ppe: PpeInspection[]; trips: TripActivity[] }

/** 495 → "8:15" (hours:minutes) */
const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
/** "2026-11-18" → "11/18/2026" (month/day/year, same as the date picker) */
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const isoDay = (d: Date) => d.toLocaleDateString('sv-SE');
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
const monthStart = (iso: string) => iso.slice(0, 8) + '01';
const monthEnd = (iso: string) => { const d = new Date(iso.slice(0, 8) + '01T00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return isoDay(d); };
const minOf = (a: string, b: string) => (a < b ? a : b);

type Status = 'wait' | 'ok' | 'bad';
const STATUS: Record<Status, { text: string; cls: string }> = {
  wait: { text: 'รออนุมัติ', cls: 'w' },
  ok: { text: 'อนุมัติแล้ว', cls: 'p' },
  bad: { text: 'ไม่อนุมัติ', cls: 'f' },
};

interface Row {
  id: string; date: string; time: string; plate: string; dman: string; h1: string; h2: string;
  fail: number; ppeOk: number; ppeTotal: number; start: string; end: string;
  minutes: number; started: boolean; running: boolean; status: Status;
}

interface Filters {
  from: string; to: string; plate: string; dman: string; h1: string; h2: string;
  check: '' | 'pass' | 'fail'; status: '' | Status;
}
const thisMonth = (): Filters => ({ from: monthStart(today()), to: today(), plate: '', dman: '', h1: '', h2: '', check: '', status: '' });
const NONE = '(ไม่มี)';
const has = (cell: string, q: string) => !q || (q === NONE ? !cell : cell.toLowerCase().includes(q.trim().toLowerCase()));

/* ---------------- data ---------------- */

function useRangeData(from: string, to: string) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    const opts = { from, to };
    try {
      const [veh, ppe, trips] = await Promise.all([listVehicleInspections(opts), listPpeInspections(opts), listTripActivities(opts)]);
      setData({ veh, ppe, trips });
    } catch (e) { setError(errMsg(e)); }
  }, [from, to]);
  useEffect(() => { setData(null); load(); }, [load]);
  return { data, error, load };
}

function useRows(d: Data | null): Row[] {
  const { nameOf } = useMaster();
  return useMemo(() => {
    if (!d) return [];
    return d.veh.map((r) => {
      const crew = [r.dman_id, r.helper1_id, r.helper2_id].filter((x): x is string => !!x);
      const ppe = d.ppe.filter((p) => p.inspect_date === r.inspect_date && p.plate === r.plate && crew.includes(p.employee_id));
      const trip = d.trips.find((t) => t.activity_date === r.inspect_date && t.plate === r.plate);
      const minutes = trip?.work_ended_at ? trip.work_minutes ?? 0 : 0;
      return {
        id: r.id, date: r.inspect_date, time: (r.inspect_time ?? '').slice(0, 5), plate: r.plate,
        dman: nameOf(r.dman_id), h1: r.helper1_id ? nameOf(r.helper1_id) : '', h2: r.helper2_id ? nameOf(r.helper2_id) : '',
        fail: r.fail_count, ppeOk: crew.filter((id) => ppe.some((p) => p.employee_id === id && p.status === 'ครบ')).length, ppeTotal: crew.length,
        start: trip?.start_time ?? '', end: trip?.end_time ?? '',
        minutes, started: !!trip, running: !!trip && !trip.work_ended_at,
        status: (r.approved_at ? 'ok' : r.rejected_at ? 'bad' : 'wait') as Status,
      };
    });
  }, [d, nameOf]);
}

/** apply the filters; newest first */
function applyFilters(rows: Row[], f: Filters): Row[] {
  return rows.filter((r) => has(r.plate, f.plate) && has(r.dman, f.dman) && has(r.h1, f.h1) && has(r.h2, f.h2)
    && (!f.check || (f.check === 'fail' ? r.fail > 0 : r.fail === 0))
    && (!f.status || r.status === f.status)).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || a.plate.localeCompare(b.plate, 'th'));
}

/* ---------------- page ---------------- */

export function SummaryPage() {
  const [draft, setDraft] = useState<Filters>(thisMonth);
  const [applied, setApplied] = useState<Filters>(thisMonth);
  const { data, error, load } = useRangeData(applied.from, applied.to);
  const all = useRows(data);
  const rows = useMemo(() => applyFilters(all, applied), [all, applied]);
  const [msg, setMsg] = useState('');
  const [hoursOpen, setHoursOpen] = useState(false);

  function search(next: Filters = draft) {
    if (!next.from || !next.to) return setMsg('เลือกวันที่เริ่มและวันที่สิ้นสุด');
    if (next.from > next.to) return setMsg('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    if ((Date.parse(next.to) - Date.parse(next.from)) / 86_400_000 > 366) return setMsg('เลือกช่วงวันที่ได้ไม่เกิน 1 ปี');
    setMsg('');
    setDraft(next);
    if (next.from === applied.from && next.to === applied.to) load(); // same range: fetch fresh data
    setApplied(next);
  }
  /** quick ranges search straight away (keeping the other filters) */
  const quick = (from: string, to: string) => search({ ...draft, from, to });
  const lastMonthDay = addDays(monthStart(today()), -1);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  // dropdown choices: every vehicle / every employee (not only those in the current results)
  const { vehicles, employees } = useMaster();
  const plateOpts = useMemo(() => [...vehicles].sort((a, b) => a.plate.localeCompare(b.plate, 'th')).map((v) => ({ value: v.plate })), [vehicles]);
  const peopleOpts = useMemo(() => employees.filter((e) => e.name).map((e) => ({ value: e.name, label: e.code ? `${e.name} (${e.code})` : e.name })), [employees]);
  const box = (k: 'plate' | 'dman' | 'h1' | 'h2', label: string, withNone: boolean) => (
    <div className="rp-field">
      <span className="ro-label">{label}</span>
      <ComboText value={draft[k]} onChange={(v) => set(k, v)} blank="— ทั้งหมด —" ariaLabel={`ค้นหา ${label}`} onEnter={() => search()}
        options={k === 'plate' ? plateOpts : withNone ? [{ value: NONE, label: '(ไม่มีผู้ช่วย)' }, ...peopleOpts] : peopleOpts} />
    </div>
  );

  return (
    <>
      <section className="panel rp-filters">
        <h2 className="rp-title"><span className="rp-dot" />รายงานผลการทำงาน</h2>
        <div className="rp-grid">
          <label className="rp-field">
            <span className="ro-label">วันที่ตรวจจาก</span>
            <input type="date" aria-label="วันที่ตรวจจาก" value={draft.from} max={today()} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label className="rp-field">
            <span className="ro-label">วันที่ตรวจถึง</span>
            <input type="date" aria-label="วันที่ตรวจถึง" value={draft.to} max={today()} onChange={(e) => set('to', e.target.value)} />
          </label>
          {box('plate', 'ทะเบียนรถ', false)}
          {box('dman', 'D-Man', false)}
          {box('h1', 'Helper1', true)}
          {box('h2', 'Helper2', true)}
          <label className="rp-field">
            <span className="ro-label">ผลการตรวจ</span>
            <select aria-label="ผลการตรวจ" value={draft.check} onChange={(e) => set('check', e.target.value as Filters['check'])}>
              <option value="">— ทั้งหมด —</option>
              <option value="pass">ผ่าน</option>
              <option value="fail">ไม่ผ่าน</option>
            </select>
          </label>
          <label className="rp-field">
            <span className="ro-label">สถานะอนุมัติ</span>
            <select aria-label="สถานะอนุมัติ" value={draft.status} onChange={(e) => set('status', e.target.value as Filters['status'])}>
              <option value="">— ทั้งหมด —</option>
              <option value="wait">รออนุมัติ</option>
              <option value="ok">อนุมัติแล้ว</option>
              <option value="bad">ไม่อนุมัติ</option>
            </select>
          </label>
          <div className="rp-field">
            <span className="ro-label">ชั่วโมงทำงานของพนักงาน</span>
            <button type="button" className="btn rp-hours-btn" onClick={() => setHoursOpen(true)}>⏱ กดเพื่อดูชั่วโมงรวม</button>
          </div>
        </div>
        <div className="row spread rp-actions">
          <div className="row rp-quick" role="group" aria-label="ช่วงวันที่ด่วน">
            <button type="button" className="btn ghost sm" onClick={() => quick(today(), today())}>วันนี้</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(addDays(today(), -6), today())}>7 วันล่าสุด</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(monthStart(today()), today())}>เดือนนี้</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(monthStart(lastMonthDay), minOf(monthEnd(lastMonthDay), today()))}>เดือนที่แล้ว</button>
          </div>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => search(thisMonth())}>ล้างตัวกรอง</button>
            <button type="button" className="btn rp-search" onClick={() => search()}>🔍 ค้นหาข้อมูล</button>
          </div>
        </div>
        {msg && <div className="error">{msg}</div>}
        {error && <div className="error">{error}</div>}
      </section>

      {!data && !error && <div className="empty">กำลังโหลด…</div>}
      {data && <SummaryCards rows={rows} />}
      {data && <ReportTable rows={rows} from={applied.from} to={applied.to} />}
      {hoursOpen && <HoursDialog from={applied.from} to={applied.to} onClose={() => setHoursOpen(false)} />}
    </>
  );
}

/* ---------------- employee hours (dialog) ---------------- */

interface EmpHours { id: string; name: string; role: string; days: number; minutes: number }

/**
 * Hours per employee for a date range: every crew member (D-Man / Helper1 / Helper2) of a vehicle-day gets that
 * day's work time. Only finished days count (a day still running is not added yet).
 */
function HoursDialog({ from: from0, to: to0, onClose }: { from: string; to: string; onClose: () => void }) {
  const { employees, nameOf, codeOf } = useMaster();
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(to0);
  const [range, setRange] = useState({ from: from0, to: to0 });
  const [data, setData] = useState<{ veh: VehicleInspection[]; trips: TripActivity[] } | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null); setError('');
    Promise.all([listVehicleInspections(range), listTripActivities(range)])
      .then(([veh, trips]) => { if (alive) setData({ veh, trips }); })
      .catch((e) => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [range]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function apply() {
    if (!from || !to) return setError('เลือกวันที่เริ่มและวันที่สิ้นสุด');
    if (from > to) return setError('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) return setError('เลือกช่วงวันที่ได้ไม่เกิน 1 ปี');
    setRange({ from, to });
  }

  const list = useMemo<EmpHours[]>(() => {
    if (!data) return [];
    const role = new Map(employees.map((e) => [e.id, e.role]));
    const m = new Map<string, EmpHours>();
    for (const c of data.veh) {
      const trip = data.trips.find((t) => t.activity_date === c.inspect_date && t.plate === c.plate);
      if (!trip?.work_ended_at) continue; // not started / still running → not counted
      const min = trip.work_minutes ?? 0;
      for (const id of [c.dman_id, c.helper1_id, c.helper2_id]) {
        if (!id) continue;
        const e = m.get(id) ?? { id, name: nameOf(id), role: role.get(id) ?? '', days: 0, minutes: 0 };
        e.days++; e.minutes += min;
        m.set(id, e);
      }
    }
    return [...m.values()].sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id));
  }, [data, employees, nameOf]);

  const ql = q.trim().toLowerCase();
  const shown = list.filter((e) => !ql || `${codeOf(e.id)} ${e.name} ${e.role}`.toLowerCase().includes(ql));
  const running = data ? data.trips.filter((t) => !t.work_ended_at).length : 0;

  function csv() {
    const head = ['รหัสพนักงาน', 'ชื่อ', 'ตำแหน่ง', 'วันทำงาน', 'ชั่วโมงรวม (นาที)', 'เฉลี่ย/วัน (นาที)'];
    downloadText(`hours-${range.from}_${range.to}.csv`, toCsv([head, ...shown.map((e) => [
      codeOf(e.id), e.name, e.role, e.days, e.minutes, e.days ? Math.round(e.minutes / e.days) : 0,
    ])]));
  }

  return createPortal(
    <div className="dlg-back" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label="ชั่วโมงรวมของพนักงาน" onClick={(e) => e.stopPropagation()}>
        <div className="row spread dlg-head">
          <h2 className="flush">⏱ ชั่วโมงรวมของพนักงาน</h2>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="ปิด">✕ ปิด</button>
        </div>
        <div className="row dlg-range">
          <label className="rp-field"><span className="ro-label">จากวันที่</span>
            <input type="date" value={from} max={today()} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="rp-field"><span className="ro-label">ถึงวันที่</span>
            <input type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value)} /></label>
          <button type="button" className="btn rp-search" onClick={apply}>แสดง</button>
          <input type="search" className="dlg-q" placeholder="ค้นหาชื่อ / รหัส…" aria-label="ค้นหาพนักงาน" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="note flush-note">
          ช่วง {mdy(range.from)} – {mdy(range.to)} · นับทุกคนในทีม (D-Man และ Helper) เฉพาะวันที่กดจบงานแล้ว
          {running > 0 && ` · ยังทำงานอยู่ ${running} คัน (ยังไม่นับ)`}
        </p>
        {error && <div className="error">{error}</div>}
        {!data && !error && <div className="empty">กำลังโหลด…</div>}
        {data && (!shown.length ? <div className="empty">ไม่มีชั่วโมงทำงานในช่วงนี้</div> : (
          <div className="tbl dlg-body">
            <table className="sum-tbl rp-tbl">
              <thead>
                <tr><th className="num">ลำดับ</th><th>พนักงาน</th><th>ตำแหน่ง</th><th className="num">วันทำงาน</th><th className="num">ชั่วโมงรวม</th><th className="num">เฉลี่ย/วัน</th></tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={e.id}>
                    <td className="num">{i + 1}</td>
                    <td><b>{e.name}</b> <span className="note mono">{codeOf(e.id)}</span></td>
                    <td className="note">{e.role || '–'}</td>
                    <td className="num">{e.days}</td>
                    <td className="num"><b>{hm(e.minutes)}</b></td>
                    <td className="num">{e.days ? hm(Math.round(e.minutes / e.days)) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {data && shown.length > 0 && (
          <div className="row spread">
            <span className="note">{shown.length} คน · รวม {hm(shown.reduce((s, e) => s + e.minutes, 0))} ชม.</span>
            <button type="button" className="btn ghost sm" onClick={csv}>ดาวน์โหลด CSV</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- cards ---------------- */

function SummaryCards({ rows }: { rows: Row[] }) {
  const pass = rows.filter((r) => !r.fail).length;
  const fail = rows.length - pass;
  const wait = rows.filter((r) => r.status === 'wait').length;
  const cards = [
    { icon: <ListIcon />, label: 'ผลตรวจทั้งหมด', value: String(rows.length), tone: 'all' },
    { icon: <CheckCircleIcon />, label: 'ผ่าน', value: String(pass), tone: 'pass' },
    { icon: <AlertIcon />, label: 'ไม่ผ่าน', value: String(fail), tone: 'fail' },
    { icon: <HourglassIcon />, label: 'รออนุมัติ', value: String(wait), tone: 'wait' },
  ];
  return (
    <div className="rp-cards">
      {cards.map((c) => (
        <div key={c.label} className={`rp-card ${c.tone}`}>
          <span className="rp-ico" aria-hidden="true">{c.icon}</span>
          <div><span>{c.label}</span><b>{c.value}</b></div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- table (10 rows per page) ---------------- */

const PAGE_SIZE = 10;

function ReportTable({ rows, from, to }: { rows: Row[]; from: string; to: string }) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [rows]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.min(page, pages - 1);
  const shown = rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);

  function csv() {
    const head = ['ลำดับ', 'วันที่', 'ทะเบียนรถ', 'D-Man', 'Helper1', 'Helper2', 'ตรวจรถ', 'PPE ครบ', 'ทีมบนรถ', 'เริ่ม', 'จบ',
      'เวลาทำงาน (นาที)', 'สถานะ'];
    downloadText(`summary-${from}_${to}.csv`, toCsv([head, ...rows.map((r, i) => [
      i + 1, r.date, r.plate, r.dman, r.h1, r.h2, r.fail ? `ไม่ผ่าน ${r.fail} ข้อ` : 'ผ่าน', r.ppeOk, r.ppeTotal, r.start, r.end,
      r.running ? 'กำลังทำงาน' : r.started ? r.minutes : '', STATUS[r.status].text,
    ])]));
  }

  return (
    <section className="panel">
      <div className="row spread head-row">
        <span className="note">ช่วง {mdy(from)} – {mdy(to)} · พบ {rows.length} แถว</span>
        {rows.length > 0 && <button className="btn ghost sm" onClick={csv}>ดาวน์โหลด CSV</button>}
      </div>
      {!rows.length ? <div className="empty">ไม่พบข้อมูลในช่วงหรือเงื่อนไขที่เลือก</div> : (
        <div className="tbl">
          <table className="sum-tbl rp-tbl">
            <thead>
              <tr>
                <th className="num">ลำดับ</th><th>วันที่</th><th>ทะเบียนรถ</th><th>D-Man</th><th>Helper1</th><th>Helper2</th>
                <th>ตรวจรถ</th><th>PPE</th><th className="num">เริ่ม</th><th className="num">จบ</th><th className="num">เวลาทำงาน</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id}>
                  <td className="num">{p * PAGE_SIZE + i + 1}</td>
                  <td className="mono">{mdy(r.date)}</td>
                  <td><b>{r.plate}</b></td>
                  <td>{r.dman}</td>
                  <td>{r.h1 || '–'}</td>
                  <td>{r.h2 || '–'}</td>
                  <td>{r.fail ? <span className="pill f">● ไม่ผ่าน {r.fail}</span> : <span className="pill p">● ผ่าน</span>}</td>
                  <td><span className={`pill ${r.ppeOk === r.ppeTotal ? 'p' : 'w'}`}>{r.ppeOk}/{r.ppeTotal}</span></td>
                  <td className="num">{r.start || '–'}</td>
                  <td className="num">{r.end || '–'}</td>
                  <td className="num">{r.running ? <span className="pill w">กำลังทำงาน</span> : r.started ? hm(r.minutes) : '–'}</td>
                  <td><span className={`pill ${STATUS[r.status].cls}`}>● {STATUS[r.status].text}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > PAGE_SIZE && (
        <div className="pager" role="navigation" aria-label="เปลี่ยนหน้า">
          <span className="note">แถวที่ {p * PAGE_SIZE + 1}–{Math.min(rows.length, (p + 1) * PAGE_SIZE)} จาก {rows.length}</span>
          <div className="row">
            <button type="button" className="btn ghost sm" disabled={p === 0} onClick={() => setPage(p - 1)}>‹ ก่อนหน้า</button>
            <span className="pager-no">หน้า {p + 1}/{pages}</span>
            <button type="button" className="btn ghost sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>ถัดไป ›</button>
          </div>
        </div>
      )}
    </section>
  );
}
