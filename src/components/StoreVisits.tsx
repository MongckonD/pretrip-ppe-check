/**
 * Box 2 of Time activities: store-visit timer (Time & Motion). Separate from the work clock in boxes 1 and 3.
 *
 *   1. pick the store (or add a new one with its type) → "รถจอดหน้าร้าน — เริ่มจับเวลา" (starts A01)
 *   2. tap "ถัดไป" through A → B → C → D; tap any code to jump to it (B02/B03 can repeat for more trips)
 *   3. D05 "รถออกจากร้าน" stops the clock → enter cases / SKU / distance / how goods were moved → save
 *   4. today's stores: time per store, A/B/C/D split, minutes per case
 *
 * TRIAL VERSION: kept in this browser (localStorage), separately for each signed-in account, until the
 * database design is agreed. Nothing is sent to the server yet.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ACTIVITIES, END_CODE, MOVE_METHODS, PHASES, STORE_TYPES, activityName, clock, codeSeconds, hhmm, minutes1, nextCode,
  phaseOf, phaseSeconds, segSeconds, storeTypeName, visitSeconds,
  type MoveMethod, type Phase, type Store, type StoreType, type StoreVisit,
} from '../lib/storeVisit';
import { today } from '../lib/utils';
import { useMe } from './Auth';
import { useToast } from './Toast';

/* ---------------- prototype storage (this browser only) ---------------- */

/** one store per account on this browser (test mode has no login: 'test') */
const keyFor = (userId: string) => `store-visits-trial-v1:${userId}`;
interface Saved { stores: Store[]; visits: StoreVisit[]; active: StoreVisit | null }
const SAMPLE_STORES: Store[] = [
  { id: 's1', name: 'ร้านเจ๊หมวย ขายส่ง', type: 'wholesale' },
  { id: 's2', name: 'ร้านป้าแดง โชห่วย', type: 'general' },
  { id: 's3', name: 'ครัวคุณต๋อย', type: 'restaurant' },
  { id: 's4', name: 'โรงแรมริมน้ำ', type: 'hotel' },
];
function load(key: string): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null') as Saved | null;
    if (s?.stores) return s;
  } catch { /* fall through */ }
  return { stores: SAMPLE_STORES, visits: [], active: null };
}
function useSaved(key: string) {
  const [data, setData] = useState<Saved>(() => load(key));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* storage unavailable */ } }, [key, data]);
  return [data, setData] as const;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const nowIso = () => new Date().toISOString();

/** re-render every second while `on` */
function useTick(on: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setT((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

/* ---------------- main box ---------------- */

export function StoreVisits({ plate }: { plate: string }) {
  const toast = useToast();
  const me = useMe();
  const [data, setData] = useSaved(keyFor(me?.id ?? 'test'));
  const active = data.active;
  // after D05 the visit has endedAt: show the quantities form (survives a tab switch or refresh)
  const ending = !!active?.endedAt;
  useTick(!!active && !active.endedAt);
  // the store just saved, shown above the "next store" picker
  const [justSaved, setJustSaved] = useState<{ name: string; no: number } | null>(null);

  const todays = data.visits.filter((v) => v.date === today() && v.plate === plate);
  const nextNo = todays.length + 1;
  const doneIds = new Set(todays.map((v) => v.storeId));
  // the store the truck last left today: travel to the next store runs from its D05
  const prev = todays.length ? todays[todays.length - 1] : null;
  // live travel timer while choosing the next store
  useTick(!active && !!prev?.endedAt);

  function start(store: Store) {
    const t = nowIso();
    const travelFrom = prev?.endedAt
      ? { visitId: prev.id, storeName: prev.storeName, seconds: Math.max(0, Math.round((Date.parse(t) - Date.parse(prev.endedAt)) / 1000)) }
      : undefined;
    setData((d) => ({
      ...d,
      active: {
        id: uid(), date: today(), plate, storeId: store.id, storeName: store.name, storeType: store.type,
        startedAt: t, segments: [{ code: 'A01', start: t }], travelFrom,
      },
    }));
    setJustSaved(null);
    toast(`เริ่มจับเวลา ${store.name}`);
  }

  /** close the running activity and start `code`; D05 stops the clock */
  function go(code: string) {
    if (!active || active.endedAt) return;
    const t = nowIso();
    const closed = active.segments.map((s) => (s.end ? s : { ...s, end: t }));
    if (code === END_CODE) {
      setData((d) => ({ ...d, active: { ...active, segments: [...closed, { code, start: t, end: t }], endedAt: t } }));
      return;
    }
    setData((d) => ({ ...d, active: { ...active, segments: [...closed, { code, start: t }] } }));
  }

  function cancel() {
    if (!window.confirm('ยกเลิกการจับเวลาร้านนี้? เวลาที่จับไว้จะหายทั้งหมด')) return;
    setData((d) => ({ ...d, active: null }));
  }

  function save(extra: Pick<StoreVisit, 'cases' | 'skus' | 'distanceM' | 'method'>) {
    if (!active) return;
    setData((d) => ({ ...d, visits: [...d.visits, { ...active, ...extra }], active: null }));
    setJustSaved({ name: active.storeName, no: nextNo });
    toast(`บันทึก ${active.storeName} แล้ว — เลือกร้านถัดไปได้เลย`);
  }

  /** TRIAL ONLY: clear every store, visit and running timer of this account in this browser (sample stores come back) */
  function resetTrial() {
    if (!window.confirm(
      'รีเซ็ตข้อมูลทดลองทั้งหมด?\n\n• ร้านที่เพิ่มเอง จะหาย (กลับเป็นร้านตัวอย่าง 4 ร้าน)\n• ร้านที่ส่งแล้วและเวลาที่จับไว้ทุกวัน จะหาย\n• ร้านที่กำลังจับเวลาอยู่ จะถูกยกเลิก\n\nมีผลเฉพาะเครื่องนี้และบัญชีนี้ ไม่กระทบข้อมูลอื่นในระบบ',
    )) return;
    setData({ stores: SAMPLE_STORES, visits: [], active: null });
    setJustSaved(null);
    toast('รีเซ็ตข้อมูลทดลองแล้ว');
  }

  /** undo D05 (pressed by mistake): the last activity keeps running */
  function resume() {
    if (!active) return;
    const segs = active.segments.filter((s) => s.code !== END_CODE);
    const last = segs[segs.length - 1];
    setData((d) => ({ ...d, active: { ...active, endedAt: undefined, segments: [...segs.slice(0, -1), { ...last, end: undefined }] } }));
  }

  return (
    <>
      <div className="sv-trial" role="note">
        <span><b>ทดลองใช้</b> ข้อมูลร้านและเวลาที่จับเก็บไว้ในเครื่องนี้เท่านั้น ยังไม่ส่งเข้าระบบ — ใช้ดูหน้าตาและลองกดก่อนออกแบบฐานข้อมูลจริง</span>
        {/* trial only: wipe this account's trial data in this browser and start over */}
        <button type="button" className="btn danger sm" onClick={resetTrial}>รีเซ็ตข้อมูลทดลอง</button>
      </div>
      <p className="note flush-note">
        จับเวลาแยกจากเวลาเริ่มงาน · เริ่มเมื่อ<b>รถจอดหน้าร้าน</b> จบเมื่อ<b>รถออกจากร้าน</b> · รถ {plate}
      </p>

      {!active && justSaved && (
        <div className="sv-saved" role="status">
          ✓ บันทึกร้านที่ {justSaved.no} <b>{justSaved.name}</b> แล้ว — เลือก<b>ร้านที่ {nextNo}</b> ด้านล่าง แล้วกดเริ่มเมื่อรถจอดหน้าร้าน
        </div>
      )}
      {!active && prev?.endedAt && (
        <div className="sv-travel" role="timer" aria-live="off">
          <span>🚚 กำลังเดินทางไปร้านที่ {nextNo}</span>
          <b className="mono">{clock(Math.max(0, Math.round((Date.now() - Date.parse(prev.endedAt)) / 1000)))}</b>
          <span className="note">ออกจากร้านที่ {todays.length} {prev.storeName} เมื่อ {hhmm(prev.endedAt)} น. · หยุดนับเมื่อกดเริ่มร้านถัดไป</span>
        </div>
      )}
      {!active && <StartVisit no={nextNo} stores={data.stores} doneIds={doneIds} onStart={start}
        onAddStore={(s) => setData((d) => ({ ...d, stores: [...d.stores, s] }))} />}

      {active && !ending && <RunningVisit no={nextNo} v={active} onGo={go} onCancel={cancel} />}
      {active && ending && <EndVisit no={nextNo} v={active} onSave={save} onResume={resume} />}

      <TodayVisits visits={todays} />
    </>
  );
}

/* ---------------- 1. choose store and start ---------------- */

function StartVisit({ no, stores, doneIds, onStart, onAddStore }: {
  no: number; stores: Store[]; doneIds: Set<string>; onStart: (s: Store) => void; onAddStore: (s: Store) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Store | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<StoreType | ''>('');
  const ql = q.trim().toLowerCase();
  const shown = stores.filter((s) => !ql || s.name.toLowerCase().includes(ql));

  function add() {
    const n = name.trim();
    if (!n || !type) return;
    const s = { id: uid(), name: n, type };
    onAddStore(s); setSel(s); setAdding(false); setName(''); setType(''); setQ('');
  }

  return (
    <div className="sv-start">
      <div className="mini-head"><span className="sv-no">ร้านที่ {no}</span> เลือกร้านที่จะส่ง</div>
      {!adding ? (
        <>
          <input type="search" placeholder="ค้นหาชื่อร้าน…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาชื่อร้าน" />
          <div className="sv-store-list" role="listbox" aria-label="ร้านค้า">
            {shown.map((s) => (
              <button key={s.id} type="button" role="option" aria-selected={sel?.id === s.id}
                className={`sv-store ${sel?.id === s.id ? 'on' : ''}`} onClick={() => setSel(s)}>
                <b>{s.name}</b>
                <span className="sv-store-tags">
                  {doneIds.has(s.id) && <span className="sv-done">ส่งแล้ววันนี้</span>}
                  <span className={`sv-type t-${s.type}`}>{storeTypeName(s.type)}</span>
                </span>
              </button>
            ))}
            {!shown.length && <div className="note">ไม่พบร้าน "{q}"</div>}
          </div>
          <button type="button" className="btn ghost sm" onClick={() => { setAdding(true); setName(q); }}>+ เพิ่มร้านใหม่</button>
        </>
      ) : (
        <div className="sv-add">
          <label>ชื่อร้าน<input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ร้านสมใจ" autoFocus /></label>
          <div className="ro-label">ประเภทร้านค้า</div>
          <div className="sv-types">
            {STORE_TYPES.map((t) => (
              <button key={t.code} type="button" aria-pressed={type === t.code} className={`t-${t.code}`} onClick={() => setType(t.code)}>
                <b>{t.name}</b><span>{t.en}</span>
              </button>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn sm" disabled={!name.trim() || !type} onClick={add}>เพิ่มร้าน</button>
            <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>ยกเลิก</button>
          </div>
        </div>
      )}
      <button type="button" className="btn work-btn sv-go" disabled={!sel || adding} onClick={() => sel && onStart(sel)}>
        ▶ รถจอดหน้าร้านที่ {no} — เริ่มจับเวลา{sel ? ` (${sel.name})` : ''}
      </button>
    </div>
  );
}

/* ---------------- 2. running: tap through the activities ---------------- */

function RunningVisit({ no, v, onGo, onCancel }: { no: number; v: StoreVisit; onGo: (code: string) => void; onCancel: () => void }) {
  const cur = v.segments[v.segments.length - 1];
  const next = nextCode(cur.code);
  const per = phaseSeconds(v);
  const byCode = codeSeconds(v);
  const [open, setOpen] = useState<Phase>(phaseOf(cur.code));
  useEffect(() => { setOpen(phaseOf(cur.code)); }, [cur.code]);

  return (
    <div className="sv-run">
      <div className="sv-head">
        <div>
          <span className="sv-no">ร้านที่ {no}</span> <b>{v.storeName}</b> <span className={`sv-type t-${v.storeType}`}>{storeTypeName(v.storeType)}</span>
          <div className="note">
            รถจอดเมื่อ {hhmm(v.startedAt)} น.
            {v.travelFrom && <> · เดินทางจากร้านที่ {no - 1} ใช้ <b>{minutes1(v.travelFrom.seconds)} นาที</b></>}
          </div>
        </div>
        <div className="sv-total" role="timer" aria-live="off"><span>เวลาที่ร้านนี้</span><b>{clock(visitSeconds(v))}</b></div>
      </div>

      <PhaseBar per={per} current={phaseOf(cur.code)} />

      <div className={`sv-now p-${phaseOf(cur.code)}`}>
        <span className="sv-now-label">กำลังทำ</span>
        <div className="sv-now-row">
          <div><b className="mono">{cur.code}</b> {activityName(cur.code)}</div>
          <b className="mono sv-now-time">{clock(segSeconds(cur))}</b>
        </div>
      </div>

      {next && (
        <button type="button" className={`btn work-btn sv-next ${next === END_CODE ? 'end' : ''}`} onClick={() => onGo(next)}>
          {next === END_CODE ? '■ รถออกจากร้าน — จบการจับเวลา (D05)' : <>ถัดไป ▶ <span className="mono">{next}</span> {activityName(next)}</>}
        </button>
      )}

      <div className="sv-acts">
        {PHASES.map((p) => (
          <div key={p.code} className={`sv-phase p-${p.code}`}>
            <button type="button" className="sv-phase-head" aria-expanded={open === p.code} onClick={() => setOpen(p.code)}>
              <span className="sv-dot" />{p.code} {p.name}<span className="mono sv-phase-time">{clock(per[p.code])}</span>
            </button>
            {open === p.code && (
              <ul>
                {ACTIVITIES.filter((a) => phaseOf(a.code) === p.code).map((a) => {
                  const running = a.code === cur.code;
                  const done = byCode[a.code] !== undefined && !running;
                  return (
                    <li key={a.code}>
                      <button type="button" className={`sv-act ${running ? 'running' : done ? 'done' : ''}`}
                        disabled={running} onClick={() => onGo(a.code)}
                        title={running ? 'กำลังทำ' : 'กดเพื่อเปลี่ยนมาทำกิจกรรมนี้'}>
                        <span className="mono">{a.code}</span>
                        <span className="sv-act-name">{a.name}</span>
                        <span className="mono">{byCode[a.code] !== undefined ? clock(byCode[a.code]) : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="row spread">
        <span className="note">กดรหัสไหนก็ได้เพื่อข้ามหรือย้อนไปทำซ้ำ (เช่น เดินยกหลายรอบ)</span>
        <button type="button" className="btn danger sm" onClick={onCancel}>ยกเลิกร้านนี้</button>
      </div>
    </div>
  );
}

function PhaseBar({ per, current }: { per: Record<Phase, number>; current?: Phase }) {
  const total = PHASES.reduce((s, p) => s + per[p.code], 0) || 1;
  return (
    <div className="sv-bar" aria-label="เวลาแยกตามช่วง">
      {PHASES.map((p) => per[p.code] > 0 && (
        <div key={p.code} className={`p-${p.code} ${current === p.code ? 'cur' : ''}`} style={{ flexGrow: per[p.code] / total }}
          title={`${p.code} ${p.name} ${minutes1(per[p.code])} นาที`}>
          <span>{p.code} {minutes1(per[p.code])}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 3. truck left: quantities ---------------- */

function EndVisit({ no, v, onSave, onResume }: {
  no: number; v: StoreVisit; onSave: (x: Pick<StoreVisit, 'cases' | 'skus' | 'distanceM' | 'method'>) => void; onResume: () => void;
}) {
  const [cases, setCases] = useState('');
  const [skus, setSkus] = useState('');
  const [dist, setDist] = useState('');
  const [method, setMethod] = useState<MoveMethod | ''>('');
  const secs = visitSeconds(v);
  const n = Number(cases);
  const ok = cases !== '' && Number.isInteger(n) && n >= 0 && method !== '';

  return (
    <div className="sv-end">
      <div className="sv-head">
        <div><span className="sv-no">ร้านที่ {no}</span> <b>{v.storeName}</b> <span className={`sv-type t-${v.storeType}`}>{storeTypeName(v.storeType)}</span>
          <div className="note">{hhmm(v.startedAt)} – {v.endedAt && hhmm(v.endedAt)} น.</div></div>
        <div className="sv-total"><span>เวลารวม</span><b>{minutes1(secs)} นาที</b></div>
      </div>
      <PhaseBar per={phaseSeconds(v)} />
      <div className="fields c4">
        <label>จำนวนสินค้า (ลัง) *<input inputMode="numeric" value={cases} onChange={(e) => setCases(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
        <label>จำนวน SKU<input inputMode="numeric" value={skus} onChange={(e) => setSkus(e.target.value.replace(/\D/g, ''))} /></label>
        <label>ระยะทางรถ → จุดรับ (เมตร)<input inputMode="numeric" value={dist} onChange={(e) => setDist(e.target.value.replace(/\D/g, ''))} /></label>
        <div>
          <span className="ro-label">วิธีขนย้าย *</span>
          <div className="seg compact">
            {MOVE_METHODS.map((m) => (
              <button key={m.code} type="button" aria-pressed={method === m.code} onClick={() => setMethod(m.code)}>{m.name}</button>
            ))}
          </div>
        </div>
      </div>
      {n > 0 && <div className="note">≈ {(secs / 60 / n).toFixed(2)} นาทีต่อลัง</div>}
      <div className="row spread">
        <button type="button" className="btn ghost sm" onClick={onResume}>กด D05 ผิด — กลับไปจับเวลาต่อ</button>
        <button type="button" className="btn" disabled={!ok}
          onClick={() => onSave({ cases: n, skus: skus ? Number(skus) : undefined, distanceM: dist ? Number(dist) : undefined, method: method || undefined })}>
          บันทึกร้านนี้ แล้วไปร้านถัดไป
        </button>
      </div>
    </div>
  );
}

/* ---------------- 4. today's stores ---------------- */

function TodayVisits({ visits }: { visits: StoreVisit[] }) {
  const totals = useMemo(() => {
    const secs = visits.reduce((s, v) => s + visitSeconds(v), 0);
    const cases = visits.reduce((s, v) => s + (v.cases ?? 0), 0);
    const legs = visits.filter((v) => v.travelFrom);
    const travel = legs.reduce((s, v) => s + (v.travelFrom?.seconds ?? 0), 0);
    return { secs, cases, legs: legs.length, travel };
  }, [visits]);
  if (!visits.length) return <div className="empty sv-empty">วันนี้ยังไม่มีร้านที่จับเวลาเสร็จ</div>;
  return (
    <div className="sv-today">
      <div className="mini-head">ร้านที่ส่งแล้ววันนี้</div>
      <div className="sv-today-kpis">
        <span><b>{visits.length}</b> ร้าน</span>
        <span><b>{minutes1(totals.secs)}</b> นาทีรวม</span>
        <span><b>{minutes1(totals.secs / visits.length)}</b> นาที/ร้าน</span>
        <span><b>{totals.cases}</b> ลัง</span>
        {totals.cases > 0 && <span><b>{(totals.secs / 60 / totals.cases).toFixed(2)}</b> นาที/ลัง</span>}
        {totals.legs > 0 && <span>🚚 <b>{minutes1(totals.travel)}</b> นาทีเดินทางรวม</span>}
        {totals.legs > 0 && <span><b>{minutes1(totals.travel / totals.legs)}</b> นาที/ช่วงเดินทาง</span>}
      </div>
      <ul className="sv-list">
        {visits.map((v, i) => ({ v, no: i + 1 })).reverse().map(({ v, no }) => {
          const secs = visitSeconds(v);
          return (
            <li key={v.id}>
              {v.travelFrom && (
                <div className="sv-leg">🚚 เดินทางจากร้านที่ {no - 1} ({v.travelFrom.storeName}) <b className="mono">{minutes1(v.travelFrom.seconds)} นาที</b></div>
              )}
              <div className="row spread">
                <div><span className="sv-no">ร้านที่ {no}</span> <b>{v.storeName}</b> <span className={`sv-type t-${v.storeType}`}>{storeTypeName(v.storeType)}</span></div>
                <b className="mono">{minutes1(secs)} นาที</b>
              </div>
              <div className="note">
                {hhmm(v.startedAt)}–{v.endedAt && hhmm(v.endedAt)} น. · {v.cases ?? 0} ลัง
                {v.cases ? ` · ${(secs / 60 / v.cases).toFixed(2)} นาที/ลัง` : ''}
                {v.skus ? ` · ${v.skus} SKU` : ''}{v.distanceM ? ` · ${v.distanceM} ม.` : ''}
                {v.method ? ` · ${MOVE_METHODS.find((m) => m.code === v.method)?.name}` : ''}
              </div>
              <PhaseBar per={phaseSeconds(v)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
