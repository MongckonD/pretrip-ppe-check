/**
 * Admin "สถานะรถ" (/admin/vehicle-status): every active vehicle for one day with its check status
 * (ยังไม่ตรวจ / รออนุมัติ / ไม่อนุมัติ / อนุมัติแล้ว), what failed, the crew's PPE, every photo (tap to enlarge),
 * and approve / ไม่อนุมัติ (with a reason) / undo.
 * Approval is FINAL: an approved check cannot be undone, rejected or edited (also enforced by the server and the DB).
 * A rejected one goes back to รออนุมัติ when staff re-send it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSignedUrls } from '../components/Fields';
import { Lightbox, type LightboxPhoto } from '../components/Lightbox';
import { useMaster } from '../components/MasterContext';
import { useToast } from '../components/Toast';
import { listPpeInspections, listVehicleInspections, setVehicleApproval, setVehicleRejection } from '../lib/api';

const FINAL_NOTE = 'อนุมัติแล้วจะยกเลิกหรือแก้ไขไม่ได้';
import type { PpeInspection, VehicleInspection } from '../lib/types';
import { errMsg, today } from '../lib/utils';

type Status = 'none' | 'wait' | 'bad' | 'ok';
type Filter = 'all' | Status;
const STATUS: Record<Status, { text: string; cls: string }> = {
  none: { text: 'ยังไม่ตรวจ', cls: 'x' },
  wait: { text: 'รออนุมัติ', cls: 'w' },
  bad: { text: 'ไม่อนุมัติ', cls: 'f' },
  ok: { text: 'อนุมัติแล้ว', cls: 'p' },
};
const statusOf = (c?: VehicleInspection): Status => (!c ? 'none' : c.approved_at ? 'ok' : c.rejected_at ? 'bad' : 'wait');

interface Row { plate: string; type: string; check?: VehicleInspection; status: Status }

const crewOf = (c: VehicleInspection) => [c.dman_id, c.helper1_id, c.helper2_id].filter((x): x is string => !!x);
const thTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
/** quick reasons the admin can tap instead of typing */
const QUICK_REASONS = ['ถ่ายรูปรถไม่ครบ', 'รูปไม่ชัด / ไม่ตรงกับข้อที่แจ้ง', 'หมายเหตุไม่ชัดเจน', 'รถไม่พร้อมออกงาน — แจ้งซ่อมก่อน'];

export function VehicleStatusPage() {
  const { vehicles, checkItems, photoSlots } = useMaster();
  const toast = useToast();
  const [date, setDate] = useState(today());
  const [checks, setChecks] = useState<VehicleInspection[] | null>(null);
  const [ppe, setPpe] = useState<PpeInspection[]>([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [v, p] = await Promise.all([listVehicleInspections({ date }), listPpeInspections({ date })]);
      setChecks(v); setPpe(p); setError('');
    } catch (e) { setError(errMsg(e)); }
  }, [date]);
  useEffect(() => { setChecks(null); load(); }, [load]);
  // keep the board current while it is open (new checks arrive during the morning)
  useEffect(() => {
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const totalItems = checkItems.filter((i) => i.active).length;
  const rows = useMemo<Row[]>(() => {
    if (!checks) return [];
    const byPlate = new Map(checks.map((c) => [c.plate, c]));
    const active = vehicles.filter((v) => v.active || byPlate.has(v.plate));
    const order: Record<Status, number> = { wait: 0, bad: 1, ok: 2, none: 3 };
    return active.map((v) => {
      const check = byPlate.get(v.plate);
      return { plate: v.plate, type: v.type, check, status: statusOf(check) };
    }).sort((a, b) => order[a.status] - order[b.status] || a.plate.localeCompare(b.plate, 'th'));
  }, [checks, vehicles]);

  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => filter === 'all' || r.status === filter);
  /** pending checks with every item filled and nothing failed — safe to approve in one go */
  const cleanPending = rows.filter((r) => r.status === 'wait' && r.check && !r.check.fail_count && r.check.filled_count >= totalItems);

  async function run(r: Row, fn: () => Promise<void>, ok: string) {
    if (!r.check) return;
    setBusy(r.check.id);
    try { await fn(); toast(ok); await load(); }
    catch (e) { toast('ไม่สำเร็จ: ' + errMsg(e)); }
    finally { setBusy(''); }
  }
  function approve(r: Row) {
    const c = r.check!;
    const fails = c.fail_count > 0 ? `มี ${c.fail_count} ข้อไม่ผ่าน\n` : '';
    if (!window.confirm(`อนุมัติรถ ${r.plate}?\n${fails}${FINAL_NOTE}`)) return;
    void run(r, () => setVehicleApproval(c.id, true), `อนุมัติรถ ${r.plate} แล้ว`);
  }
  const reject = (r: Row, reason: string) => run(r, () => setVehicleRejection(r.check!.id, reason), `ไม่อนุมัติรถ ${r.plate} แล้ว — พนักงานจะเห็นเหตุผล`);
  const unreject = (r: Row) => run(r, () => setVehicleRejection(r.check!.id, null), `ยกเลิกไม่อนุมัติรถ ${r.plate} แล้ว (กลับเป็นรออนุมัติ)`);

  async function approveAllClean() {
    if (!cleanPending.length) return;
    if (!window.confirm(`อนุมัติรถที่ผ่านครบทุกข้อ ${cleanPending.length} คัน?\n${cleanPending.map((r) => r.plate).join(', ')}\n${FINAL_NOTE}`)) return;
    setBusy('all');
    let ok = 0;
    for (const r of cleanPending) {
      try { await setVehicleApproval(r.check!.id, true); ok++; } catch { /* reported below */ }
    }
    toast(ok === cleanPending.length ? `อนุมัติแล้ว ${ok} คัน` : `อนุมัติได้ ${ok} จาก ${cleanPending.length} คัน`);
    setBusy('');
    await load();
  }

  return (
    <>
      <section className="panel">
        <div className="row spread head-row">
          <h2 className="flush">สถานะการตรวจรถ</h2>
          <div className="row sum-ctrl">
            <input type="date" aria-label="วันที่" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
            <button className="btn ghost sm" onClick={load}>รีเฟรช</button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        {!checks && !error && <div className="empty">กำลังโหลด…</div>}
        {checks && (
          <>
            <div className="kpis">
              <div className="kpi"><b>{rows.length}</b><span>รถทั้งหมด</span></div>
              <div className={`kpi ${count('wait') ? 'warn' : ''}`}><b>{count('wait')}</b><span>รออนุมัติ</span></div>
              <div className={`kpi ${count('ok') && count('ok') === rows.length ? 'good' : ''}`}><b>{count('ok')}</b><span>อนุมัติแล้ว</span></div>
              <div className={`kpi ${count('bad') ? 'bad' : ''}`}><b>{count('bad')}</b><span>ไม่อนุมัติ</span></div>
              <div className="kpi"><b>{count('none')}</b><span>ยังไม่ตรวจ</span></div>
              <div className={`kpi ${checks.some((c) => c.fail_count) ? 'bad' : 'good'}`}><b>{checks.filter((c) => c.fail_count).length}</b><span>มีข้อไม่ผ่าน</span></div>
            </div>
            <div className="row spread mt">
              <div className="seg compact vs-filter" role="group" aria-label="กรองตามสถานะ">
                {(['all', 'wait', 'bad', 'ok', 'none'] as Filter[]).map((f) => (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {f === 'all' ? `ทั้งหมด ${rows.length}` : `${STATUS[f].text} ${count(f)}`}
                  </button>
                ))}
              </div>
              <button className="btn sm" disabled={!cleanPending.length || !!busy} onClick={approveAllClean}
                title="อนุมัติเฉพาะรถที่ตรวจครบทุกข้อและไม่มีข้อไม่ผ่าน">
                อนุมัติทุกคันที่ผ่าน ({cleanPending.length})
              </button>
            </div>
          </>
        )}
      </section>

      {checks && (
        <div className="vs-grid">
          {shown.map((r) => (
            <VehicleCard key={r.plate} r={r} ppe={ppe} totalItems={totalItems} photoTotal={photoSlots.length}
              busy={busy === r.check?.id || busy === 'all'}
              onApprove={() => approve(r)}
              onReject={(reason) => reject(r, reason)} onUnreject={() => unreject(r)} />
          ))}
          {!shown.length && <div className="empty">ไม่มีรถในสถานะนี้</div>}
        </div>
      )}
    </>
  );
}

function VehicleCard({ r, ppe, totalItems, photoTotal, busy, onApprove, onReject, onUnreject }: {
  r: Row; ppe: PpeInspection[]; totalItems: number; photoTotal: number; busy: boolean;
  onApprove: () => void; onReject: (reason: string) => Promise<void>; onUnreject: () => void;
}) {
  const { checkItems, photoSlots, nameOf } = useMaster();
  const c = r.check;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [viewer, setViewer] = useState<number | null>(null);

  const failed = useMemo(() => {
    if (!c) return [];
    const name = new Map(checkItems.map((i) => [String(i.item_no), i.name]));
    return Object.entries(c.results ?? {}).filter(([, v]) => v === 2).map(([k]) => ({
      no: k, name: name.get(k) ?? `ข้อ ${k}`, note: c.defects?.[k]?.note ?? '', photo: c.defects?.[k]?.photo ?? null,
    }));
  }, [c, checkItems]);
  /** vehicle photos in slot order */
  const carPhotos = useMemo(() => (c ? photoSlots
    .filter((s) => c.photos?.[s.code])
    .map((s) => ({ key: c.photos[s.code], caption: `รูปรถ: ${s.name}` })) : []), [c, photoSlots]);
  const urls = useSignedUrls([...failed.flatMap((d) => (d.photo ? [d.photo] : [])), ...carPhotos.map((p) => p.key)]);

  // one photo list for the viewer: failed items first, then the vehicle photos
  const gallery = useMemo<(LightboxPhoto & { key: string })[]>(() => [
    ...failed.filter((d) => d.photo).map((d) => ({ key: d.photo as string, url: urls[d.photo as string] ?? '', caption: `ข้อ ${d.no}. ${d.name} — ${d.note || 'ไม่มีหมายเหตุ'}` })),
    ...carPhotos.map((p) => ({ key: p.key, url: urls[p.key] ?? '', caption: p.caption })),
  ].filter((p) => p.url), [failed, carPhotos, urls]);
  const open = (key: string) => { const i = gallery.findIndex((p) => p.key === key); if (i >= 0) setViewer(i); };

  const st = STATUS[r.status];
  if (!c) {
    return (
      <section className="panel vs-card none">
        <div className="row spread"><b className="vs-plate">{r.plate}</b><span className={`pill ${st.cls}`}>{st.text}</span></div>
        {r.type && <div className="note">{r.type}</div>}
      </section>
    );
  }

  const crew = crewOf(c);
  const ppeOk = crew.filter((id) => ppe.some((p) => p.employee_id === id && p.plate === c.plate && p.status === 'ครบ')).length;
  const ppeDone = crew.filter((id) => ppe.some((p) => p.employee_id === id && p.plate === c.plate)).length;
  const incomplete = c.filled_count < totalItems;

  async function submitReject() {
    const t = reason.trim();
    if (!t) return;
    await onReject(t);
    setRejecting(false); setReason('');
  }

  return (
    <section className={`panel vs-card ${r.status}`}>
      <div className="row spread">
        <b className="vs-plate">{r.plate}</b>
        <span className={`pill ${st.cls}`}>{st.text}</span>
      </div>
      <div className="note">
        ตรวจเมื่อ {(c.inspect_time ?? '').slice(0, 5)} น. · D-Man {nameOf(c.dman_id)}
        {crew.length > 1 && <> · ผู้ช่วย {crew.slice(1).map(nameOf).join(', ')}</>}
      </div>

      <div className="vs-facts">
        <span className={c.fail_count ? 'bad' : 'good'}>{c.fail_count ? `ไม่ผ่าน ${c.fail_count} ข้อ` : 'ผ่านทุกข้อ'}</span>
        <span className={incomplete ? 'warn' : ''}>ตรวจ {c.filled_count}/{totalItems} ข้อ</span>
        <span className={c.photo_count < photoTotal ? 'warn' : ''}>รูปรถ {c.photo_count}/{photoTotal}</span>
        <span className={ppeOk === crew.length ? 'good' : 'warn'}>PPE ครบ {ppeOk}/{crew.length}{ppeDone < crew.length ? ` (ยังไม่ตรวจ ${crew.length - ppeDone})` : ''}</span>
      </div>

      {failed.length > 0 && (
        <ul className="defect-list">
          {failed.map((d) => (
            <li key={d.no}>
              <div className="defect-text">
                <b>{d.no}. {d.name}</b>
                {d.note ? <span>{d.note}</span> : <span className="note">ไม่มีหมายเหตุ</span>}
                {!d.photo && <span className="note">ไม่ได้แนบรูป</span>}
              </div>
              {d.photo && (urls[d.photo]
                ? <button type="button" className="vs-thumb" onClick={() => open(d.photo as string)} title="กดเพื่อดูรูปใหญ่">
                    <img src={urls[d.photo]} alt={`รูป${d.name}`} /><span>ดูรูป</span>
                  </button>
                : <span className="note">กำลังโหลดรูป…</span>)}
            </li>
          ))}
        </ul>
      )}

      <div className="vs-photos">
        <div className="ro-label">รูปรถ ({carPhotos.length}/{photoTotal})</div>
        {carPhotos.length ? (
          <div className="vs-photo-grid">
            {carPhotos.map((p) => (
              <button key={p.key} type="button" className="vs-photo" onClick={() => open(p.key)} title={`${p.caption} — กดเพื่อดูรูปใหญ่`}>
                {urls[p.key] ? <img src={urls[p.key]} alt={p.caption} /> : <span className="note">…</span>}
                <span>{p.caption.replace('รูปรถ: ', '')}</span>
              </button>
            ))}
          </div>
        ) : <div className="note">ไม่ได้ถ่ายรูปรถ</div>}
      </div>

      {r.status === 'bad' && (
        <div className="vs-reject-note">
          <b>ไม่อนุมัติ</b> โดย {c.rejected_by ?? '—'} เมื่อ {thTime(c.rejected_at)} น.
          <div>เหตุผล: {c.reject_reason || '—'}</div>
          <div className="note">รอพนักงานแก้ไขและส่งใหม่</div>
        </div>
      )}

      {rejecting ? (
        <div className="vs-reject-form">
          <label className="ro-label" htmlFor={`rej-${c.id}`}>เหตุผลที่ไม่อนุมัติ (พนักงานจะเห็นข้อความนี้)</label>
          <div className="tags">
            {QUICK_REASONS.map((q) => (
              <button key={q} type="button" className="tag" onClick={() => setReason((x) => (x ? `${x} · ${q}` : q))}>{q}</button>
            ))}
          </div>
          <textarea id={`rej-${c.id}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ยางหน้าซ้ายต้องเปลี่ยนก่อนออกงาน" autoFocus />
          <div className="row spread">
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setRejecting(false); setReason(''); }}>ยกเลิก</button>
            <button type="button" className="btn sm vs-reject" disabled={busy || !reason.trim()} onClick={submitReject}>✕ ยืนยันไม่อนุมัติ</button>
          </div>
        </div>
      ) : (
        <div className="row spread vs-actions">
          {r.status === 'ok' && <span className="note">อนุมัติโดย {c.approved_by} เมื่อ {thTime(c.approved_at)} น. · </span>}
          {r.status === 'wait' && <span className="note">{c.fail_count ? 'มีข้อไม่ผ่าน — ตรวจสอบก่อนอนุมัติ' : 'รอหัวหน้าตรวจสอบ'}</span>}
          {r.status === 'bad' && <span />}
          <div className="row">
            {r.status === 'bad' && <button className="btn ghost sm" disabled={busy} onClick={onUnreject}>ยกเลิกไม่อนุมัติ</button>}
            {r.status === 'wait' && <button className="btn sm vs-reject" disabled={busy} onClick={() => setRejecting(true)}>✕ ไม่อนุมัติ</button>}
            {r.status !== 'ok' && <button className="btn sm vs-approve" disabled={busy} onClick={onApprove}>✓ อนุมัติ</button>}
          </div>
        </div>
      )}

      {viewer !== null && <Lightbox photos={gallery} start={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}
