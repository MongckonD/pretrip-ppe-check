/**
 * Admin home → "เวลาส่งสินค้าที่ร้าน": the store timer report, laid out like the Summary page (สรุปผลการทำงาน):
 * filters on top (date range, vehicle, status, store), summary cards, then 1 row per store per day (10 per page) + CSV.
 *   ลำดับ · วันที่ · ทะเบียนรถ · D-Man · ร้าน · สถานะ · จอด · ออก · เวลาที่ร้าน · ลัง · นาที/ลัง · หมายเหตุ · บันทึกโดย
 * Data: GET /api/store-visits?from&to = the database view v_store_visit_summary (migration 0027); times are server times.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ComboText } from '../components/Fields';
import { AlertIcon, CheckCircleIcon, HourglassIcon, ListIcon, SearchIcon, TimerIcon } from '../components/Icons';
import { useMaster } from '../components/MasterContext';
import { listStoreVisitReport } from '../lib/api';
import { hhmm } from '../lib/storeVisit';
import type { StoreVisitReportRow } from '../lib/types';
import { downloadText, errMsg, toCsv, today } from '../lib/utils';

type Status = StoreVisitReportRow['status'];
const STATUS: Record<Status, { text: string; cls: string }> = {
  done: { text: 'ส่งสำเร็จ', cls: 'p' },
  failed: { text: 'ส่งไม่สำเร็จ', cls: 'f' },
  open: { text: 'กำลังส่ง', cls: 'w' },
  none: { text: 'ยังไม่ส่ง', cls: 'x' },
};
const METHOD: Record<string, string> = { trolley: 'รถเข็น', carry: 'ยก / แบก', both: 'ทั้งสองแบบ' };

/** "2026-11-18" → "11/18/2026" (same as the Summary page and the date picker) */
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const isoDay = (d: Date) => d.toLocaleDateString('sv-SE');
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
const monthStart = (iso: string) => iso.slice(0, 8) + '01';
const monthEnd = (iso: string) => { const d = new Date(iso.slice(0, 8) + '01T00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return isoDay(d); };
const minOf = (a: string, b: string) => (a < b ? a : b);
/** seconds → minutes with 1 decimal */
const min1 = (sec: number) => (sec / 60).toFixed(1);
const perCase = (sec: number | null, cases: number | null) => (sec != null && cases ? (sec / 60 / cases).toFixed(2) : '–');
const casesText = (n: number | null) => (n == null ? '–' : n.toLocaleString('th-TH'));

interface Filters { from: string; to: string; plate: string; status: '' | Status; store: string }
const todayOnly = (): Filters => ({ from: today(), to: today(), plate: '', status: '', store: '' });

function applyFilters(rows: StoreVisitReportRow[], f: Filters) {
  const q = f.store.trim().toLowerCase();
  return rows.filter((r) => (!f.plate || r.plate.toLowerCase().includes(f.plate.trim().toLowerCase()))
    && (!f.status || r.status === f.status)
    && (!q || r.store_name.toLowerCase().includes(q) || r.sap_code.toLowerCase().includes(q)));
}

export function StoreTimes({ refreshKey }: { refreshKey: number }) {
  const [draft, setDraft] = useState<Filters>(todayOnly);
  const [applied, setApplied] = useState<Filters>(todayOnly);
  const [data, setData] = useState<StoreVisitReportRow[] | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await listStoreVisitReport(applied.from, applied.to)); } catch (e) { setError(errMsg(e)); }
  }, [applied.from, applied.to]);
  useEffect(() => { setData(null); load(); }, [load]);
  // the home page's refresh (button / every 2 minutes on today)
  useEffect(() => { if (refreshKey) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => applyFilters(data ?? [], applied), [data, applied]);

  function search(next: Filters = draft) {
    if (!next.from || !next.to) return setMsg('เลือกวันที่เริ่มและวันที่สิ้นสุด');
    if (next.from > next.to) return setMsg('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    if ((Date.parse(next.to) - Date.parse(next.from)) / 86_400_000 > 366) return setMsg('เลือกช่วงวันที่ได้ไม่เกิน 1 ปี');
    setMsg('');
    setDraft(next);
    if (next.from === applied.from && next.to === applied.to) load(); // same range: fetch fresh data
    setApplied(next);
  }
  const quick = (from: string, to: string) => search({ ...draft, from, to });
  const lastMonthDay = addDays(monthStart(today()), -1);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const { vehicles } = useMaster();
  const plateOpts = useMemo(() => [...vehicles].sort((a, b) => a.plate.localeCompare(b.plate, 'th')).map((v) => ({ value: v.plate })), [vehicles]);

  return (
    <>
      <section className="panel rp-filters">
        <h2 className="rp-title"><span className="rp-dot" />เวลาส่งสินค้าที่ร้าน</h2>
        <div className="rp-grid">
          <label className="rp-field">
            <span className="ro-label">วันที่ส่งจาก</span>
            <input type="date" aria-label="วันที่ส่งจาก" value={draft.from} max={today()} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label className="rp-field">
            <span className="ro-label">วันที่ส่งถึง</span>
            <input type="date" aria-label="วันที่ส่งถึง" value={draft.to} max={today()} onChange={(e) => set('to', e.target.value)} />
          </label>
          <div className="rp-field">
            <span className="ro-label">ทะเบียนรถ</span>
            <ComboText value={draft.plate} onChange={(v) => set('plate', v)} blank="— ทั้งหมด —" ariaLabel="ค้นหา ทะเบียนรถ" onEnter={() => search()} options={plateOpts} />
          </div>
          <label className="rp-field">
            <span className="ro-label">สถานะการส่ง</span>
            <select aria-label="สถานะการส่ง" value={draft.status} onChange={(e) => set('status', e.target.value as Filters['status'])}>
              <option value="">— ทั้งหมด —</option>
              <option value="done">ส่งสำเร็จ</option>
              <option value="failed">ส่งไม่สำเร็จ</option>
              <option value="open">กำลังส่ง</option>
              <option value="none">ยังไม่ส่ง</option>
            </select>
          </label>
          <label className="rp-field">
            <span className="ro-label">ร้าน (ชื่อ / รหัส)</span>
            <input type="search" placeholder="เช่น เจ๊หมวย หรือ C10021" value={draft.store} onChange={(e) => set('store', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') search(); }} />
          </label>
        </div>
        <div className="row spread rp-actions">
          <div className="row rp-quick" role="group" aria-label="ช่วงวันที่ด่วน">
            <button type="button" className="btn ghost sm" onClick={() => quick(today(), today())}>วันนี้</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(addDays(today(), -6), today())}>7 วันล่าสุด</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(monthStart(today()), today())}>เดือนนี้</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(monthStart(lastMonthDay), minOf(monthEnd(lastMonthDay), today()))}>เดือนที่แล้ว</button>
          </div>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => search(todayOnly())}>ล้างตัวกรอง</button>
            <button type="button" className="btn rp-search" onClick={() => search()}><span className="ii" aria-hidden><SearchIcon /></span>ค้นหาข้อมูล</button>
          </div>
        </div>
        {msg && <div className="error">{msg}</div>}
        {error && <div className="error">{error}</div>}
      </section>

      {!data && !error && <div className="empty">กำลังโหลด…</div>}
      {data && <Cards rows={rows} />}
      {data && <ReportTable rows={rows} from={applied.from} to={applied.to} />}
    </>
  );
}

/* ---------------- cards ---------------- */

function Cards({ rows }: { rows: StoreVisitReportRow[] }) {
  const done = rows.filter((r) => r.status === 'done');
  const secs = done.reduce((n, r) => n + (r.seconds ?? 0), 0);
  const cases = done.reduce((n, r) => n + (r.cases ?? 0), 0);
  const cards = [
    { icon: <ListIcon />, label: 'ร้านในแผนทั้งหมด', value: String(rows.length), tone: 'all' },
    { icon: <CheckCircleIcon />, label: 'ส่งสำเร็จ', value: String(done.length), tone: 'pass' },
    { icon: <AlertIcon />, label: 'ส่งไม่สำเร็จ', value: String(rows.filter((r) => r.status === 'failed').length), tone: 'fail' },
    { icon: <HourglassIcon />, label: 'กำลังส่ง / ยังไม่ส่ง', value: String(rows.filter((r) => r.status === 'open' || r.status === 'none').length), tone: 'wait' },
    { icon: <TimerIcon />, label: 'เฉลี่ยต่อร้าน (นาที)', value: done.length ? min1(secs / done.length) : '–', tone: 'time' },
    { icon: <TimerIcon />, label: 'นาที / ลัง', value: perCase(secs, cases), tone: 'time' },
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

function ReportTable({ rows, from, to }: { rows: StoreVisitReportRow[]; from: string; to: string }) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [rows]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.min(page, pages - 1);
  const shown = rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);

  function csv() {
    const head = ['ลำดับ', 'วันที่', 'ทะเบียนรถ', 'D-Man', 'รหัสร้าน', 'ร้าน', 'สถานะ', 'เวลาจอด', 'เวลาออก', 'เวลาที่ร้าน (นาที)',
      'ลังที่ส่ง', 'นาที/ลัง', 'SKU', 'ระยะทาง (ม.)', 'วิธีขนย้าย', 'หมายเหตุ', 'บันทึกโดย'];
    downloadText(`store-times-${from}_${to}.csv`, toCsv([head, ...rows.map((r, i) => [
      i + 1, r.plan_date, r.plate, r.dman_name ?? '', r.sap_code, r.store_name, STATUS[r.status].text,
      r.started_at ? hhmm(r.started_at) : '', r.ended_at ? hhmm(r.ended_at) : '', r.seconds != null ? min1(r.seconds) : '',
      r.status === 'done' ? (r.cases ?? '') : '', r.status === 'done' ? perCase(r.seconds, r.cases) : '',
      r.skus ?? '', r.distance_m ?? '', r.move_method ? METHOD[r.move_method] : '', r.note, r.by_name ?? '',
    ])]));
  }

  return (
    <section className="panel">
      <div className="row spread head-row">
        <span className="note">ช่วง {mdy(from)} – {mdy(to)} · พบ {rows.length} ร้าน · เวลาจากเซิร์ฟเวอร์</span>
        {rows.length > 0 && <button className="btn ghost sm" onClick={csv}>ดาวน์โหลด CSV</button>}
      </div>
      {!rows.length ? <div className="empty">ไม่พบข้อมูลในช่วงหรือเงื่อนไขที่เลือก</div> : (
        <div className="tbl">
          <table className="sum-tbl rp-tbl">
            <thead>
              <tr>
                <th className="num">ลำดับ</th><th>วันที่</th><th>ทะเบียนรถ</th><th>D-Man</th><th>ร้าน</th><th>สถานะ</th>
                <th className="num">จอด</th><th className="num">ออก</th><th className="num">เวลาที่ร้าน</th><th className="num">ลัง</th>
                <th className="num">นาที/ลัง</th><th>หมายเหตุ</th><th>บันทึกโดย</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.plan_id}>
                  <td className="num">{p * PAGE_SIZE + i + 1}</td>
                  <td className="mono">{mdy(r.plan_date)}</td>
                  <td><b>{r.plate}</b></td>
                  <td>{r.dman_name || '–'}</td>
                  <td><b>{r.store_name}</b> <span className="note mono">{r.sap_code}</span></td>
                  <td><span className={`pill ${STATUS[r.status].cls}`}>● {r.status === 'open' && r.ended_at ? 'รอบันทึก' : STATUS[r.status].text}</span></td>
                  <td className="num">{r.started_at ? hhmm(r.started_at) : '–'}</td>
                  <td className="num">{r.ended_at ? hhmm(r.ended_at) : '–'}</td>
                  <td className="num">{r.seconds != null ? `${min1(r.seconds)} นาที` : '–'}</td>
                  <td className="num">{r.status === 'done' ? casesText(r.cases) : '–'}</td>
                  <td className="num">{r.status === 'done' ? perCase(r.seconds, r.cases) : '–'}</td>
                  <td className="stt-note">{r.note || '–'}</td>
                  <td className="note">{r.by_name || '–'}</td>
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
