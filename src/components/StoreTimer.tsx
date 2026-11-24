/**
 * Store timer (จับเวลาร้านค้า), feature switch storeTimer: time each store delivery from the store list.
 * Staff → Time activities → ร้านค้าที่ต้องส่ง: every store of today's plan shows its status
 * (ยังไม่ส่ง / กำลังส่ง / ส่งสำเร็จ / ส่งไม่สำเร็จ) and "เริ่มส่งร้านนี้" — only stores in the plan can be timed.
 *
 * Saved in the database (table store_visits, API worker/store-visit-routes.ts; test mode: api.mock.ts):
 *   - the data belongs to the VEHICLE and the day: whoever of the team signs in sees the same statuses; each row keeps who pressed
 *   - every time is stamped by the server (start = "รถจอดแล้ว", end = "รถออกจากร้าน"), never the phone's clock
 *   - one clock per store; the finish form asks the cases (from the plan, can be corrected); a delivered store is final
 *   - timing is locked until "เริ่มการทำงาน" and after "จบงาน"; "จบงาน" is refused while a store is open
 * The statuses come with the plan (GET /api/delivery-plan), so the screen reloads the list after each press.
 */
import { useEffect, useState } from 'react';
import { ConfirmButton } from './ConfirmButton';
import { PinIcon, StoreIcon } from './Icons';
import { EndVisit, useTick, type Delivery } from './StoreVisits';
import { useToast } from './Toast';
import { END_CODE, clock, hhmm, minutes1, storeTypeName, visitSeconds, type StoreType, type StoreVisit } from '../lib/storeVisit';
import {
  deleteStoreVisit, devResetStoreVisits, endStoreVisit, failStoreVisit, listTripActivities, resumeStoreVisit, saveStoreVisit, startStoreVisit,
} from '../lib/api';
import type { DeliveryStop } from '../lib/types';
import { errMsg, today } from '../lib/utils';

const casesText = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString('th-TH'));

/** the server status of a store in the shape the timer screens use (one clock: start → truck leaves) */
function asVisit(s: DeliveryStop, cases: number | null): StoreVisit {
  const v = s.visit!;
  const start = v.started_at ?? new Date().toISOString();
  const end = v.ended_at ?? undefined;
  return {
    id: v.id, date: today(), plate: s.plate, storeId: s.id, storeName: s.name, storeType: (s.type || 'general') as StoreType,
    startedAt: start, endedAt: end,
    segments: end ? [{ code: 'A01', start, end }, { code: END_CODE, start: end, end }] : [{ code: 'A01', start }],
    cases: v.cases ?? cases ?? undefined,
  };
}

export function StoreTimer({ plate, stops, reload, refreshKey, goWork }: {
  plate: string; stops: DeliveryStop[];
  /** reloads the plan (with the statuses) */
  reload: () => Promise<void>;
  /** changes when the staff press "รีเฟรช": the work record is read again then */
  refreshKey: number;
  goWork?: () => void;
}) {
  const toast = useToast();
  // timing needs "เริ่มการทำงาน" today and stops at "จบงาน" (the server checks it too)
  // undefined = loading, null = not started
  const [work, setWork] = useState<{ ended: string | null } | null | undefined>(undefined);
  const [workTick, setWorkTick] = useState(0);
  useEffect(() => {
    let alive = true;
    listTripActivities({ date: today() })
      .then((list) => {
        const t = list.find((x) => x.plate === plate);
        if (alive) setWork(t ? { ended: t.work_ended_at ? (t.end_time ?? '') : null } : null);
      })
      .catch(() => { if (alive) setWork(null); });
    return () => { alive = false; };
  }, [plate, refreshKey, workTick]);
  const ended = work?.ended != null;
  const started = !!work && !ended;

  const [busy, setBusy] = useState(false);
  /** one press: call the server, then reload the list (an error also re-reads the work record: it may have changed) */
  async function act(fn: () => Promise<unknown>, done?: string) {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      await reload();
      return true;
    } catch (e) {
      toast(errMsg(e));
      setWorkTick((x) => x + 1);
      await reload().catch(() => undefined);
      return false;
    } finally { setBusy(false); }
  }

  // stores whose details are open
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpenIds((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [failFor, setFailFor] = useState<string | null>(null); // store whose "ส่งไม่สำเร็จ" form is open
  const [failNote, setFailNote] = useState('');

  const activeStop = stops.find((s) => s.visit?.status === 'open');
  const active = activeStop ? asVisit(activeStop, activeStop.cases) : null;
  const doneCount = stops.filter((s) => s.visit?.status === 'done').length;
  const failCount = stops.filter((s) => s.visit?.status === 'failed').length;
  const no = doneCount + 1;
  useTick(!!active && !active.endedAt);

  const start = (s: DeliveryStop) => {
    if (ended) { toast('จบงานแล้ว — จับเวลาร้านค้าไม่ได้'); return; }
    if (!started) { toast('กด "เริ่มการทำงาน" ก่อน จึงจะจับเวลาร้านค้าได้'); return; }
    return act(() => startStoreVisit(s.id), `เริ่มจับเวลา ${s.name} — รถจอดหน้าร้าน`);
  };
  const leave = () => activeStop?.visit && act(() => endStoreVisit(activeStop.visit!.id));
  const resume = () => activeStop?.visit && act(() => resumeStoreVisit(activeStop.visit!.id));
  const cancel = () => activeStop?.visit && act(() => deleteStoreVisit(activeStop.visit!.id), `ยกเลิก ${activeStop.name} แล้ว`);
  const save = (x: Delivery) => activeStop?.visit && x.cases != null && act(
    () => saveStoreVisit(activeStop.visit!.id, { cases: x.cases!, skus: x.skus ?? null, distance_m: x.distanceM ?? null, method: x.method ?? null }),
    `บันทึก ${activeStop.name} แล้ว — เลือกร้านถัดไปได้เลย`,
  );
  async function markFailed(s: DeliveryStop) {
    if (!failNote.trim()) { toast('เขียนหมายเหตุก่อนว่าทำไมส่งไม่สำเร็จ'); return; }
    if (await act(() => failStoreVisit(s.id, failNote), `บันทึก ${s.name} ว่าส่งไม่สำเร็จแล้ว`)) {
      setFailFor(null);
      setFailNote('');
    }
  }
  const undoFailed = (s: DeliveryStop) => s.visit && act(() => deleteStoreVisit(s.visit!.id), `${s.name} กลับเป็นยังไม่ส่ง`);
  /** DEV ONLY (local Worker / test mode; the live Worker refuses it): clear today's statuses of this vehicle */
  const reset = () => act(() => devResetStoreVisits(plate), 'ล้างข้อมูลทดลองแล้ว');

  return (
    <div className="st">
      {import.meta.env.DEV && (
        <div className="st-dev" role="note">
          <span><b>โหมดพัฒนา</b> · ล้างสถานะร้านของรถ {plate} วันนี้ เพื่อทดสอบใหม่ (ใช้ได้เฉพาะเครื่องพัฒนา)</span>
          <ConfirmButton disabled={busy} onConfirm={reset}>ล้างข้อมูลทดลอง</ConfirmButton>
        </div>
      )}

      {/* the store being timed: one clock, starts when the truck parks, stops when it leaves */}
      {active && !active.endedAt && (
        <div className="st-run">
          <div className="st-run-head">
            <span className="sv-no">ร้านที่ {no}</span> <b>{active.storeName}</b>
            <div className="note">จอด {hhmm(active.startedAt)} น.{active.cases != null ? ` · ${casesText(active.cases)} ลัง` : ''}</div>
          </div>
          <div className="st-run-clock" role="timer" aria-live="off">
            <span>เวลาที่ร้านนี้</span>
            <b className="mono">{clock(visitSeconds(active))}</b>
          </div>
          <button type="button" className="btn work-btn sv-big end" disabled={busy} onClick={leave}>■ รถออกจากร้าน — จบร้านนี้</button>
          <ConfirmButton className="sv-cancel" disabled={busy} onConfirm={cancel} confirmText="แตะอีกครั้งเพื่อยกเลิกร้านนี้ (เวลาที่จับไว้จะหาย)">ยกเลิกร้านนี้</ConfirmButton>
        </div>
      )}
      {/* the truck left: the finish form (cases from the plan, can be corrected) */}
      {active?.endedAt && <EndVisit key={active.id} no={no} v={active} onSave={save} onResume={resume} hidePhases />}

      {/* not started work yet: the list and bills can be read, timing is locked */}
      {work === null && !active && (
        <div className="st-locked" role="status">
          <span><b>ยังไม่ได้เริ่มการทำงาน</b> — กด "เริ่มการทำงาน" ของรถ {plate} ก่อน จึงจะจับเวลาร้านค้าได้</span>
          {goWork && <button type="button" className="btn sm" onClick={goWork}>ไปที่บันทึกเวลาการทำงาน</button>}
        </div>
      )}
      {/* work ended: the day is closed, the list stays readable */}
      {ended && !active && (
        <div className="st-locked" role="status">
          <span><b>จบงานแล้ว{work?.ended ? ` (${work.ended} น.)` : ''}</b> — จับเวลาร้านค้าและเปลี่ยนสถานะร้านไม่ได้แล้ว</span>
        </div>
      )}

      <div className="row spread st-head">
        <b>ร้านในแผนวันนี้ · ส่งสำเร็จ {doneCount}/{stops.length}{failCount ? ` · ไม่สำเร็จ ${failCount}` : ''}</b>
      </div>

      <ul className="dl-list">
        {stops.map((s) => {
          const v = s.visit ?? null;
          const done = v?.status === 'done' ? v : null;
          const failed = v?.status === 'failed' ? v : null;
          const running = v?.status === 'open';
          // still open: can be started, or marked as not delivered
          const open = !v;
          const secs = done?.started_at && done.ended_at ? Math.max(0, (Date.parse(done.ended_at) - Date.parse(done.started_at)) / 1000) : 0;
          return (
            <li key={s.id} className={`dl-item st-item ${done ? 'done' : failed ? 'failed' : running ? 'running' : ''}`}>
              <span className="dl-ico" aria-hidden><StoreIcon /></span>
              <div className="dl-main">
                {/* the row stays short: name + buttons; code, type, address, bills and cases are in "ดูรายละเอียด" */}
                <b className="plan-store-name">{s.name}</b>
                <div className="st-actions">
                  {done ? (
                    <span className="st-status done">
                      ✓ ส่งสำเร็จ {done.started_at && hhmm(done.started_at)}–{done.ended_at && hhmm(done.ended_at)} น. · {minutes1(secs)} นาที · {casesText(done.cases)} ลัง
                    </span>
                  ) : failed ? (
                    <span className="st-status failed">
                      ✗ ส่งไม่สำเร็จ
                      <span className="st-fail-note">หมายเหตุ: {failed.note}</span>
                    </span>
                  ) : running ? (
                    <span className="st-status running">● กำลังส่ง — ดูตัวจับเวลาด้านบน</span>
                  ) : (
                    <button type="button" className="btn sm st-start" disabled={busy || !!active || !started}
                      title={ended ? 'จบงานแล้ว' : started ? undefined : 'กด "เริ่มการทำงาน" ก่อน'}
                      onClick={() => start(s)}>
                      ▶ รถจอดแล้ว — เริ่มส่งร้านนี้
                    </button>
                  )}
                  <button type="button" className="dl-bills-btn" aria-expanded={openIds.has(s.id)} onClick={() => toggle(s.id)}>
                    {openIds.has(s.id) ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'} <span className="plan-chev" aria-hidden>›</span>
                  </button>
                </div>
              </div>
              {/* not delivered: opens the note form · a wrong one can be put back (until "จบงาน") */}
              <div className="st-fail-cell">
                {open && (
                  <button type="button" className="btn sm st-fail-btn" disabled={busy || !!active || !started} aria-expanded={failFor === s.id}
                    onClick={() => { setFailFor(failFor === s.id ? null : s.id); setFailNote(''); }}>
                    ✗ ส่งไม่สำเร็จ
                  </button>
                )}
                {failed && !ended && (
                  <ConfirmButton className="btn ghost sm" disabled={busy} onConfirm={() => undoFailed(s)} confirmText="แตะอีกครั้งเพื่อยกเลิกสถานะ">ยกเลิกสถานะ</ConfirmButton>
                )}
              </div>
              {open && failFor === s.id && (
                <form className="st-fail-form" onSubmit={(e) => { e.preventDefault(); markFailed(s); }}>
                  <b>ส่งไม่สำเร็จ — {s.name}</b>
                  <label><span>หมายเหตุ <em className="req">*</em></span>
                    <textarea rows={2} maxLength={300} value={failNote} placeholder="เช่น ร้านปิดเพราะเจ้าของไม่อยู่ โทรแล้วไม่รับสาย"
                      onChange={(e) => setFailNote(e.target.value)} />
                  </label>
                  <div className="row">
                    <button type="submit" className="btn sm st-fail-submit" disabled={busy || !failNote.trim()}>บันทึกว่าส่งไม่สำเร็จ</button>
                    <button type="button" className="btn ghost sm st-fail-cancel" onClick={() => setFailFor(null)}>ยกเลิก</button>
                  </div>
                </form>
              )}
              {openIds.has(s.id) && (
                <div className="st-detail">
                  <dl className="st-detail-info">
                    <div><dt>รหัสร้าน</dt><dd className="mono">{s.code || '–'}</dd></div>
                    {/* where the store is: the address from the plan */}
                    <div className="st-loc">
                      <dt>ตำแหน่งร้าน</dt>
                      <dd>
                        {s.address
                          ? <span className="st-loc-text"><span className="ii" aria-hidden><PinIcon /></span>{s.address}</span>
                          : <span className="note">ยังไม่มีที่อยู่ในแผนส่ง</span>}
                      </dd>
                    </div>
                    <div><dt>ประเภท</dt><dd>{s.type ? storeTypeName(s.type as StoreType) : '–'}</dd></div>
                    <div><dt>จำนวนลัง</dt><dd><b className="mono">{casesText(s.cases)}</b> ลัง</dd></div>
                    {/* who pressed it (the data belongs to the vehicle) */}
                    {v?.by && <div><dt>บันทึกโดย</dt><dd>{v.by}</dd></div>}
                  </dl>
                  {s.bills.length > 0 && (
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
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* the day's timing summary (minutes per store / per case …) is for the admin page, not shown to staff */}
    </div>
  );
}
