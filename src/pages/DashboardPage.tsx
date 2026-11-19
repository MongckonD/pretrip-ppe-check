/**
 * Admin "ภาพรวม" (/admin/overview): the month at a glance, compared with the month before.
 *   KPIs with change vs last month · daily trend (pass / fail, % PPE ครบ) · items that fail most ·
 *   vehicles to watch · PPE items missing most (+ who) · average work hours per vehicle · approval health.
 * Details live in the other tabs (สถานะรถ, PPE, สรุป); the "ดูรายละเอียด" buttons go there.
 */
import { useEffect, useMemo, useState } from 'react';
import { BarChart, LineChart } from '../components/Charts';
import { useMaster } from '../components/MasterContext';
import { listPpeInspections, listTripActivities, listVehicleInspections } from '../lib/api';
import type { PpeInspection, TripActivity, VehicleInspection } from '../lib/types';
import { daysInMonth, errMsg, today } from '../lib/utils';

interface Month { veh: VehicleInspection[]; ppe: PpeInspection[]; trips: TripActivity[] }

const prevMonth = (m: string) => { const d = new Date(`${m}-01T00:00`); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString('sv-SE').slice(0, 7); };
const nextMonth = (m: string) => { const d = new Date(`${m}-01T00:00`); d.setMonth(d.getMonth() + 1); return d.toLocaleDateString('sv-SE').slice(0, 7); };
const thMonth = (m: string) => new Date(`${m}-01T00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
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
    rejected: d.veh.filter((r) => r.rejected_at).length,
    approved: d.veh.filter((r) => r.approved_at).length,
  };
}

export function DashboardPage({ month, setMonth, go }: { month: string; setMonth: (m: string) => void; go?: (tab: string) => void }) {
  const { checkItems, ppeItems, nameOf } = useMaster();
  const [cur, setCur] = useState<Month | null>(null);
  const [prev, setPrev] = useState<Month | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setCur(null); setPrev(null); setError('');
    Promise.all([loadMonth(month), loadMonth(prevMonth(month))])
      .then(([a, b]) => { if (alive) { setCur(a); setPrev(b); } })
      .catch((e) => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [month]);

  const s = useMemo(() => (cur ? stats(cur) : null), [cur]);
  const p = useMemo(() => (prev ? stats(prev) : null), [prev]);

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
      .slice(0, 5).map(([k, n]) => ({ label: itemName.get(k) ?? `ข้อ ${k}`, n }));
    const failPlates = count(cur.veh.filter((r) => r.fail_count), (r) => [r.plate]).slice(0, 5).map(([k, n]) => ({ label: k, n }));
    const ppeMissing = count(cur.ppe, (q) => Object.entries(q.results ?? {}).filter(([, v]) => v === 2).map(([k]) => k))
      .slice(0, 5).map(([k, n]) => ({ label: ppeName.get(k) ?? k, n }));
    const ppePeople = count(cur.ppe.filter((q) => q.missing_count > 0), (q) => [q.employee_id]).slice(0, 3).map(([k, n]) => `${nameOf(k)} (${n})`);
    const perPlate = new Map<string, { min: number; days: number }>();
    for (const t of cur.trips) {
      if (!t.work_ended_at) continue;
      const x = perPlate.get(t.plate) ?? { min: 0, days: 0 };
      x.min += t.work_minutes ?? 0; x.days++;
      perPlate.set(t.plate, x);
    }
    const hours = [...perPlate.entries()].map(([k, x]) => ({ label: k, n: x.min / x.days, days: x.days })).sort((a, b) => b.n - a.n);
    // time from the check to the admin's approval
    const waits = cur.veh.filter((r) => r.approved_at && r.inspect_time)
      .map((r) => (Date.parse(r.approved_at as string) - Date.parse(`${r.inspect_date}T${r.inspect_time}+07:00`)) / 60_000)
      .filter((m) => m >= 0);
    const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
    return { failItems, failPlates, ppeMissing, ppePeople, hours, avgWait };
  }, [cur, checkItems, ppeItems, nameOf]);

  return (
    <>
      <section className="panel ov-head">
        <div className="row spread">
          <div><b>ภาพรวมประจำเดือน</b> <span className="note">· เทียบกับ{thMonth(prevMonth(month))}</span></div>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => setMonth(prevMonth(month))} aria-label="เดือนก่อน">‹</button>
            <input type="month" aria-label="เดือน" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <button type="button" className="btn ghost sm" disabled={month >= today().slice(0, 7)} onClick={() => setMonth(nextMonth(month))} aria-label="เดือนถัดไป">›</button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      {!s && !error && <div className="empty">กำลังโหลด…</div>}
      {s && p && prev && !prev.veh.length && (
        <p className="note ov-noprev">{thMonth(prevMonth(month))} ไม่มีข้อมูล จึงยังเทียบกับเดือนก่อนไม่ได้</p>
      )}
      {s && p && (
        <div className="ov-kpis">
          <Kpi label="รถผ่านการตรวจ" value={s.passPct === null ? '–' : `${s.passPct}%`} delta={diff(s.passPct, p.passPct, '%')} good={up(s.passPct, p.passPct)} />
          <Kpi label="ครั้งที่รถไม่ผ่าน" value={String(s.failCount)}
            delta={prev?.veh.length ? diff(s.failCount, p.failCount, ' ครั้ง') : null} good={up(p.failCount, s.failCount)} />
          <Kpi label="PPE ครบ" value={s.ppePct === null ? '–' : `${s.ppePct}%`} delta={diff(s.ppePct, p.ppePct, '%')} good={up(s.ppePct, p.ppePct)} />
          <Kpi label="รถออกงานเฉลี่ย/วัน" value={s.vehPerDay === null ? '–' : `${s.vehPerDay} คัน`} delta={diff(s.vehPerDay, p.vehPerDay, '')} good={null} />
          <Kpi label="ชั่วโมงทำงานเฉลี่ย/วัน (ต่อคัน)" value={s.avgMin === null ? '–' : hm(s.avgMin)}
            delta={s.avgMin === null || p.avgMin === null ? null : `${s.avgMin >= p.avgMin ? '▲' : '▼'} ${hm(Math.abs(s.avgMin - p.avgMin))}`} good={null} />
          <Kpi label="อนุมัติแล้ว" value={s.approvedPct === null ? '–' : `${s.approvedPct}%`} delta={`ค้าง ${s.pending} คัน`} good={null} plain />
        </div>
      )}

      {trend && cur && (
        <div className="two ov-two">
          <section className="panel"><h2>รถผ่าน / ไม่ผ่าน รายวัน</h2>
            <BarChart labels={trend.labels} every={trend.labels.length > 16 ? 2 : 1} series={[
              { name: 'ผ่าน', color: 'var(--pass)', vals: trend.pass },
              { name: 'ไม่ผ่าน', color: 'var(--fail)', vals: trend.fail },
            ]} />
          </section>
          <section className="panel"><h2>% PPE ครบ รายวัน</h2>
            <LineChart labels={trend.labels} series={[{ name: 'PPE ครบ (%)', color: '#6B46C1', vals: trend.ppe }]} />
          </section>
        </div>
      )}

      {ranks && (
        <div className="two ov-two">
          <Rank title="ข้อที่ไม่ผ่านบ่อย" rows={ranks.failItems} color="var(--fail)" empty="เดือนนี้ไม่มีข้อที่ไม่ผ่าน"
            more={go && (() => go('vs'))} />
          <Rank title="รถที่ต้องดูแล" sub="ไม่ผ่านบ่อยสุด (ครั้ง)" rows={ranks.failPlates} color="#BA7517" empty="ไม่มีรถที่ไม่ผ่าน"
            more={go && (() => go('vs'))} />
        </div>
      )}
      {ranks && (
        <div className="two ov-two">
          <Rank title="PPE ที่ขาดบ่อย" rows={ranks.ppeMissing} color="#6B46C1" empty="เดือนนี้ไม่มีใครขาด PPE"
            foot={ranks.ppePeople.length ? `คนที่ขาดบ่อย: ${ranks.ppePeople.join(', ')}` : undefined} more={go && (() => go('ppe'))} />
          <Rank title="ชั่วโมงทำงานเฉลี่ย/วัน รายคัน" rows={ranks.hours.map((h) => ({ label: h.label, n: h.n, text: hm(h.n), sub: `${h.days} วัน` }))}
            color="var(--pass)" empty="ยังไม่มีวันที่จบงาน" more={go && (() => go('sum'))} />
        </div>
      )}

      {s && ranks && (
        <section className="panel ov-approve">
          <div>
            <h2 className="flush">การอนุมัติการตรวจรถ</h2>
            <span className="note">{ranks.avgWait === null ? 'ยังไม่มีรถที่อนุมัติ'
              : `จากตรวจรถจนอนุมัติ ใช้เวลาเฉลี่ย ${Math.floor(ranks.avgWait / 60)} ชม. ${Math.round(ranks.avgWait % 60)} นาที`}</span>
          </div>
          <div className="row">
            <span className="pill w">รออนุมัติ {s.pending}</span>
            <span className="pill f">ไม่อนุมัติ {s.rejected}</span>
            <span className="pill p">อนุมัติแล้ว {s.approved}</span>
            {go && <button type="button" className="btn ghost sm" onClick={() => go('vs')}>ไปหน้าสถานะรถ ›</button>}
          </div>
        </section>
      )}
    </>
  );
}

/** "▲ 3.1%" — the change from last month (null when either month has no data) */
function diff(a: number | null, b: number | null, unit: string) {
  if (a === null || b === null) return null;
  const d = Math.round((a - b) * 10) / 10;
  return `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}${unit}`;
}
/** true when the change is an improvement (a should be ≥ b) */
const up = (a: number | null, b: number | null) => (a === null || b === null || a === b ? null : a > b);

function Kpi({ label, value, delta, good, plain }: { label: string; value: string; delta: string | null; good: boolean | null; plain?: boolean }) {
  return (
    <div className="ov-kpi">
      <span>{label}</span>
      <b>{value}</b>
      {delta && <em className={plain || good === null ? '' : good ? 'good' : 'bad'}>{delta}{plain ? '' : ' จากเดือนก่อน'}</em>}
    </div>
  );
}

function Rank({ title, sub, rows, color, empty, foot, more }: {
  title: string; sub?: string; rows: { label: string; n: number; text?: string; sub?: string }[]; color: string; empty: string;
  foot?: string; more?: () => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="panel ov-rank">
      <div className="row spread"><h2 className="flush">{title}{sub && <span className="note"> · {sub}</span>}</h2>
        {more && <button type="button" className="btn ghost sm" onClick={more}>ดูรายละเอียด ›</button>}</div>
      {!rows.length ? <div className="empty">{empty}</div> : (
        <ul>
          {rows.map((r) => (
            <li key={r.label}>
              <span className="ov-label" title={r.label}>{r.label}</span>
              <span className="ov-bar"><i style={{ width: `${(r.n / max) * 100}%`, background: color }} /></span>
              <b className="mono">{r.text ?? r.n}</b>
              {r.sub && <span className="note ov-sub">{r.sub}</span>}
            </li>
          ))}
        </ul>
      )}
      {foot && <p className="note flush-note">{foot}</p>}
    </section>
  );
}
