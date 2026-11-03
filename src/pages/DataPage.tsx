import { useMaster, type MasterCtx } from '../components/MasterContext';
import type { PpeInspection, VehicleInspection } from '../lib/types';
import { PHOTO_STATUS, downloadText, pad2, toCsv } from '../lib/utils';
import { useMonthData } from './useMonthData';

type Cell = string | number;
interface Table { head: string[]; rows: Cell[][]; codeFrom: number; codeTo: number }

function vehicleTable(V: VehicleInspection[], m: MasterCtx): Table {
  const items = m.checkItems.filter((i) => i.active);
  const head = ['วันที่', 'เดือน (yyyy-mm)', 'รหัส D-Man', 'ชื่อ D-Man', 'Helper 1', 'Helper 2', 'ทะเบียนรถ', 'เลขไมล์',
    'เวลาตรวจ', 'ส่งภาพเข้าระบบ', 'ผลตรวจ 1/2', 'ข้อบกพร่อง/หมายเหตุ',
    ...items.map((i) => `${pad2(i.item_no)} ${i.name}`),
    'จำนวนผ่าน', 'จำนวนไม่ผ่าน', 'จำนวนไม่เกี่ยวข้อง', 'จำนวนกรอก', 'ความครบถ้วน'];
  const rows = V.map((r) => [
    r.inspect_date, r.month, r.dman_id, m.nameOf(r.dman_id),
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
    r.inspect_date, r.month, r.employee_id, m.nameOf(r.employee_id),
    m.employees.find((e) => e.id === r.employee_id)?.role ?? '', r.plate, m.nameOf(r.inspector_id),
    ...items.map((p) => r.results?.[p.code] ?? ''),
    r.have_count, r.missing_count, r.filled_count, r.status,
  ]);
  return { head, rows, codeFrom: 7, codeTo: 7 + items.length };
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

export function DataPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const master = useMaster();
  const { veh, ppe, error } = useMonthData(month);
  const sections: [string, string, Table][] = [
    ['car', 'DATA รถ', vehicleTable(veh, master)],
    ['ppe', 'DATA PPE', ppeTable(ppe, master)],
  ];

  return (
    <>
      <section className="panel">
        <div className="row spread">
          <div>
            <h2 className="flush">ตารางข้อมูล</h2>
            <span className="note">1 แถว = รถ 1 คัน/วัน หรือ พนักงาน 1 คน/วัน · 1 = ผ่าน/มี, 2 = ไม่ผ่าน/ไม่มี, 3 = ไม่เกี่ยวข้อง</span>
          </div>
          <label className="month-pick">เดือน<input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        </div>
        {error && <div className="error">โหลดข้อมูลไม่สำเร็จ: {error}</div>}
      </section>
      {sections.map(([key, title, t]) => (
        <section className="panel" key={key}>
          <div className="row spread head-row">
            <h2 className="flush">{title} <span className="note mono">{t.rows.length} แถว</span></h2>
            <button className="btn ghost sm" disabled={!t.rows.length}
              onClick={() => downloadText(`data-${key}_${month}.csv`, toCsv([t.head, ...t.rows]))}>
              ดาวน์โหลด CSV
            </button>
          </div>
          <DataTable t={t} month={month} />
        </section>
      ))}
    </>
  );
}
