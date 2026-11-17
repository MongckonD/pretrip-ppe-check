/**
 * Admin tab "ใบขับขี่" (/admin/licenses): the current driver licences that active staff have sent.
 * Summary numbers, filter by status (click a number), search, and the list — worst first
 * (expired → expiring soon → valid).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { licensePhotoUrl, listLicenses } from '../lib/api';
import { statusText, thaiDate, type LicenseRow } from '../lib/license';
import { errMsg } from '../lib/utils';
import { LicensePill } from '../pages/LicensePage';

type Filter = 'all' | 'expired' | 'expiring' | 'valid';

const matches = (r: LicenseRow, f: Filter) =>
  f === 'all' ? true
    : f === 'valid' ? r.status === 'ok' || r.status === 'lifetime'
    : r.status === f;

export function LicensesPage() {
  const [data, setData] = useState<{ rows: LicenseRow[]; warn_days: number } | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await listLicenses()); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => matches(r, filter) && (!s || [
      r.display_name, r.employee_name, r.employee_id, r.user_id, r.license.full_name, r.license.license_no,
    ].some((v) => v?.toLowerCase().includes(s))));
  }, [data, filter, q]);

  if (error) {
    return (
      <section className="panel error-panel">
        <b>โหลดข้อมูลใบขับขี่ไม่สำเร็จ</b><div className="note">{error}</div>
        <button className="btn sm" onClick={load}>ลองใหม่</button>
      </section>
    );
  }
  if (!data) return <div className="empty">กำลังโหลด…</div>;

  const n = (f: Filter) => data.rows.filter((r) => matches(r, f)).length;
  const cards: { f: Filter; label: string; tone: string; sub?: string }[] = [
    { f: 'expired', label: 'หมดอายุแล้ว', tone: 'bad' },
    { f: 'expiring', label: 'ใกล้หมดอายุ', tone: 'warn', sub: `เหลือ ≤ ${data.warn_days} วัน` },
    { f: 'valid', label: 'ใช้ได้', tone: 'good', sub: 'รวมใบตลอดชีพ' },
  ];

  return (
    <>
      <div className="kpis lic-kpis">
        {cards.map((c) => (
          <button key={c.f} type="button" className={`kpi ${c.tone}${filter === c.f ? ' picked' : ''}`}
            aria-pressed={filter === c.f} onClick={() => setFilter(filter === c.f ? 'all' : c.f)}>
            <b>{n(c.f)}</b>
            <span>{c.label}{c.sub && <em> · {c.sub}</em>}</span>
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="row spread head-row">
          <h2 className="flush">
            {filter === 'all' ? `ใบขับขี่ทั้งหมด (${data.rows.length})`
              : `${cards.find((c) => c.f === filter)?.label} (${rows.length})`}
          </h2>
          <div className="row">
            <input className="search" type="search" placeholder="ค้นหาชื่อ / รหัส / เลขที่" value={q}
              aria-label="ค้นหา" onChange={(e) => setQ(e.target.value)} />
            {filter !== 'all' && <button className="btn ghost sm" onClick={() => setFilter('all')}>แสดงทั้งหมด</button>}
            <button className="btn ghost sm" onClick={load}>รีเฟรช</button>
          </div>
        </div>
        {rows.length ? (
          <div className="tbl">
            <table className="lic-table">
              <thead>
                <tr><th>พนักงาน</th><th>ชื่อตามใบขับขี่</th><th>เลขที่</th><th>หมดอายุ</th><th>สถานะ</th><th>ส่งเมื่อ</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id} className={`st-${r.status}`}>
                    <td><b>{r.display_name || r.employee_name || r.user_id}</b><div className="note">{r.employee_id ?? r.user_id}</div></td>
                    <td>{r.license.full_name}</td>
                    <td className="mono">{r.license.license_no}</td>
                    <td>
                      {r.license.lifetime ? 'ตลอดชีพ' : thaiDate(r.license.expiry_date)}
                      {!r.license.lifetime && <div className="note">{statusText(r.license)}</div>}
                    </td>
                    <td><LicensePill status={r.status} /></td>
                    <td className="note">{new Date(r.license.submitted_at).toLocaleDateString('th-TH', { dateStyle: 'medium' })}</td>
                    <td>{r.license.has_photo && (
                      <a className="btn ghost sm" href={licensePhotoUrl(r.license.id)} target="_blank" rel="noopener noreferrer">ดูรูป</a>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            {q ? `ไม่พบ "${q}"` : data.rows.length ? 'ไม่มีใบขับขี่ในกลุ่มนี้' : 'ยังไม่มีพนักงานส่งใบขับขี่'}
          </div>
        )}
        <p className="note mt">
          แสดงเฉพาะใบขับขี่ที่พนักงานส่งแล้ว · พนักงานส่ง/อัปเดตเองที่แท็บ "ใบขับขี่" ในหน้าพนักงาน
          · ระบบเตือนพนักงานเมื่อเหลือ ≤ {data.warn_days} วัน
        </p>
      </section>
    </>
  );
}
