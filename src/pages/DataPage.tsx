/**
 * Admin "ข้อมูลการตรวจ" (/admin/data): the raw data of a month, one table per tab, each with its CSV download:
 *   DATA รถ          1 row = 1 vehicle / day (every check item, mileage, crew)
 *   DATA PPE         1 row = 1 employee / day
 *   DATA เวลาทำงาน    1 row = 1 vehicle / day (start / end of work, minutes worked)
 *                    + เวลาทำงานของพนักงาน: 1 row = 1 employee / day — every crew member (D-Man / Helper 1 / Helper 2) of the
 *                    vehicle's check gets that day's work time (same rule as "ชั่วโมงรวม" on the Summary page)
 *   DATA ร้านค้า      1 row = 1 store of the delivery plan / day (plan bills / cases + delivery status and times,
 *                    database view v_store_visit_summary) — only with the store switches on
 * Only the open tab is read from the database (fewer rows read).
 */
import { useEffect, useState } from 'react';
import { useMaster, type MasterCtx } from '../components/MasterContext';
import { RefreshButton } from '../components/RefreshButton';
import { listPpeInspections, listStoreVisitReport, listTripActivities, listVehicleInspections } from '../lib/api';
import { FEATURES } from '../lib/features';
import { hhmm } from '../lib/storeVisit';
import type { PpeInspection, StoreVisitReportRow, TripActivity, VehicleInspection } from '../lib/types';
import { PHOTO_STATUS, downloadText, errMsg, pad2, toCsv } from '../lib/utils';

type Cell = string | number;
interface Table { head: string[]; rows: Cell[][]; codeFrom: number; codeTo: number }

function vehicleTable(V: VehicleInspection[], m: MasterCtx): Table {
  const items = m.checkItems.filter((i) => i.active);
  const head = ['วันที่', 'เดือน (yyyy-mm)', 'รหัส D-Man', 'ชื่อ D-Man', 'Helper 1', 'Helper 2', 'ทะเบียนรถ', 'เลขไมล์',
    'เวลาตรวจ', 'ส่งภาพเข้าระบบ', 'ผลตรวจ 1/2', 'ข้อบกพร่อง/หมายเหตุ',
    ...items.map((i) => `${pad2(i.item_no)} ${i.name}`),
    'จำนวนผ่าน', 'จำนวนไม่ผ่าน', 'จำนวนไม่เกี่ยวข้อง', 'จำนวนกรอก', 'ความครบถ้วน'];
  const rows = V.map((r) => [
    r.inspect_date, r.month, m.codeOf(r.dman_id), m.nameOf(r.dman_id),
    r.helper1_id ? m.nameOf(r.helper1_id) : '', r.helper2_id ? m.nameOf(r.helper2_id) : '',
    r.plate, r.mileage ?? '', (r.inspect_time ?? '').slice(0, 5), PHOTO_STATUS[r.photo_status],
    r.overall_result ?? '', r.note,
    ...items.map((i) => r.results?.[String(i.item_no)] ?? ''),
    r.pass_count, r.fail_count, r.na_count, r.filled_count, r.filled_count >= items.length ? 'ครบ' : 'ไม่ครบ',
  ]);
  return { head, rows, codeFrom: 12, codeTo: 12 + items.length };
}

function ppeTable(P: PpeInspection[], m: MasterCtx): Table {
  const items = m.ppeItems.filter((p) => p.active);
  const head = ['วันที่', 'เดือน', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'ตำแหน่ง', 'ทะเบียนรถ', 'ผู้ตรวจ D-Man',
    ...items.map((p) => p.name), 'จำนวนมี', 'จำนวนไม่มี', 'จำนวนกรอก', 'ผลตรวจ'];
  const rows = P.map((r) => [
    r.inspect_date, r.month, m.codeOf(r.employee_id), m.nameOf(r.employee_id),
    m.employees.find((e) => e.id === r.employee_id)?.role ?? '', r.plate, m.nameOf(r.inspector_id),
    ...items.map((p) => r.results?.[p.code] ?? ''),
    r.have_count, r.missing_count, r.filled_count, r.status,
  ]);
  return { head, rows, codeFrom: 7, codeTo: 7 + items.length };
}

/** 495 → "8:15" */
const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

function workTable(T: TripActivity[], m: MasterCtx): Table {
  const head = ['วันที่', 'เดือน', 'ทะเบียนรถ', 'ประเภทรถ', 'รหัส D-Man', 'ชื่อ D-Man', 'เวลาเริ่มงาน', 'เวลาจบงาน',
    'เวลาทำงาน (นาที)', 'เวลาทำงาน (ชม.:นาที)', 'สถานะ'];
  const rows = [...T].sort((a, b) => a.activity_date.localeCompare(b.activity_date) || a.plate.localeCompare(b.plate, 'th')).map((t) => [
    t.activity_date, t.month, t.plate, m.vehicles.find((v) => v.plate === t.plate)?.type ?? '', m.codeOf(t.dman_id), m.nameOf(t.dman_id),
    t.start_time ?? '', t.end_time ?? '',
    t.work_minutes ?? '', t.work_minutes != null ? hm(t.work_minutes) : '',
    t.work_ended_at ? 'จบงานแล้ว' : 'ยังไม่จบงาน',
  ]);
  return { head, rows, codeFrom: -1, codeTo: -1 };
}

/** 1 row = 1 employee / day: the crew of each vehicle check gets the vehicle's work time that day */
function employeeWorkTable(V: VehicleInspection[], T: TripActivity[], m: MasterCtx): Table {
  const head = ['วันที่', 'เดือน', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'ตำแหน่ง', 'หน้าที่บนรถ', 'ทะเบียนรถ', 'เวลาเริ่มงาน', 'เวลาจบงาน',
    'เวลาทำงาน (นาที)', 'เวลาทำงาน (ชม.:นาที)', 'สถานะ'];
  const roleOf = new Map(m.employees.map((e) => [e.id, e.role]));
  const rows: Cell[][] = [];
  const add = (date: string, id: string, duty: string, plate: string, t: TripActivity | undefined) => rows.push([
    date, date.slice(0, 7), m.codeOf(id), m.nameOf(id), roleOf.get(id) ?? '', duty, plate,
    t?.start_time ?? '', t?.end_time ?? '',
    t?.work_minutes ?? '', t?.work_minutes != null ? hm(t.work_minutes) : '',
    !t ? 'ยังไม่เริ่มงาน' : t.work_ended_at ? 'จบงานแล้ว' : 'ยังไม่จบงาน',
  ]);
  const seen = new Set<string>();
  for (const c of V) {
    const t = T.find((x) => x.activity_date === c.inspect_date && x.plate === c.plate);
    if (t) seen.add(t.id);
    add(c.inspect_date, c.dman_id, 'D-Man', c.plate, t);
    if (c.helper1_id) add(c.inspect_date, c.helper1_id, 'Helper 1', c.plate, t);
    if (c.helper2_id) add(c.inspect_date, c.helper2_id, 'Helper 2', c.plate, t);
  }
  // a work record whose vehicle check is gone: its D-Man only
  for (const t of T) if (!seen.has(t.id)) add(t.activity_date, t.dman_id, 'D-Man', t.plate, t);
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[6]).localeCompare(String(b[6]), 'th') || String(a[5]).localeCompare(String(b[5])));
  return { head, rows, codeFrom: -1, codeTo: -1 };
}

const STATUS_TEXT: Record<StoreVisitReportRow['status'], string> = { done: 'ส่งสำเร็จ', failed: 'ส่งไม่สำเร็จ', open: 'กำลังส่ง', none: 'ยังไม่ส่ง' };
const METHOD_TEXT: Record<string, string> = { trolley: 'รถเข็น', carry: 'ยก / แบก', both: 'ทั้งสองแบบ' };

function storeTable(S: StoreVisitReportRow[]): Table {
  const head = ['วันที่', 'เดือน', 'ทะเบียนรถ', 'ชื่อ D-Man', 'รหัสร้าน', 'ชื่อร้าน', 'ประเภทร้าน', 'จำนวนบิล', 'ลังตามแผน',
    'สถานะการส่ง', 'เวลาจอด', 'เวลาออก', 'เวลาที่ร้าน (นาที)', 'ลังที่ส่ง', 'นาที/ลัง', 'SKU', 'ระยะทาง (ม.)', 'วิธีขนย้าย', 'หมายเหตุ', 'บันทึกโดย'];
  const rows = [...S].sort((a, b) => a.plan_date.localeCompare(b.plan_date) || a.plate.localeCompare(b.plate, 'th')
    || (a.started_at ?? '9').localeCompare(b.started_at ?? '9') || a.sort_order - b.sort_order).map((r) => {
    const min = r.seconds != null ? Number((r.seconds / 60).toFixed(1)) : '';
    return [
      r.plan_date, r.plan_date.slice(0, 7), r.plate, r.dman_name ?? '', r.sap_code, r.store_name, r.store_type, r.bills, r.plan_cases ?? '',
      STATUS_TEXT[r.status], r.started_at ? hhmm(r.started_at) : '', r.ended_at ? hhmm(r.ended_at) : '', min,
      r.status === 'done' ? (r.cases ?? '') : '', r.status === 'done' && r.seconds != null && r.cases ? (r.seconds / 60 / r.cases).toFixed(2) : '',
      r.skus ?? '', r.distance_m ?? '', r.move_method ? METHOD_TEXT[r.move_method] : '', r.note, r.by_name ?? '',
    ];
  });
  return { head, rows, codeFrom: -1, codeTo: -1 };
}

function DataTable({ t, month }: { t: Table; month: string }) {
  if (!t.rows.length) return <div className="empty">ยังไม่มีบันทึกในเดือน {month}</div>;
  return (
    <div className="dt-wrap tbl">
      <table className="dt">
        <thead><tr>{t.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {t.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, i) => (
                <td key={i} className={i >= t.codeFrom && i < t.codeTo ? `c${c}` : typeof c === 'number' ? 'num' : ''}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Tab = 'car' | 'ppe' | 'work' | 'store';
const TABS: { key: Tab; title: string; note: string }[] = [
  { key: 'car', title: 'DATA รถ', note: '1 แถว = รถ 1 คัน / วัน · 1 = ผ่าน, 2 = ไม่ผ่าน, 3 = ไม่เกี่ยวข้อง' },
  { key: 'ppe', title: 'DATA PPE', note: '1 แถว = พนักงาน 1 คน / วัน · 1 = มี, 2 = ไม่มี, 3 = ไม่เกี่ยวข้อง' },
  { key: 'work', title: 'DATA เวลาทำงาน', note: '1 แถว = รถ 1 คัน / วัน · เวลาเริ่ม–จบงานจากเซิร์ฟเวอร์' },
  { key: 'store', title: 'DATA ร้านค้า', note: '1 แถว = ร้าน 1 ร้านในแผนส่ง / วัน · แผนส่ง + สถานะและเวลาที่ร้าน (เวลาจากเซิร์ฟเวอร์)' },
];
const TAB_KEY = 'admin-data-tab';
const readTab = (): Tab => { try { const t = localStorage.getItem(TAB_KEY) as Tab | null; return t && TABS.some((x) => x.key === t) ? t : 'car'; } catch { return 'car'; } };
const lastDay = (month: string) => { const d = new Date(`${month}-01T00:00`); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toLocaleDateString('sv-SE'); };

/** one table of a tab; the first one takes the tab's own title / note */
interface Part { key?: string; title?: string; note?: string; table: Table }

/** the open tab's tables for the month (only that tab is read) */
function useTabData(tab: Tab, month: string, reloadKey: number) {
  const master = useMaster();
  const [state, setState] = useState<{ key: string; tables: Part[] | null; error: string }>({ key: '', tables: null, error: '' });
  const key = `${tab}|${month}`;
  useEffect(() => {
    let alive = true;
    setState({ key, tables: null, error: '' });
    const load = async (): Promise<Part[]> => {
      if (tab === 'car') return [{ table: vehicleTable(await listVehicleInspections({ month }), master) }];
      if (tab === 'ppe') return [{ table: ppeTable(await listPpeInspections({ month }), master) }];
      if (tab === 'work') {
        const [trips, veh] = await Promise.all([listTripActivities({ month }), listVehicleInspections({ month })]);
        return [
          { table: workTable(trips, master) },
          { key: 'work-employee', title: 'เวลาทำงานของพนักงาน', note: '1 แถว = พนักงาน 1 คน / วัน · D-Man และ Helper ของรถคันนั้นได้เวลาทำงานเท่ากับรถ (นับแบบเดียวกับ "ชั่วโมงรวม" ในหน้าสรุป)', table: employeeWorkTable(veh, trips, master) },
        ];
      }
      return [{ table: storeTable(await listStoreVisitReport(`${month}-01`, lastDay(month))) }];
    };
    load().then((tables) => { if (alive) setState({ key, tables, error: '' }); })
      .catch((e) => { if (alive) setState({ key, tables: null, error: errMsg(e) }); });
    return () => { alive = false; };
  }, [key, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? state : { key, tables: null, error: '' };
}

export function DataPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const tabs = TABS.filter((t) => t.key !== 'store' || (FEATURES.storeDelivery && FEATURES.storeTimer));
  const [tab, setTabRaw] = useState<Tab>(() => { const t = readTab(); return tabs.some((x) => x.key === t) ? t : 'car'; });
  const setTab = (t: Tab) => { setTabRaw(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ } };
  const cur = tabs.find((t) => t.key === tab) ?? tabs[0];
  // "รีเฟรช": read the open tab again
  const [reloadKey, setReloadKey] = useState(0);
  const { tables, error } = useTabData(cur.key, month, reloadKey);

  return (
    <>
      <section className="panel">
        <div className="row spread">
          <div>
            <h2 className="flush">ตารางข้อมูล</h2>
            <span className="note">ข้อมูลดิบรายเดือน · เลือกแท็บแล้วดาวน์โหลด CSV ไปใช้ต่อใน Excel ได้</span>
          </div>
          <div className="row">
            <label className="month-pick">เดือน<input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
            <RefreshButton onRefresh={() => setReloadKey((k) => k + 1)} />
          </div>
        </div>
        <div className="dt-tabs" role="tablist" aria-label="ตารางข้อมูล">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={t.key === cur.key} onClick={() => setTab(t.key)}>{t.title}</button>
          ))}
        </div>
      </section>
      {(error || !tables) && (
        <section className="panel" role="tabpanel" aria-label={cur.title}>
          <h2 className="flush">{cur.title}</h2>
          {error && <div className="error">โหลดข้อมูลไม่สำเร็จ: {error}</div>}
          {!tables && !error && <div className="empty">กำลังโหลด…</div>}
        </section>
      )}
      {tables?.map((part, i) => {
        const k = part.key ?? cur.key;
        const title = part.title ?? cur.title;
        return (
          <section key={k} className="panel" role={i === 0 ? 'tabpanel' : undefined} aria-label={title}>
            <div className="row spread head-row">
              <div>
                <h2 className="flush">{title} <span className="note mono">{part.table.rows.length} แถว</span></h2>
                <span className="note">{part.note ?? cur.note}</span>
              </div>
              <button className="btn ghost sm" disabled={!part.table.rows.length}
                onClick={() => downloadText(`data-${k}_${month}.csv`, toCsv([part.table.head, ...part.table.rows]))}>
                ดาวน์โหลด CSV
              </button>
            </div>
            <DataTable t={part.table} month={month} />
          </section>
        );
      })}
    </>
  );
}
