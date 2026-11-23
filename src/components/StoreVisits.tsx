/**
 * Box 2 of Time activities: store-visit timer (Time & Motion). Separate from the work clock in boxes 1 and 3.
 *
 *   1. pick the store (search, or add a new one with its type) and type in cases / SKU / distance / how goods
 *      are moved → "รถจอดหน้าร้านแล้ว — เริ่มจับเวลา" (starts A01)
 *   2. tap "ถัดไป" through A → B → C → D; tap any code to jump to it (B02/B03 can repeat for more trips)
 *   3. D05 "รถออกจากร้าน" stops the clock → check the delivery details (edit if needed) → save
 *   4. today's stores: time per store, A/B/C/D split, minutes per case
 *
 * TRIAL VERSION: kept in this browser (localStorage), separately for each signed-in account, until the
 * database design is agreed. Nothing is sent to the server yet.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertIcon, BoxIcon, CartIcon, PhoneIcon, PinIcon, RepeatIcon, SearchIcon, StoreIcon, TruckIcon, UserIcon } from './Icons';
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
  { id: 's1', name: 'ร้านเจ๊หมวย ขายส่ง', type: 'wholesale', address: '45/2 ถ.เพชรเกษม ตลาดบางแค', contact: 'เจ๊หมวย', phone: '081-234-5678',
    note: 'ลงของหลังร้าน ทางเข้าซอยข้างร้านทอง · ปิดเที่ยง 12:00–13:00' },
  { id: 's2', name: 'ร้านป้าแดง โชห่วย', type: 'general', address: '12 ซ.วัดนิมมานรดี ภาษีเจริญ', contact: 'ป้าแดง', phone: '089-111-2233',
    note: 'จอดหน้าร้านได้ ระวังสายไฟต่ำ' },
  { id: 's3', name: 'ครัวคุณต๋อย', type: 'restaurant', address: '88 ถ.กาญจนาภิเษก (ฝั่งขาออก)', contact: 'คุณต๋อย', phone: '062-555-0198',
    note: 'ส่งเข้าครัวด้านหลัง ก่อน 10:00 เท่านั้น · แช่ตู้เย็นให้ด้วย' },
  { id: 's4', name: 'โรงแรมริมน้ำ', type: 'hotel', address: '199 ถ.เจริญนคร คลองสาน', contact: 'แผนกจัดซื้อ (คุณนก)', phone: '02-437-0000',
    note: 'เข้าทางลานจอดพนักงาน แลกบัตรที่ป้อม รปภ. · ลิฟต์ขนของชั้น B1' },
];
function load(key: string): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null') as Saved | null;
    if (s?.stores) {
      // trial data saved before stores had details: fill the sample stores' details in
      const sample = new Map(SAMPLE_STORES.map((x) => [x.id, x]));
      return { ...s, stores: s.stores.map((x) => { const d = sample.get(x.id); return d ? { ...d, ...x, ...pickDetails(x, d) } : x; }) };
    }
  } catch { /* fall through */ }
  return { stores: SAMPLE_STORES, visits: [], active: null };
}
function useSaved(key: string) {
  const [data, setData] = useState<Saved>(() => load(key));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* storage unavailable */ } }, [key, data]);
  return [data, setData] as const;
}
/** keep the store's own details, fall back to the sample's */
function pickDetails(x: Store, d: Store): Partial<Store> {
  return { address: x.address ?? d.address, contact: x.contact ?? d.contact, phone: x.phone ?? d.phone, note: x.note ?? d.note };
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
  // stores already delivered today: hidden from the picker, cannot be chosen again
  const doneToday: DoneToday = new Map(todays.map((v, i) => [v.storeId, { no: i + 1, at: v.endedAt ?? v.startedAt }]));
  // the store the truck last left today: travel to the next store runs from its D05
  const prev = todays.length ? todays[todays.length - 1] : null;
  // live travel timer while choosing the next store
  useTick(!active && !!prev?.endedAt);

  function start(store: Store, delivery: Delivery) {
    if (doneToday.has(store.id)) { toast(`${store.name} ส่งไปแล้ววันนี้ — เลือกร้านอื่น`); return; }
    const t = nowIso();
    const travelFrom = prev?.endedAt
      ? { visitId: prev.id, storeName: prev.storeName, seconds: Math.max(0, Math.round((Date.parse(t) - Date.parse(prev.endedAt)) / 1000)) }
      : undefined;
    setData((d) => ({
      ...d,
      active: {
        id: uid(), date: today(), plate, storeId: store.id, storeName: store.name, storeType: store.type,
        startedAt: t, segments: [{ code: 'A01', start: t }], travelFrom, ...delivery,
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

  /** a wrong tap: drop the running step and carry on with the one before it */
  function undo() {
    if (!active || active.endedAt || active.segments.length < 2) return;
    const segs = active.segments.slice(0, -1);
    const last = segs[segs.length - 1];
    setData((d) => ({ ...d, active: { ...active, segments: [...segs.slice(0, -1), { ...last, end: undefined }] } }));
  }

  function cancel() {
    if (!window.confirm('ยกเลิกการจับเวลาร้านนี้? เวลาที่จับไว้จะหายทั้งหมด')) return;
    setData((d) => ({ ...d, active: null }));
  }

  function save(extra: Delivery) {
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
          <span><span className="ii" aria-hidden><TruckIcon /></span>กำลังเดินทางไปร้านที่ {nextNo}</span>
          <b className="mono">{clock(Math.max(0, Math.round((Date.now() - Date.parse(prev.endedAt)) / 1000)))}</b>
          <span className="note">ออกจากร้านที่ {todays.length} {prev.storeName} เมื่อ {hhmm(prev.endedAt)} น. · หยุดนับเมื่อกดเริ่มร้านถัดไป</span>
        </div>
      )}
      {!active && <StartVisit no={nextNo} stores={data.stores} visits={data.visits} doneToday={doneToday} onStart={start}
        onAddStore={(s) => setData((d) => ({ ...d, stores: [...d.stores, s] }))} />}

      {active && !ending && <RunningVisit no={nextNo} v={active} onGo={go} onUndo={undo} onCancel={cancel} />}
      {active && ending && <EndVisit no={nextNo} v={active} onSave={save} onResume={resume} />}

      <TodayVisits visits={todays} />
    </>
  );
}

/* ---------------- 1. choose store and start ---------------- */

/** delivery details, typed in when the store is chosen (can still be corrected after D05) */
export type Delivery = Pick<StoreVisit, 'cases' | 'skus' | 'distanceM' | 'method'>;
interface DeliveryDraft { cases: string; skus: string; dist: string; method: MoveMethod | '' }
const draftOf = (v?: Delivery): DeliveryDraft => ({
  cases: v?.cases != null ? String(v.cases) : '', skus: v?.skus != null ? String(v.skus) : '',
  dist: v?.distanceM != null ? String(v.distanceM) : '', method: v?.method ?? '',
});
const draftOk = (d: DeliveryDraft) => d.cases !== '' && d.method !== '';
const deliveryOf = (d: DeliveryDraft): Delivery => ({
  cases: Number(d.cases), skus: d.skus ? Number(d.skus) : undefined,
  distanceM: d.dist ? Number(d.dist) : undefined, method: d.method || undefined,
});
const methodName = (m?: MoveMethod) => MOVE_METHODS.find((x) => x.code === m)?.name;
const digits = (s: string) => s.replace(/\D/g, '');

function DeliveryFields({ d, set, autoFocus }: { d: DeliveryDraft; set: (d: DeliveryDraft) => void; autoFocus?: boolean }) {
  return (
    <div className="sv-delivery">
      <div className="fields c3">
        <label><span>จำนวนสินค้า (ลัง) <span className="req">*</span></span>
          <input inputMode="numeric" placeholder="0" value={d.cases} autoFocus={autoFocus}
            onChange={(e) => set({ ...d, cases: digits(e.target.value) })} /></label>
        <label>จำนวน SKU
          <input inputMode="numeric" placeholder="ไม่บังคับ" value={d.skus} onChange={(e) => set({ ...d, skus: digits(e.target.value) })} /></label>
        <label>ระยะทางรถ → จุดรับ (เมตร)
          <input inputMode="numeric" placeholder="ไม่บังคับ" value={d.dist} onChange={(e) => set({ ...d, dist: digits(e.target.value) })} /></label>
      </div>
      <div>
        <span className="ro-label">วิธีขนย้าย <span className="req">*</span></span>
        <div className="sv-methods" role="radiogroup" aria-label="วิธีขนย้าย">
          {MOVE_METHODS.map((m) => (
            <button key={m.code} type="button" role="radio" aria-checked={d.method === m.code} onClick={() => set({ ...d, method: m.code })}>
              <span className="ii" aria-hidden>{m.code === 'trolley' ? <CartIcon /> : m.code === 'carry' ? <BoxIcon /> : <><CartIcon /><BoxIcon /></>}</span>{m.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** past deliveries to one store (every day kept on this device) */
interface StoreHistory { count: number; avgSec: number; avgCases: number; last: StoreVisit }
function historyOf(visits: StoreVisit[]): Map<string, StoreHistory> {
  const by = new Map<string, StoreVisit[]>();
  for (const v of visits) by.set(v.storeId, [...(by.get(v.storeId) ?? []), v]);
  const out = new Map<string, StoreHistory>();
  for (const [id, vs] of by) {
    out.set(id, {
      count: vs.length,
      avgSec: vs.reduce((a, v) => a + visitSeconds(v), 0) / vs.length,
      avgCases: vs.reduce((a, v) => a + (v.cases ?? 0), 0) / vs.length,
      last: vs.reduce((a, v) => (v.startedAt > a.startedAt ? v : a)),
    });
  }
  return out;
}
/** ISO → "11/19" (month/day, like the admin reports) */
const md = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

/** full details of the chosen store */
function StoreCard({ s, h, doneToday, onChange }: { s: Store; h?: StoreHistory; doneToday: boolean; onChange: () => void }) {
  return (
    <div className="sv-card">
      <div className="sv-card-top">
        <span className="sv-picked-ico" aria-hidden><StoreIcon /></span>
        <div className="sv-picked-name">
          <b>{s.name}</b>
          <span className="sv-store-tags">
            <span className={`sv-type t-${s.type}`}>{storeTypeName(s.type)}</span>
            {doneToday && <span className="sv-done">ส่งแล้ววันนี้</span>}
          </span>
        </div>
        <button type="button" className="btn ghost sm" onClick={onChange}>เปลี่ยนร้าน</button>
      </div>
      <dl className="sv-info">
        <div><dt><span className="ii" aria-hidden><PinIcon /></span>ที่อยู่</dt><dd>{s.address || '–'}</dd></div>
        <div><dt><span className="ii" aria-hidden><UserIcon /></span>ผู้ติดต่อ</dt><dd>{s.contact || '–'}
          {s.phone && <> · <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}><span className="ii" aria-hidden><PhoneIcon /></span>{s.phone}</a></>}</dd></div>
        {s.note && <div className="warn"><dt><span className="warn-ico" aria-hidden><AlertIcon /></span>จุดลงของ / หมายเหตุ</dt><dd>{s.note}</dd></div>}
      </dl>
      <div className="sv-hist">
        {h ? (<>
          <span><b>{h.count}</b> ครั้งที่ส่ง</span>
          <span><b>{minutes1(h.avgSec)}</b> นาที/ครั้ง</span>
          <span><b>{Math.round(h.avgCases)}</b> ลัง/ครั้ง</span>
          <span>ล่าสุด <b>{md(h.last.startedAt)}</b> · {h.last.cases ?? 0} ลัง · {minutes1(visitSeconds(h.last))} นาที</span>
        </>) : <span>ยังไม่เคยส่งร้านนี้</span>}
      </div>
    </div>
  );
}

/** store id → which store of the day it was, and when the truck left */
type DoneToday = Map<string, { no: number; at: string }>;

function StartVisit({ no, stores, visits, doneToday, onStart, onAddStore }: {
  no: number; stores: Store[]; visits: StoreVisit[]; doneToday: DoneToday; onStart: (s: Store, d: Delivery) => void; onAddStore: (s: Store) => void;
}) {
  const hist = useMemo(() => historyOf(visits), [visits]);
  const [more, setMore] = useState({ address: '', contact: '', phone: '', note: '' });
  const [mode, setMode] = useState<'list' | 'new'>('list');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Store | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<StoreType | ''>('');
  const [d, setD] = useState<DeliveryDraft>(draftOf());
  const ql = q.trim().toLowerCase();
  const match = (s: Store) => !ql || [s.name, s.address, s.contact].some((x) => (x ?? '').toLowerCase().includes(ql));
  // stores delivered today are taken off the list (one delivery per store per day)
  const shown = stores.filter((s) => !doneToday.has(s.id) && match(s));
  const doneHits = stores.filter((s) => doneToday.has(s.id) && match(s)).sort((a, b) => doneToday.get(a.id)!.no - doneToday.get(b.id)!.no);
  const doneLine = (s: Store) => { const x = doneToday.get(s.id)!; return `ร้านที่ ${x.no} · ออกจากร้าน ${hhmm(x.at)} น.`; };
  const same = stores.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
  const sameDone = !!same && doneToday.has(same.id);

  function openNew(prefill = '') { setMode('new'); setName(prefill); setType(''); }
  function addNew() {
    const n = name.trim();
    if (!n || !type) return;
    const t = (x: string) => x.trim() || undefined;
    const s: Store = { id: uid(), name: n, type, address: t(more.address), contact: t(more.contact), phone: t(more.phone), note: t(more.note) };
    onAddStore(s); setSel(s); setMode('list'); setName(''); setType(''); setQ('');
    setMore({ address: '', contact: '', phone: '', note: '' });
  }

  const missing = [!sel && 'เลือกร้าน', d.cases === '' && 'จำนวนลัง', d.method === '' && 'วิธีขนย้าย'].filter(Boolean) as string[];

  return (
    <div className="sv-start">
      {/* step 1: which store */}
      <section className={`sv-step ${sel ? 'done' : 'cur'}`}>
        <div className="sv-step-head">
          <span className="sv-step-no">{sel ? '✓' : '1'}</span>เลือกร้าน
          <span className="sv-no">ร้านที่ {no}</span>
        </div>

        {sel ? (
          <StoreCard s={sel} h={hist.get(sel.id)} doneToday={doneToday.has(sel.id)} onChange={() => setSel(null)} />
        ) : (
          <>
            <div className="sv-mode" role="tablist" aria-label="วิธีเลือกร้าน">
              <button type="button" role="tab" aria-selected={mode === 'list'} onClick={() => setMode('list')}><span className="ii" aria-hidden><SearchIcon /></span>ร้านที่มีในระบบ</button>
              <button type="button" role="tab" aria-selected={mode === 'new'} onClick={() => openNew(q)}>＋ ร้านใหม่</button>
            </div>

            {mode === 'list' ? (
              <>
                <input type="search" placeholder="ค้นหาชื่อร้าน ที่อยู่ หรือผู้ติดต่อ…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาชื่อร้าน" />
                <div className="sv-store-list" role="listbox" aria-label="ร้านค้า">
                  {shown.map((s) => (
                    <button key={s.id} type="button" role="option" aria-selected={false} className="sv-store" onClick={() => setSel(s)}>
                      <span className="sv-store-name">
                        <span className="sv-store-line"><b>{s.name}</b><span className={`sv-type t-${s.type}`}>{storeTypeName(s.type)}</span></span>
                        {s.address && <small><span className="ii" aria-hidden><PinIcon /></span>{s.address}</small>}
                        <small>
                          {hist.has(s.id) ? <>ส่งแล้ว {hist.get(s.id)!.count} ครั้ง · เฉลี่ย {minutes1(hist.get(s.id)!.avgSec)} นาที</> : 'ยังไม่เคยส่ง'}
                        </small>
                      </span>
                      <span className="sv-chev" aria-hidden>›</span>
                    </button>
                  ))}
                </div>
                {!shown.length && !ql && (
                  <div className="sv-notfound"><span>ส่งครบทุกร้านในรายการแล้ววันนี้ — ถ้ามีร้านอื่น กด “＋ ร้านใหม่”</span></div>
                )}
                {!shown.length && ql && !doneHits.length && (
                  <div className="sv-notfound">
                    <span>ไม่พบร้าน “{q.trim()}”</span>
                    <button type="button" className="btn sm" onClick={() => openNew(q.trim())}>＋ เพิ่ม “{q.trim()}” เป็นร้านใหม่</button>
                  </div>
                )}
                {/* searched for a store that is already done: say so instead of "not found" */}
                {ql && doneHits.length > 0 && (
                  <div className="sv-already" role="status">
                    {doneHits.map((s) => (
                      <div key={s.id}><span className="warn-ico" aria-hidden><AlertIcon /></span><b>{s.name}</b> ส่งไปแล้ววันนี้ ({doneLine(s)}) — เลือกซ้ำไม่ได้</div>
                    ))}
                  </div>
                )}
                {!ql && doneToday.size > 0 && (
                  <div className="note sv-hidden-note">
                    ✓ ซ่อนร้านที่ส่งแล้ววันนี้ {doneToday.size} ร้าน: {stores.filter((s) => doneToday.has(s.id)).map((s) => s.name).join(', ')}
                  </div>
                )}
              </>
            ) : (
              <div className="sv-add">
                <label>ชื่อร้าน<input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ร้านสมใจ" autoFocus /></label>
                {same && (sameDone ? (
                  <div className="sv-already" role="status">
                    <div><span className="warn-ico" aria-hidden><AlertIcon /></span><b>{same.name}</b> มีในระบบและส่งไปแล้ววันนี้ ({doneLine(same)}) — เพิ่มหรือเลือกซ้ำไม่ได้</div>
                  </div>
                ) : (
                  <div className="sv-same">
                    <span>มีร้าน <b>{same.name}</b> ในระบบแล้ว — ไม่ต้องเพิ่มซ้ำ</span>
                    <button type="button" className="btn ghost sm" onClick={() => { setSel(same); setMode('list'); setName(''); }}>ใช้ร้านนี้</button>
                  </div>
                ))}
                <label>ประเภทร้านค้า
                  <select value={type} onChange={(e) => setType(e.target.value as StoreType | '')}>
                    <option value="" disabled>— เลือกประเภทร้านค้า —</option>
                    {STORE_TYPES.map((t) => <option key={t.code} value={t.code}>{t.name} ({t.en})</option>)}
                  </select>
                </label>
                <div className="sv-more-body">
                  <span className="sv-more-head">รายละเอียดร้าน <small>(ไม่บังคับ)</small></span>
                  <label>ที่อยู่<input value={more.address} onChange={(e) => setMore({ ...more, address: e.target.value })} placeholder="เลขที่ ถนน แขวง/ตำบล" /></label>
                  <div className="sv-two">
                    <label>ผู้ติดต่อ<input value={more.contact} onChange={(e) => setMore({ ...more, contact: e.target.value })} placeholder="ชื่อเจ้าของ / ผู้รับของ" /></label>
                    <label>เบอร์โทร<input inputMode="tel" value={more.phone} onChange={(e) => setMore({ ...more, phone: e.target.value.replace(/[^\d\- +]/g, '') })} placeholder="08x-xxx-xxxx" /></label>
                  </div>
                  <label>จุดลงของ / หมายเหตุ<textarea rows={2} value={more.note} onChange={(e) => setMore({ ...more, note: e.target.value })} placeholder="เช่น ลงของหลังร้าน ปิดเที่ยง" /></label>
                </div>
                <button type="button" className="btn" disabled={!name.trim() || !type || !!same} onClick={addNew}>✓ เพิ่มและเลือกร้านนี้</button>
              </div>
            )}
          </>
        )}
      </section>

      {/* step 2: what is delivered */}
      <section className={`sv-step ${draftOk(d) ? 'done' : sel ? 'cur' : ''}`}>
        <div className="sv-step-head"><span className="sv-step-no">{draftOk(d) ? '✓' : '2'}</span>ข้อมูลการส่ง</div>
        <DeliveryFields d={d} set={setD} />
      </section>

      {/* step 3: go */}
      <button type="button" className="btn work-btn sv-go" disabled={missing.length > 0} onClick={() => sel && onStart(sel, deliveryOf(d))}>
        ▶ รถจอดหน้าร้านแล้ว — เริ่มจับเวลา
      </button>
      {missing.length > 0 && <div className="note sv-missing">ยังต้องกรอก: {missing.join(' · ')}</div>}
    </div>
  );
}

/* ---------------- 2. running: one big button ---------------- */

/**
 * Simple timer screen: what we are doing now (big), one big button for the next step,
 * and small tools underneath (undo a wrong tap · pick another step · cancel the store).
 * The full list of 25 codes only opens on request.
 */
function RunningVisit({ no, v, onGo, onUndo, onCancel }: {
  no: number; v: StoreVisit; onGo: (code: string) => void; onUndo: () => void; onCancel: () => void;
}) {
  const cur = v.segments[v.segments.length - 1];
  const next = nextCode(cur.code);
  const phase = phaseOf(cur.code);
  const per = phaseSeconds(v);
  const [picking, setPicking] = useState(false);
  // close the step list after a pick
  useEffect(() => { setPicking(false); }, [cur.code]);
  const stepNo = ACTIVITIES.findIndex((a) => a.code === cur.code) + 1;
  // carrying goods back and forth: offer "one more trip" right where it is needed
  const trips = v.segments.filter((s) => s.code === 'B02' || s.code === 'B03').length;
  const again = cur.code === 'B04' ? (v.method === 'carry' ? ['B02'] : v.method === 'trolley' ? ['B03'] : ['B02', 'B03']) : [];

  return (
    <div className="sv-run">
      <div className="sv-run-top">
        <div className="sv-run-store">
          <span className="sv-no">ร้านที่ {no}</span> <b>{v.storeName}</b>
          <div className="note">
            จอด {hhmm(v.startedAt)} น.{v.cases != null && <> · {deliveryText(v)}</>}
          </div>
        </div>
        <div className="sv-total" role="timer" aria-live="off"><span>เวลาที่ร้านนี้</span><b>{clock(visitSeconds(v))}</b></div>
      </div>

      {/* where we are: 4 steps */}
      <ol className="sv-steps4" aria-label="ช่วงงาน">
        {PHASES.map((p) => {
          const st = p.code === phase ? 'cur' : p.code < phase ? 'done' : '';
          return (
            <li key={p.code} className={`p-${p.code} ${st}`}>
              <span className="sv-steps4-dot">{st === 'done' ? '✓' : p.code}</span>
              <span className="sv-steps4-name">{p.name}</span>
              <span className="mono sv-steps4-time">{per[p.code] ? clock(per[p.code]) : '–'}</span>
            </li>
          );
        })}
      </ol>

      {/* now doing */}
      <div className={`sv-now2 p-${phase}`} role="timer" aria-live="off">
        <span className="sv-now2-label">กำลังทำ{stepNo > 0 && <> · ขั้นที่ {stepNo}/{ACTIVITIES.length}</>}</span>
        <b className="sv-now2-name"><span className="mono">{cur.code}</span> {activityName(cur.code)}</b>
        <b className="mono sv-now2-time">{clock(segSeconds(cur))}</b>
        {(cur.code === 'B02' || cur.code === 'B03' || cur.code === 'B04') && trips > 0 && <span className="sv-now2-sub">ขนไปแล้ว {trips} รอบ</span>}
      </div>

      {again.length > 0 && (
        <div className="sv-again">
          {again.map((c) => (
            <button key={c} type="button" className="btn ghost" onClick={() => onGo(c)}><span className="ii" aria-hidden><RepeatIcon /></span>อีกรอบ · {c === 'B02' ? 'เดินยก' : 'เข็นรถเข็น'}</button>
          ))}
        </div>
      )}

      {next === END_CODE ? (
        <button type="button" className="btn work-btn sv-big end" onClick={() => onGo(END_CODE)}>
          ■ รถออกจากร้าน — จบร้านนี้
        </button>
      ) : next && (
        <button type="button" className={`btn work-btn sv-big p-${phaseOf(next)}`} onClick={() => onGo(next)}>
          <span>เสร็จแล้ว ▶ ถัดไป</span>
          <small><span className="mono">{next}</span> {activityName(next)}</small>
        </button>
      )}

      <div className="sv-tools">
        <button type="button" className="btn ghost sm" disabled={v.segments.length < 2} onClick={onUndo} title="กดถัดไปผิด — กลับไปขั้นก่อนหน้า">↶ ย้อนกลับ</button>
        <button type="button" className="btn ghost sm" aria-expanded={picking} onClick={() => setPicking((o) => !o)}>☰ ข้าม / เลือกขั้นอื่น</button>
        <button type="button" className="btn ghost sm" onClick={() => onGo(END_CODE)}>■ รถออกเลย</button>
      </div>

      {picking && <StepPicker v={v} cur={cur.code} onPick={onGo} onClose={() => setPicking(false)} />}

      <button type="button" className="sv-cancel" onClick={onCancel}>ยกเลิกร้านนี้</button>
    </div>
  );
}

/** every step, grouped by phase: tap one to switch to it (skip ahead, go back, repeat) */
function StepPicker({ v, cur, onPick, onClose }: { v: StoreVisit; cur: string; onPick: (code: string) => void; onClose: () => void }) {
  const byCode = codeSeconds(v);
  return (
    <div className="sv-picker" role="dialog" aria-label="เลือกขั้นตอน">
      <div className="row spread">
        <b>เลือกขั้นตอนที่จะทำ</b>
        <button type="button" className="btn ghost sm" onClick={onClose}>ปิด</button>
      </div>
      {PHASES.map((p) => (
        <div key={p.code} className={`sv-picker-group p-${p.code}`}>
          <div className="sv-picker-head"><span className="sv-dot" />{p.code} {p.name}</div>
          {ACTIVITIES.filter((a) => phaseOf(a.code) === p.code && a.code !== END_CODE).map((a) => {
            const running = a.code === cur;
            const done = byCode[a.code] !== undefined && !running;
            return (
              <button key={a.code} type="button" className={`sv-act ${running ? 'running' : done ? 'done' : ''}`}
                disabled={running} onClick={() => onPick(a.code)}>
                <span className="mono">{a.code}</span>
                <span className="sv-act-name">{a.name}</span>
                <span className="mono">{byCode[a.code] !== undefined ? clock(byCode[a.code]) : ''}</span>
              </button>
            );
          })}
        </div>
      ))}
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

/** "120 ลัง · 8 SKU · 15 ม. · รถเข็น" */
function deliveryText(v: Delivery) {
  return [v.cases != null && `${v.cases} ลัง`, v.skus && `${v.skus} SKU`, v.distanceM && `${v.distanceM} ม.`, methodName(v.method)]
    .filter(Boolean).join(' · ');
}

function EndVisit({ no, v, onSave, onResume }: {
  no: number; v: StoreVisit; onSave: (x: Delivery) => void; onResume: () => void;
}) {
  const [d, setD] = useState<DeliveryDraft>(draftOf(v));
  // details were typed in at the start: show them, edit only if the real numbers differ
  const [editing, setEditing] = useState(!draftOk(draftOf(v)));
  const secs = visitSeconds(v);
  const n = Number(d.cases);
  const ok = draftOk(d);

  return (
    <div className="sv-end">
      <div className="sv-head">
        <div><span className="sv-no">ร้านที่ {no}</span> <b>{v.storeName}</b> <span className={`sv-type t-${v.storeType}`}>{storeTypeName(v.storeType)}</span>
          <div className="note">{hhmm(v.startedAt)} – {v.endedAt && hhmm(v.endedAt)} น.</div></div>
        <div className="sv-total"><span>เวลารวม</span><b>{minutes1(secs)} นาที</b></div>
      </div>
      <PhaseBar per={phaseSeconds(v)} />
      {editing ? <DeliveryFields d={d} set={setD} autoFocus /> : (
        <div className="sv-picked">
          <span className="sv-picked-ico" aria-hidden><BoxIcon /></span>
          <div className="sv-picked-name"><span className="ro-label">ข้อมูลการส่ง</span><b>{deliveryText(deliveryOf(d))}</b></div>
          <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>แก้ไข</button>
        </div>
      )}
      {ok && n > 0 && <div className="note">≈ {(secs / 60 / n).toFixed(2)} นาทีต่อลัง</div>}
      <div className="row spread">
        <button type="button" className="btn ghost sm" onClick={onResume}>กด D05 ผิด — กลับไปจับเวลาต่อ</button>
        <button type="button" className="btn" disabled={!ok} onClick={() => onSave(deliveryOf(d))}>
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
        {totals.legs > 0 && <span><span className="ii" aria-hidden><TruckIcon /></span><b>{minutes1(totals.travel)}</b> นาทีเดินทางรวม</span>}
        {totals.legs > 0 && <span><b>{minutes1(totals.travel / totals.legs)}</b> นาที/ช่วงเดินทาง</span>}
      </div>
      <ul className="sv-list">
        {visits.map((v, i) => ({ v, no: i + 1 })).reverse().map(({ v, no }) => {
          const secs = visitSeconds(v);
          return (
            <li key={v.id}>
              {v.travelFrom && (
                <div className="sv-leg"><span className="ii" aria-hidden><TruckIcon /></span>เดินทางจากร้านที่ {no - 1} ({v.travelFrom.storeName}) <b className="mono">{minutes1(v.travelFrom.seconds)} นาที</b></div>
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
