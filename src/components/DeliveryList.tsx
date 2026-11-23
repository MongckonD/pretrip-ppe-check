/**
 * Staff → Time activities → "ร้านค้าที่ต้องส่ง": the stores today's vehicle must deliver to (read only), from the
 * plan the admin imported from SAP. The vehicle comes from today's vehicle check of my team (picker when there are two).
 * Only shown when the storeDelivery feature switch is on.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNow } from './Fields';
import { PinIcon, RefreshIcon, StoreIcon } from './Icons';
import { CheckPicker, NoCheckYet, useTodayChecks } from './TodayChecks';
import { listDeliveryPlan } from '../lib/api';
import { storeTypeName, type StoreType } from '../lib/storeVisit';
import type { DeliveryStop } from '../lib/types';
import { errMsg, today } from '../lib/utils';

const casesText = (n: number | null) => (n === null ? '–' : n.toLocaleString('th-TH'));

export function DeliveryList({ goVehicle }: { goVehicle?: () => void }) {
  const now = useNow();
  const [day, setDay] = useState(today());
  useEffect(() => { if (today() !== day) setDay(today()); }, [now, day]);
  const { checks, check, selId, setSelId } = useTodayChecks(day);

  const [stops, setStops] = useState<DeliveryStop[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // stores whose bill list is open
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpenIds((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const plate = check?.plate;
  const load = useCallback(async () => {
    if (!plate) return;
    setLoading(true);
    setError('');
    try { setStops(await listDeliveryPlan(day, plate)); } catch (e) { setStops([]); setError(errMsg(e)); } finally { setLoading(false); }
  }, [day, plate]);
  useEffect(() => { setStops(null); load(); }, [load]);

  if (checks === null) return <div className="empty">กำลังโหลด…</div>;
  if (!checks.length) return <NoCheckYet title="ร้านค้าที่ต้องส่ง" then="รายการร้านของรถคันนั้นจะขึ้นที่นี่" goVehicle={goVehicle} />;

  const list = stops ?? [];
  const bills = list.reduce((n, s) => n + s.bills.length, 0);
  const cases = list.some((s) => s.cases !== null) ? list.reduce((n, s) => n + (s.cases ?? 0), 0) : null;

  return (
    <section className="panel dl">
      <div className="row spread dl-head">
        <div>
          <h2 className="flush">ร้านค้าที่ต้องส่งวันนี้ · {plate}</h2>
          <span className="note">
            {stops === null ? 'กำลังโหลด…' : list.length ? `${list.length} ร้าน · ${bills} บิล${cases !== null ? ` · ${casesText(cases)} ลัง` : ''}` : ''}
          </span>
        </div>
        <button type="button" className="btn ghost sm" disabled={loading} onClick={load}>
          <span className="ii" aria-hidden><RefreshIcon /></span>{loading ? 'กำลังโหลด…' : 'รีเฟรช'}
        </button>
      </div>
      <CheckPicker checks={checks} selId={selId} onPick={setSelId} />
      {error && <div className="form-error" role="alert">{error}</div>}
      {stops !== null && !error && !list.length && (
        <div className="empty">ยังไม่มีรายการร้านของรถ {plate} วันนี้ — หัวหน้ายังไม่ได้นำเข้าแผนส่ง</div>
      )}
      {list.length > 0 && (
        <ul className="dl-list">
          {list.map((s) => (
            <li key={s.id} className="dl-item">
              <span className="dl-ico" aria-hidden><StoreIcon /></span>
              <div className="dl-main">
                {/* same look as the admin list: big name, code / type as tags, address on its own line */}
                <span className="plan-store-top">
                  <b className="plan-store-name">{s.name}</b>
                  <span className="plan-tag mono">{s.code}</span>
                  {s.type && <span className="plan-tag">{storeTypeName(s.type as StoreType)}</span>}
                </span>
                {s.address && <span className="plan-addr"><span className="ii" aria-hidden><PinIcon /></span>{s.address}</span>}
                {/* bills: count + a button that lists each bill with its cases */}
                {s.bills.length > 0 && (
                  <button type="button" className="dl-bills-btn" aria-expanded={openIds.has(s.id)} onClick={() => toggle(s.id)}>
                    {s.bills.length} บิล · {openIds.has(s.id) ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'} <span className="plan-chev" aria-hidden>›</span>
                  </button>
                )}
              </div>
              <span className="dl-cases"><b className="mono">{casesText(s.cases)}</b><small>ลัง</small></span>
              {s.bills.length > 0 && openIds.has(s.id) && (
                <table className="dl-bills">
                  <thead><tr><th>เลขที่บิล</th><th className="r">ลัง</th></tr></thead>
                  <tbody>
                    {s.bills.map((b, i) => (
                      <tr key={`${b.bill_no}-${i}`}><td className="mono">{b.bill_no || 'ไม่มีเลขบิล'}</td><td className="r mono">{casesText(b.cases)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>รวม {s.bills.length} บิล</td><td className="r mono">{casesText(s.cases)}</td></tr></tfoot>
                </table>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
