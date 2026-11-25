/**
 * Admin "ภาพรวม" (/admin/overview): the chosen month at a glance (no comparison with other months).
 *   KPIs · daily trend (pass / fail, % PPE ครบ) · items that fail most ·
 *   vehicles to watch · PPE items missing most (+ who) · average work hours per vehicle.
 * Details live in the other tabs (สถานะรถ, PPE, สรุป). Every box has its own CSV download (opens in Excel)
 * with the RECORDS behind the numbers — plate, date, people (code + name), failed items, missing PPE — not only counts.
 */
import { RefreshButton } from '../components/RefreshButton';
import { useEffect, useMemo, useState } from 'react';
import { BarChart, PctBarChart } from '../components/Charts';
import { useMaster } from '../components/MasterContext';
import { listPpeInspections, listTripActivities, listVehicleInspections } from '../lib/api';
import type { PpeInspection, TripActivity, VehicleInspection } from '../lib/types';
import { daysInMonth, downloadText, errMsg, toCsv, today } from '../lib/utils';
import { DownloadIcon } from '../components/Icons';

interface Month { veh: VehicleInspection[]; ppe: PpeInspection[]; trips: TripActivity[] }

const prevMonth = (m: string) => { const d = new Date(`${m}-01T00:00`); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString('sv-SE').slice(0, 7); };
const nextMonth = (m: string) => { const d = new Date(`${m}-01T00:00`); d.setMonth(d.getMonth() + 1); return d.toLocaleDateString('sv-SE').slice(0, 7); };
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min) % 60).padStart(2, '0')}`;
const pct1 = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

async function loadMonth(m: string): Promise<Month> {
  const [veh, ppe, trips] = await Promise.all([listVehicleInspections({ month: m }), listPpeInspections({ month: m }), listTripActivities({ month: m })]);
  return { veh, ppe, trips };
}

/** the headline numbers of one month */
function stats(d: Month) {
  const checks = d.veh.length;
  const pass = d.veh.filter((r) => !r.fail_count).length;
  const days = new Set(d.veh.map((r) => r.inspect_date)).size;
  const ended = d.trips.filter((t) => t.work_ended_at);
  const ppeOk = d.ppe.filter((p) => p.status === 'ครบ').length;
  return {
    passPct: pct1(pass, checks),
    failCount: checks - pass,
    ppePct: pct1(ppeOk, d.ppe.length),
    vehPerDay: days ? Math.round((checks / days) * 10) / 10 : null,
    avgMin: ended.length ? ended.reduce((s, t) => s + (t.work_minutes ?? 0), 0) / ended.length : null,
    approvedPct: pct1(d.veh.filter((r) => r.approved_at).length, checks),
    pending: d.veh.filter((r) => !r.approved_at && !r.rejected_at).length,
  };
}

export function DashboardPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { checkItems, ppeItems, nameOf, codeOf } = useMaster();
  const [cur, setCur] = useState<Month | null>(null);
  const [error, setError] = useState('');

  // only the chosen month is loaded (no previous month: half the D1 reads); "รีเฟรช" bumps reloadKey
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!reloadKey) setCur(null); // a refresh keeps the charts on screen until the new data is in
    setError('');
    loadMonth(month)
      .then((a) => { if (alive) setCur(a); })
      .catch((e) => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [month, reloadKey]);

  const s = useMemo(() => (cur ? stats(cur) : null), [cur]);

  /* daily trend */
  const trend = useMemo(() => {
    if (!cur) return null;
    const days = daysInMonth(month).filter((d) => d <= today());
    return {
      labels: days.map((d) => String(Number(d.slice(8)))),
      pass: days.map((d) => cur.veh.filter((r) => r.inspect_date === d && !r.fail_count).length),
      fail: days.map((d) => cur.veh.filter((r) => r.inspect_date === d && r.fail_count).length),
      ppe: days.map((d) => { const x = cur.ppe.filter((q) => q.inspect_date === d); return x.length ? pct1(x.filter((q) => q.status === 'ครบ').length, x.length) : null; }),
    };
  }, [cur, month]);

  /* rankings */
  const ranks = useMemo(() => {
    if (!cur) return null;
    const count = <T,>(list: T[], key: (x: T) => string[]) => {
      const m = new Map<string, number>();
      for (const x of list) for (const k of key(x)) m.set(k, (m.get(k) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const itemName = new Map(checkItems.map((i) => [String(i.item_no), i.name]));
    const ppeName = new Map(ppeItems.map((i) => [i.code, i.name]));
    const failItems = count(cur.veh, (r) => Object.entries(r.results ?? {}).filter(([, v]) => v === 2).map(([k]) => k))
      .map(([k, n]) => ({ label: itemName.get(k) ?? `ข้อ ${k}`, n }));
    const failPlates = count(cur.veh.filter((r) => r.fail_count), (r) => [r.plate]).map(([k, n]) => ({ label: k, n }));
    const ppeMissing = count(cur.ppe, (q) => Object.entries(q.results ?? {}).filter(([, v]) => v === 2).map(([k]) => k))
      .map(([k, n]) => ({ label: ppeName.get(k) ?? k, n }));
    const perPlate = new Map<string, { min: number; days: number }>();
    for (const t of cur.trips) {
      if (!t.work_ended_at) continue;
      const x = perPlate.get(t.plate) ?? { min: 0, days: 0 };
      x.min += t.work_minutes ?? 0; x.days++;
      perPlate.set(t.plate, x);
    }
    const hours = [...perPlate.entries()].map(([k, x]) => ({ label: k, n: x.min / x.days, days: x.days })).sort((a, b) => b.n - a.n);
    return { failItems, failPlates, ppeMissing, hours };
  }, [cur, checkItems, ppeItems]);

  /** CSV that opens in Excel: overview-2026-11-<name>.csv */
  const dl = (name: string, rows: (string | number)[][]) => downloadText(`overview-${month}-${name}.csv`, toCsv(rows));

  /* ---- the records behind each box (one row per check / person / failure) ---- */
  const itemName = (k: string) => checkItems.find((i) => String(i.item_no) === k)?.name ?? `ข้อ ${k}`;
  const ppeName = (k: string) => ppeItems.find((i) => i.code === k)?.name ?? k;
  const person = (id?: string | null) => (id ? [codeOf(id), nameOf(id)] : ['', '']);
  const failed = (r: VehicleInspection) => Object.entries(r.results ?? {}).filter(([, v]) => v === 2).map(([k]) => k);
  const defectNote = (r: VehicleInspection, k: string) => r.defects?.[k]?.note ?? '';
  const approval = (r: VehicleInspection) => (r.approved_at ? 'อนุมัติแล้ว' : r.rejected_at ? 'ไม่อนุมัติ' : 'รออนุมัติ');
  const byDate = <T extends { inspect_date: string; plate: string }>(a: T, b: T) => a.inspect_date.localeCompare(b.inspect_date) || a.plate.localeCompare(b.plate);
  const crewHead = ['รหัส D-Man', 'D-Man', 'รหัส Helper 1', 'Helper 1', 'รหัส Helper 2', 'Helper 2'];
  const crew = (r: VehicleInspection) => [...person(r.dman_id), ...person(r.helper1_id), ...person(r.helper2_id)];

  /** every vehicle check of the month */
  const checksCsv = () => cur && dl('vehicle-checks', [
    ['วันที่', 'เวลา', 'ทะเบียนรถ', 'ผลตรวจ', 'ข้อที่ไม่ผ่าน', 'หมายเหตุข้อบกพร่อง', ...crewHead, 'สถานะอนุมัติ', 'เหตุผลไม่อนุมัติ'],
    ...[...cur.veh].sort(byDate).map((r) => {
      const f = failed(r);
      return [r.inspect_date, (r.inspect_time ?? '').slice(0, 5), r.plate, f.length ? 'ไม่ผ่าน' : 'ผ่าน',
        f.map(itemName).join('; '), f.map((k) => defectNote(r, k)).filter(Boolean).join('; '),
        ...crew(r), approval(r), r.reject_reason ?? ''];
    }),
  ]);
  /** every PPE sheet of the month */
  const ppeCsv = () => cur && dl('ppe-checks', [
    ['วันที่', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'ทะเบียนรถ', 'ผล', 'อุปกรณ์ที่ขาด', 'รหัสผู้ตรวจ', 'ผู้ตรวจ (D-Man)'],
    ...[...cur.ppe].sort(byDate).map((q) => [q.inspect_date, ...person(q.employee_id), q.plate, q.status,
      Object.entries(q.results ?? {}).filter(([, v]) => v === 2).map(([k]) => ppeName(k)).join('; '), ...person(q.inspector_id)]),
  ]);
  /** one row per failed item, most frequent item first */
  const failItemsCsv = () => {
    if (!cur || !ranks) return;
    const order = new Map(ranks.failItems.map((x, i) => [x.label, i]));
    const rows = cur.veh.flatMap((r) => failed(r).map((k) => ({ r, k, name: itemName(k) })))
      .sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99) || byDate(a.r, b.r));
    dl('fail-items', [['ข้อตรวจ', 'วันที่', 'ทะเบียนรถ', 'หมายเหตุข้อบกพร่อง', ...crewHead, 'สถานะอนุมัติ'],
      ...rows.map(({ r, k, name }) => [name, r.inspect_date, r.plate, defectNote(r, k), ...crew(r), approval(r)])]);
  };
  /** one row per missing PPE item per person, most often missing first */
  const ppeMissingCsv = () => {
    if (!cur || !ranks) return;
    const order = new Map(ranks.ppeMissing.map((x, i) => [x.label, i]));
    const rows = cur.ppe.flatMap((q) => Object.entries(q.results ?? {}).filter(([, v]) => v === 2).map(([k]) => ({ q, name: ppeName(k) })))
      .sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99) || byDate(a.q, b.q));
    dl('ppe-missing', [['อุปกรณ์ที่ขาด', 'วันที่', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'ทะเบียนรถ', 'รหัสผู้ตรวจ', 'ผู้ตรวจ (D-Man)'],
      ...rows.map(({ q, name }) => [name, q.inspect_date, ...person(q.employee_id), q.plate, ...person(q.inspector_id)])]);
  };
  /** every failed check, the vehicle that fails most first */
  const vehiclesCsv = () => {
    if (!cur || !ranks) return;
    const order = new Map(ranks.failPlates.map((x, i) => [x.label, i]));
    const rows = cur.veh.filter((r) => r.fail_count).sort((a, b) => (order.get(a.plate) ?? 99) - (order.get(b.plate) ?? 99) || byDate(a, b));
    dl('vehicles-to-watch', [['ทะเบียนรถ', 'ไม่ผ่านทั้งเดือน (ครั้ง)', 'วันที่', 'ข้อที่ไม่ผ่าน', 'หมายเหตุข้อบกพร่อง', ...crewHead, 'สถานะอนุมัติ'],
      ...rows.map((r) => [r.plate, ranks.failPlates.find((x) => x.label === r.plate)?.n ?? '', r.inspect_date,
        failed(r).map(itemName).join('; '), failed(r).map((k) => defectNote(r, k)).filter(Boolean).join('; '), ...crew(r), approval(r)])]);
  };
  /** every finished work day, with the crew from that day's vehicle check */
  const hoursCsv = () => {
    if (!cur) return;
    const rows = cur.trips.filter((t) => t.work_ended_at)
      .sort((a, b) => a.plate.localeCompare(b.plate) || a.activity_date.localeCompare(b.activity_date));
    dl('work-hours', [['ทะเบียนรถ', 'วันที่', 'เริ่ม', 'จบ', 'เวลาทำงาน (ชม:นาที)', 'นาที', ...crewHead],
      ...rows.map((t) => {
        const c = cur.veh.find((r) => r.inspect_date === t.activity_date && r.plate === t.plate);
        return [t.plate, t.activity_date, t.start_time, t.end_time ?? '', hm(t.work_minutes ?? 0), t.work_minutes ?? 0,
          ...(c ? crew(c) : [...person(t.dman_id), '', '', '', ''])];
      })]);
  };

  return (
    <>
      <section className="panel ov-head">
        <div className="row spread">
          <div><b>ภาพรวมประจำเดือน</b></div>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => setMonth(prevMonth(month))} aria-label="เดือนก่อน">‹</button>
            <input type="month" aria-label="เดือน" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <button type="button" className="btn ghost sm" disabled={month >= today().slice(0, 7)} onClick={() => setMonth(nextMonth(month))} aria-label="เดือนถัดไป">›</button>
            <RefreshButton onRefresh={() => setReloadKey((k) => k + 1)} />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      {!s && !error && <div className="empty">กำลังโหลด…</div>}
      {s && (
        <div className="ov-kpis-wrap">
        <div className="row ov-dl-row">
          <DlBtn onClick={() => dl('summary', [
            ['หัวข้อ', 'ค่า'],
            ['รถผ่านการตรวจ (%)', s.passPct ?? ''], ['ครั้งที่รถไม่ผ่าน', s.failCount], ['PPE ครบ (%)', s.ppePct ?? ''],
            ['รถออกงานเฉลี่ย/วัน (คัน)', s.vehPerDay ?? ''], ['ชั่วโมงทำงานเฉลี่ย/วัน ต่อคัน (ชม:นาที)', s.avgMin === null ? '' : hm(s.avgMin)],
            ['อนุมัติแล้ว (%)', s.approvedPct ?? ''], ['ค้างอนุมัติ (คัน)', s.pending],
          ])} label="ตัวเลขสรุป" />
          {cur && cur.veh.length > 0 && <DlBtn onClick={checksCsv} label="รายการตรวจรถทั้งเดือน" />}
          {cur && cur.ppe.length > 0 && <DlBtn onClick={ppeCsv} label="รายการ PPE ทั้งเดือน" />}
        </div>
        <div className="ov-kpis">
          <Kpi label="รถผ่านการตรวจ" value={s.passPct === null ? '–' : `${s.passPct}%`} />
          <Kpi label="ครั้งที่รถไม่ผ่าน" value={String(s.failCount)} />
          <Kpi label="PPE ครบ" value={s.ppePct === null ? '–' : `${s.ppePct}%`} />
          <Kpi label="รถออกงานเฉลี่ย/วัน" value={s.vehPerDay === null ? '–' : `${s.vehPerDay} คัน`} />
          <Kpi label="ชั่วโมงทำงานเฉลี่ย/วัน (ต่อคัน)" value={s.avgMin === null ? '–' : hm(s.avgMin)} />
          <Kpi label="อนุมัติแล้ว" value={s.approvedPct === null ? '–' : `${s.approvedPct}%`} note={`ค้าง ${s.pending} คัน`} />
        </div>
        </div>
      )}

      {trend && cur && (
        <div className="two ov-two">
          <section className="panel"><PanelHead title="รถผ่าน / ไม่ผ่าน รายวัน" onDownload={cur.veh.length ? checksCsv : undefined} />
            <BarChart labels={trend.labels} every={trend.labels.length > 16 ? 2 : 1} series={[
              { name: 'ผ่าน', color: 'var(--pass)', vals: trend.pass },
              { name: 'ไม่ผ่าน', color: 'var(--fail)', vals: trend.fail },
            ]} />
          </section>
          <section className="panel"><PanelHead title="% PPE ครบ รายวัน" onDownload={cur.ppe.length ? ppeCsv : undefined} />
            {/* PPE should be complete for everyone: green only at 100%; with ~6 people a day, one missing is ≈ 83% (amber) */}
            <PctBarChart name="PPE ครบ" labels={trend.labels} vals={trend.ppe} good={100} warn={80} />
          </section>
        </div>
      )}

      {ranks && (
        <div className="two ov-two">
          <Rank title="ข้อที่ไม่ผ่านบ่อย" rows={ranks.failItems} show={5} color="var(--fail)" empty="เดือนนี้ไม่มีข้อที่ไม่ผ่าน"
            onDownload={failItemsCsv} />
          <Rank title="PPE ที่ขาดบ่อย" rows={ranks.ppeMissing} show={5} color="#6B46C1" empty="เดือนนี้ไม่มีใครขาด PPE"
            onDownload={ppeMissingCsv} />
        </div>
      )}
      {ranks && (
        <div className="two ov-two">
          <Rank title="รถที่ต้องดูแล" sub="ไม่ผ่านบ่อยสุด (ครั้ง)" rows={ranks.failPlates} show={5} color="#BA7517" empty="ไม่มีรถที่ไม่ผ่าน"
            onDownload={vehiclesCsv} />
          <Rank title="ชั่วโมงทำงานเฉลี่ย/วัน รายคัน" rows={ranks.hours.map((h) => ({ label: h.label, n: h.n, text: hm(h.n), sub: `${h.days} วัน` }))}
            color="var(--pass)" empty="ยังไม่มีวันที่จบงาน"
            onDownload={hoursCsv} />
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="ov-kpi">
      <span>{label}</span>
      <b>{value}</b>
      {note && <em>{note}</em>}
    </div>
  );
}

/** small "⬇ CSV" button */
function DlBtn({ onClick, label = 'CSV' }: { onClick: () => void; label?: string }) {
  return <button type="button" className="btn ghost sm ov-dl" onClick={onClick} title="ดาวน์โหลดเป็นไฟล์ CSV (เปิดใน Excel ได้)"><span className="ii" aria-hidden><DownloadIcon /></span>{label}</button>;
}
function PanelHead({ title, sub, onDownload }: { title: string; sub?: string; onDownload?: () => void }) {
  return (
    <div className="row spread ov-panel-head">
      <h2 className="flush">{title}{sub && <span className="note"> · {sub}</span>}</h2>
      {onDownload && <DlBtn onClick={onDownload} />}
    </div>
  );
}

/** ranking bars; `show` limits the bars on screen, the download has every row */
function Rank({ title, sub, rows, color, empty, show, onDownload }: {
  title: string; sub?: string; rows: { label: string; n: number; text?: string; sub?: string }[]; color: string; empty: string;
  show?: number; onDownload?: () => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="panel ov-rank">
      <PanelHead title={title} sub={sub} onDownload={rows.length ? onDownload : undefined} />
      {!rows.length ? <div className="empty">{empty}</div> : (
        <ul>
          {rows.slice(0, show ?? rows.length).map((r) => (
            <li key={r.label}>
              <span className="ov-label" title={r.label}>{r.label}</span>
              <span className="ov-bar"><i style={{ width: `${(r.n / max) * 100}%`, background: color }} /></span>
              <b className="mono">{r.text ?? r.n}</b>
              {r.sub && <span className="note ov-sub">{r.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
