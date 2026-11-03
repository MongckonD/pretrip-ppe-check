import { useMemo, useState } from 'react';
import { useMaster } from '../components/MasterContext';
import { BarChart, LineChart, type Series } from '../components/Charts';
import { Kpi } from '../components/Fields';
import type { PpeInspection, VehicleInspection } from '../lib/types';
import { daysInMonth, pad2 } from '../lib/utils';
import { useMonthData } from './useMonthData';

function stat(pp: PpeInspection[], vv: VehicleInspection[], totalItems: number) {
  return {
    pc: pp.length,
    ok: pp.filter((r) => r.status === 'ครบ').length,
    miss: pp.reduce((s, r) => s + r.missing_count, 0),
    vc: vv.length,
    vp: vv.filter((r) => !r.fail_count).length,
    vf: vv.filter((r) => r.fail_count > 0).length,
    line: vv.filter((r) => r.photo_status === 1).length,
    inc: vv.filter((r) => r.filled_count < totalItems).length,
  };
}

const short = (s: string) => (s.length > 9 ? s.slice(0, 8) + '…' : s);

export function DashboardPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { activeEmployees, checkItems } = useMaster();
  const { veh: V, ppe: P, loading, error } = useMonthData(month);
  const [q, setQ] = useState('');
  const [person, setPerson] = useState('');
  const totalItems = checkItems.filter((i) => i.active).length;
  const itemName = (no: string) => checkItems.find((i) => String(i.item_no) === no)?.name ?? no;

  const vFail = V.filter((r) => r.fail_count > 0).length;
  const pOk = P.filter((r) => r.status === 'ครบ').length;
  const pct = P.length ? Math.round((pOk / P.length) * 100) : 0;

  const topFails = useMemo(() => {
    const m: Record<string, number> = {};
    V.forEach((r) => Object.entries(r.results ?? {}).forEach(([k, v]) => { if (v === 2) m[k] = (m[k] ?? 0) + 1; }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [V]);

  const team = activeEmployees.map((e) => ({
    e, ...stat(P.filter((r) => r.employee_id === e.id), V.filter((r) => r.dman_id === e.id), totalItems),
  }));
  const ql = q.trim().toLowerCase();
  const shownTeam = team.filter((t) => !ql || `${t.e.id} ${t.e.name} ${t.e.role}`.toLowerCase().includes(ql));

  const pid = person || activeEmployees[0]?.id || '';
  const pName = activeEmployees.find((e) => e.id === pid)?.name || pid;
  const pp = P.filter((r) => r.employee_id === pid);
  const vv = V.filter((r) => r.dman_id === pid);
  const ps = stat(pp, vv, totalItems);

  const days = daysInMonth(month);
  const dl = days.map((d) => String(+d.slice(8)));
  const perDay = days.map((d) => {
    const a = pp.filter((r) => r.inspect_date === d), b = vv.filter((r) => r.inspect_date === d);
    return {
      d, ...stat(a, b, totalItems),
      itemFails: b.reduce((s, r) => s + r.fail_count, 0),
      failItems: b.flatMap((r) => Object.entries(r.results ?? {}).filter(([, v]) => v === 2).map(([k]) => itemName(k))),
    };
  });

  const ppeSeries: Series[] = [
    { name: 'PPE ตรวจ', color: 'var(--s1)', vals: perDay.map((x) => (x.pc ? x.pc : null)) },
    { name: 'PPE ครบ', color: 'var(--s2)', vals: perDay.map((x) => (x.pc ? x.ok : null)) },
    { name: 'PPE ไม่มี', color: 'var(--s3)', vals: perDay.map((x) => (x.pc ? x.miss : null)) },
  ];
  const mx = topFails[0]?.[1] ?? 1;

  return (
    <>
      <section className="panel">
        <div className="row spread head-row">
          <h2>ภาพรวมประจำเดือน</h2>
          <label className="month-pick">เดือน<input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        </div>
        {error && <div className="error">โหลดข้อมูลไม่สำเร็จ: {error}</div>}
        <div className={`kpis${loading ? ' loading' : ''}`}>
          <Kpi value={V.length} label="ครั้งที่ตรวจรถ" />
          <Kpi value={vFail} label="ครั้งที่พบรถไม่ผ่าน" tone={vFail ? 'bad' : 'good'} />
          <Kpi value={P.length} label="ครั้งที่ตรวจ PPE" />
          <Kpi value={P.length ? `${pct}%` : '–'} label="PPE ครบ" tone={P.length && pct < 100 ? 'bad' : 'good'} />
        </div>
      </section>

      <div className="two">
        <section className="panel">
          <div className="row spread head-row">
            <h2>สรุปรายคน</h2>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ รหัส หรือตำแหน่ง"
              aria-label="ค้นหาพนักงาน" className="search" />
          </div>
          {V.length || P.length ? (
            <>
              <div className="tbl">
                <table>
                  <thead><tr>
                    <th>พนักงาน</th><th className="num">PPE ตรวจ</th><th className="num">ครบ</th><th className="num">ไม่มี</th>
                    <th className="num">รถตรวจ</th><th className="num">ไม่ผ่าน</th><th className="num">ภาพครบ</th><th className="num">ไม่ครบ</th>
                  </tr></thead>
                  <tbody>
                    {shownTeam.map((t) => (
                      <tr key={t.e.id} className={`pick${t.e.id === pid ? ' sel' : ''}`} onClick={() => setPerson(t.e.id)}>
                        <td>{t.e.name || t.e.id}</td><td className="num">{t.pc}</td><td className="num">{t.ok}</td>
                        <td className="num">{t.miss}</td><td className="num">{t.vc}</td><td className="num">{t.vf}</td>
                        <td className="num">{t.line}</td><td className="num">{t.inc}</td>
                      </tr>
                    ))}
                    {!shownTeam.length && <tr><td colSpan={8} className="note">ไม่พบพนักงานที่ตรงกับคำค้นหา</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="note">เลือกแถวเพื่อดูรายวันของคนนั้น · "ไม่ครบ" = ตรวจรถไม่ถึง {totalItems} ข้อ</p>
            </>
          ) : <div className="empty">ยังไม่มีบันทึกในเดือน {month} เริ่มจากแท็บตรวจรถหรือ PPE แล้วตัวเลขจะขึ้นที่นี่</div>}
        </section>

        <section className="panel">
          <h2>ข้อที่ไม่ผ่านบ่อย</h2>
          {topFails.length ? topFails.map(([k, n]) => (
            <div className="bar" key={k}>
              <span>{pad2(k)} {itemName(k)}</span>
              <span className="tr"><i style={{ width: `${(n / mx) * 100}%` }} /></span>
              <b className="mono">{n}</b>
            </div>
          )) : <div className="empty">ยังไม่พบข้อที่ไม่ผ่านในเดือนนี้</div>}
        </section>
      </div>

      <section className="panel">
        <h2>PPE แยกพนักงาน</h2>
        {P.length ? (
          <BarChart labels={team.map((t) => short(t.e.name || t.e.id))} series={[
            { name: 'PPE ตรวจ', color: 'var(--s1)', vals: team.map((t) => t.pc) },
            { name: 'PPE ครบ', color: 'var(--s2)', vals: team.map((t) => t.ok) },
            { name: 'PPE ไม่มี (รายการ)', color: 'var(--s3)', vals: team.map((t) => t.miss) },
          ]} />
        ) : <div className="empty">ยังไม่มีบันทึก PPE ในเดือน {month}</div>}
      </section>

      <section className="panel">
        <h2>รายคน: {pName || '-'}</h2>
        <div className="kpis k8">
          <Kpi value={ps.pc} label="PPE ตรวจ" />
          <Kpi value={ps.ok} label="PPE ครบ" tone={ps.pc && ps.ok === ps.pc ? 'good' : ''} />
          <Kpi value={ps.miss} label="PPE ไม่มี (รายการ)" tone={ps.miss ? 'bad' : ''} />
          <Kpi value={ps.vc} label="ตรวจรถ" />
          <Kpi value={ps.vp} label="รถผ่าน" tone="good" />
          <Kpi value={ps.vf} label="รถไม่ผ่าน" tone={ps.vf ? 'bad' : ''} />
          <Kpi value={ps.line} label="ส่งภาพครบ" />
          <Kpi value={ps.inc} label="รถตรวจไม่ครบ" tone={ps.inc ? 'bad' : ''} />
        </div>
      </section>

      {pp.length || vv.length ? (
        <>
          <div className="two">
            <section className="panel"><h2>แนวโน้ม PPE รายวัน</h2><LineChart labels={dl} series={ppeSeries} /></section>
            <section className="panel"><h2>รถไม่ผ่านรายวัน</h2>
              <BarChart labels={dl} every={5} series={[{ name: 'รถไม่ผ่าน', color: 'var(--fail)', vals: perDay.map((x) => x.vf) }]} />
            </section>
          </div>
          <section className="panel">
            <h2>รายวัน: {pName}</h2>
            <div className="tbl">
              <table>
                <thead><tr>
                  <th>วันที่</th><th className="num">PPE ตรวจ</th><th className="num">PPE ครบ</th><th className="num">PPE ไม่มี</th>
                  <th className="num">รถตรวจ</th><th className="num">รถไม่ผ่าน</th><th className="num">ข้อไม่ผ่าน</th>
                  <th className="num">ภาพครบ</th><th>ข้อที่ไม่ผ่าน</th>
                </tr></thead>
                <tbody>
                  {perDay.filter((x) => x.pc || x.vc).map((x) => (
                    <tr key={x.d}>
                      <td className="mono">{x.d.slice(8)}</td><td className="num">{x.pc}</td><td className="num">{x.ok}</td>
                      <td className="num">{x.miss}</td><td className="num">{x.vc}</td><td className="num">{x.vf}</td>
                      <td className="num">{x.itemFails}</td><td className="num">{x.line}</td>
                      <td>{x.failItems.length ? x.failItems.join(', ') : <span className="note">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : <section className="panel"><div className="empty">คนนี้ยังไม่มีบันทึกในเดือน {month}</div></section>}
    </>
  );
}
