import { useEffect, useState } from 'react';
import { useMaster } from '../components/MasterContext';
import { Kpi } from '../components/Fields';
import { useToast } from '../components/Toast';
import { listDailyPpeStatus, listDailySummary, listDailyVehicleStatus } from '../lib/api';
import type { DailyPpeStatus, DailySummary, DailyVehicleStatus } from '../lib/types';
import { errMsg, pad2, today } from '../lib/utils';

const VEH_LABEL = { 0: 'ยังไม่ตรวจ', 1: 'ผ่าน', 2: 'ไม่ผ่าน' } as const;
const VEH_PILL = { 0: 'w', 1: 'p', 2: 'f' } as const;
const PPE_PILL: Record<DailyPpeStatus['status'], string> = { 'ยังไม่ตรวจ': 'w', 'ครบ': 'p', 'ไม่ครบ': 'x', 'อุปกรณ์ไม่ครบ': 'f' };
// problems first: not checked, failed, then passed
const VEH_ORDER = { 0: 0, 2: 1, 1: 2 } as const;
const PPE_ORDER: Record<DailyPpeStatus['status'], number> = { 'ยังไม่ตรวจ': 0, 'อุปกรณ์ไม่ครบ': 1, 'ไม่ครบ': 2, 'ครบ': 3 };

function shiftDay(date: string, n: number) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}

const WEEKDAY = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const weekday = (date: string) => WEEKDAY[new Date(date + 'T00:00:00').getDay()];

export function DailyPage() {
  const { checkItems, ppeItems, photoSlots, nameOf } = useMaster();
  const toast = useToast();
  const [date, setDate] = useState(today());
  const [veh, setVeh] = useState<DailyVehicleStatus[]>([]);
  const [ppe, setPpe] = useState<DailyPpeStatus[]>([]);
  const [month, setMonth] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([listDailyVehicleStatus(date), listDailyPpeStatus(date)])
      .then(([v, p]) => { if (alive) { setVeh(v); setPpe(p); } })
      .catch((e) => toast('โหลดข้อมูลไม่สำเร็จ: ' + errMsg(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [date, toast]);

  const ym = date.slice(0, 7);
  useEffect(() => {
    let alive = true;
    listDailySummary(ym).then((m) => alive && setMonth(m)).catch(() => {});
    return () => { alive = false; };
  }, [ym]);

  const itemName = (no: number) => checkItems.find((i) => i.item_no === no)?.name ?? String(no);
  const ppeName = (code: string) => ppeItems.find((p) => p.code === code)?.name ?? code;

  const vChecked = veh.filter((r) => r.status > 0).length;
  const vFailed = veh.filter((r) => r.status === 2).length;
  const vPhotos = veh.filter((r) => r.photo_status === 1).length;
  const pChecked = ppe.filter((r) => r.status !== 'ยังไม่ตรวจ').length;
  const pComplete = ppe.filter((r) => r.status === 'ครบ').length;
  const future = date > today();

  const vehSorted = [...veh].sort((a, b) => VEH_ORDER[a.status] - VEH_ORDER[b.status] || a.plate.localeCompare(b.plate));
  const ppeSorted = [...ppe].sort((a, b) => PPE_ORDER[a.status] - PPE_ORDER[b.status] || a.employee_id.localeCompare(b.employee_id));

  return (
    <>
      <section className="panel">
        <div className="row spread head-row">
          <h2>สถานะการตรวจรายวัน</h2>
          <div className="row day-nav">
            <button className="btn ghost sm" aria-label="วันก่อนหน้า" onClick={() => setDate(shiftDay(date, -1))}>‹</button>
            <input type="date" aria-label="วันที่" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button className="btn ghost sm" aria-label="วันถัดไป" onClick={() => setDate(shiftDay(date, 1))}>›</button>
            {date !== today() && <button className="btn ghost sm" onClick={() => setDate(today())}>วันนี้</button>}
          </div>
        </div>
        <div className={`kpis${loading ? ' loading' : ''}`}>
          <Kpi value={`${vChecked}/${veh.length}`} label={`รถตรวจแล้ว (${weekday(date)} ${Number(date.slice(8))})`}
            tone={veh.length && vChecked < veh.length ? 'bad' : veh.length ? 'good' : ''} />
          <Kpi value={vFailed} label="รถไม่ผ่าน" tone={vFailed ? 'bad' : vChecked ? 'good' : ''} />
          <Kpi value={`${vPhotos}/${veh.length}`} label="ส่งรูปครบ" tone={veh.length && vPhotos < veh.length ? 'bad' : ''} />
          <Kpi value={`${pChecked}/${ppe.length}`} label="พนักงานตรวจ PPE แล้ว"
            tone={ppe.length && pChecked < ppe.length ? 'bad' : ppe.length ? 'good' : ''} />
          <Kpi value={`${pComplete}/${ppe.length}`} label="PPE ครบ" tone={ppe.length && pComplete < ppe.length ? 'bad' : ''} />
        </div>
        {future && <p className="note">วันนี้ยังไม่ถึง จึงยังไม่มีสถานะ</p>}
      </section>

      <div className="two">
        <section className="panel">
          <h2>รถ <span className="note mono">{vChecked}/{veh.length}</span></h2>
          {vehSorted.length ? vehSorted.map((r) => (
            <div className={`emp status-row s${r.status}`} key={r.plate}>
              <div className="row spread">
                <b>{r.plate}{!r.registered && <span className="note"> · ไม่อยู่ในทะเบียนรถ</span>}</b>
                <span className={`pill ${VEH_PILL[r.status]}`}>
                  {r.status === 2 ? `${r.fail_count} ข้อไม่ผ่าน` : VEH_LABEL[r.status]}
                </span>
              </div>
              {r.status > 0 ? (
                <>
                  <div className="note">
                    D-Man {nameOf(r.dman_id)} · {(r.inspect_time ?? '').slice(0, 5)} · ตรวจ {r.filled_count}/{checkItems.filter((i) => i.active).length} · รูป {r.photo_count}/{photoSlots.length}
                  </div>
                  {r.fail_items.length > 0 && (
                    <div className="fail-list">{r.fail_items.map((n) => `${pad2(n)} ${itemName(n)}`).join(' · ')}</div>
                  )}
                </>
              ) : <div className="note">ยังไม่มีบันทึกการตรวจของวันนี้</div>}
            </div>
          )) : <div className="empty">ไม่มีข้อมูลรถของวันนี้</div>}
        </section>

        <section className="panel">
          <h2>พนักงาน (PPE) <span className="note mono">{pChecked}/{ppe.length}</span></h2>
          {ppeSorted.length ? ppeSorted.map((r) => (
            <div className={`emp status-row ${r.status === 'ยังไม่ตรวจ' ? 's0' : r.status === 'ครบ' ? 's1' : 's2'}`} key={r.employee_id}>
              <div className="row spread">
                <b>{nameOf(r.employee_id)} <span className="note">{r.employee_id}</span></b>
                <span className={`pill ${PPE_PILL[r.status]}`}>{r.status}</span>
              </div>
              {r.status === 'ยังไม่ตรวจ' ? <div className="note">ยังไม่มีบันทึก PPE ของวันนี้</div> : (
                <>
                  <div className="note">ผู้ตรวจ {nameOf(r.inspector_id)}{r.plate && ` · ${r.plate}`}</div>
                  {r.missing_items.length > 0 && <div className="fail-list">ไม่มี: {r.missing_items.map(ppeName).join(', ')}</div>}
                </>
              )}
            </div>
          )) : <div className="empty">ไม่มีข้อมูลพนักงานของวันนี้</div>}
        </section>
      </div>

      <section className="panel">
        <h2>ทั้งเดือน {ym} <span className="note">เลือกแถวเพื่อดูวันนั้น</span></h2>
        {month.length ? (
          <div className="tbl">
            <table>
              <thead><tr>
                <th>วันที่</th><th className="num">รถตรวจ</th><th className="num">ไม่ผ่าน</th><th className="num">รูปครบ</th>
                <th className="num">PPE ตรวจ</th><th className="num">PPE ครบ</th>
              </tr></thead>
              <tbody>
                {[...month].reverse().map((d) => (
                  <tr key={d.day} className={`pick${d.day === date ? ' sel' : ''}`} onClick={() => setDate(d.day)}>
                    <td className="mono">{weekday(d.day)} {d.day.slice(8)}</td>
                    <td className={`num${d.vehicles_checked < d.vehicles_total ? ' bad' : ''}`}>{d.vehicles_checked}/{d.vehicles_total}</td>
                    <td className={`num${d.vehicles_failed ? ' bad' : ''}`}>{d.vehicles_failed}</td>
                    <td className="num">{d.vehicles_photo_complete}/{d.vehicles_total}</td>
                    <td className={`num${d.ppe_checked < d.ppe_total ? ' bad' : ''}`}>{d.ppe_checked}/{d.ppe_total}</td>
                    <td className={`num${d.ppe_complete < d.ppe_checked ? ' bad' : ''}`}>{d.ppe_complete}/{d.ppe_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">ยังไม่มีบันทึกในเดือน {ym}</div>}
      </section>
    </>
  );
}
