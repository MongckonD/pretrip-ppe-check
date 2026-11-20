/**
 * Admin "สถานะรถ" (/admin/vehicle-status) — monitoring-screen layout:
 *   filters (date range, plate, D-Man, result) → status chips + "อนุมัติทุกคันที่ผ่าน" → summary cards → table (10 / page)
 *   → "รายละเอียด" opens the check: every item ผ่าน / ไม่ผ่าน with notes and photos, vehicle photos, approve / ไม่อนุมัติ.
 * Rules kept from before: approval is FINAL (no undo, no reject afterwards — server + DB enforce it too);
 * ไม่อนุมัติ needs a reason and goes back to รออนุมัติ when staff re-send; "ยังไม่ตรวจ" rows are shown for a single day.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ComboText, useSignedUrls } from '../components/Fields';
import { AlertIcon, BadgeCheckIcon, CheckCircleIcon, HourglassIcon, ImageIcon, ListIcon, XCircleIcon } from '../components/Icons';
import { Lightbox, type LightboxPhoto } from '../components/Lightbox';
import { useMaster } from '../components/MasterContext';
import { useToast } from '../components/Toast';
import { listPpeInspections, listVehicleInspections, setVehicleApproval, setVehicleRejection } from '../lib/api';
import type { PpeInspection, VehicleInspection } from '../lib/types';
import { errMsg, today } from '../lib/utils';

type Status = 'none' | 'wait' | 'bad' | 'ok';
type Chip = 'all' | Status;
const STATUS: Record<Status, { text: string; cls: string }> = {
  none: { text: 'ยังไม่ตรวจ', cls: 'x' },
  wait: { text: 'รออนุมัติ', cls: 'w' },
  bad: { text: 'ไม่อนุมัติ', cls: 'f' },
  ok: { text: 'อนุมัติแล้ว', cls: 'p' },
};
const statusOf = (c?: VehicleInspection): Status => (!c ? 'none' : c.approved_at ? 'ok' : c.rejected_at ? 'bad' : 'wait');
const FINAL_NOTE = 'อนุมัติแล้วจะยกเลิกหรือแก้ไขไม่ได้';
/** quick reasons the admin can tap instead of typing */
const QUICK_REASONS = ['ถ่ายรูปรถไม่ครบ', 'รูปไม่ชัด / ไม่ตรงกับข้อที่แจ้ง', 'หมายเหตุไม่ชัดเจน', 'รถไม่พร้อมออกงาน — แจ้งซ่อมก่อน'];

const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const thTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const isoDay = (d: Date) => d.toLocaleDateString('sv-SE');
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
const crewOf = (c: VehicleInspection) => [c.dman_id, c.helper1_id, c.helper2_id].filter((x): x is string => !!x);

interface Row {
  key: string; date: string; plate: string; status: Status; check?: VehicleInspection;
  dman: string; helpers: string; fail: number; filled: number; photos: number; ppeOk: number; ppeTotal: number;
}
interface Filters { from: string; to: string; plate: string; dman: string; check: '' | 'pass' | 'fail' }
const todayFilters = (): Filters => ({ from: today(), to: today(), plate: '', dman: '', check: '' });

/* ---------------- page ---------------- */

export function VehicleStatusPage() {
  const { vehicles, employees, checkItems, nameOf } = useMaster();
  const toast = useToast();
  const [draft, setDraft] = useState<Filters>(todayFilters);
  const [applied, setApplied] = useState<Filters>(todayFilters);
  const [chip, setChip] = useState<Chip>('all');
  const [checks, setChecks] = useState<VehicleInspection[] | null>(null);
  const [ppe, setPpe] = useState<PpeInspection[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  // photos taken around the vehicle, opened from the รูปภาพ column
  const [photosOf, setPhotosOf] = useState<VehicleInspection | null>(null);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    const opts = { from: applied.from, to: applied.to };
    try {
      const [v, p] = await Promise.all([listVehicleInspections(opts), listPpeInspections(opts)]);
      setChecks(v); setPpe(p); setError('');
    } catch (e) { setError(errMsg(e)); }
  }, [applied.from, applied.to]);
  useEffect(() => { setChecks(null); load(); }, [load]);
  // keep the board current while it shows today (new checks arrive during the morning); past ranges never change
  // by themselves, so they are not re-read (saves D1 rows read)
  useEffect(() => {
    if (applied.to < today()) return;
    const t = window.setInterval(load, 2 * 60_000);
    return () => window.clearInterval(t);
  }, [load, applied.to]);

  const totalItems = checkItems.filter((i) => i.active).length;
  const singleDay = applied.from === applied.to;

  /** one row per check; for a single day also every active vehicle that has no check yet */
  const all = useMemo<Row[]>(() => {
    if (!checks) return [];
    const rows: Row[] = checks.map((c) => {
      const crew = crewOf(c);
      const mine = ppe.filter((p) => p.inspect_date === c.inspect_date && p.plate === c.plate && crew.includes(p.employee_id));
      return {
        key: c.id, date: c.inspect_date, plate: c.plate, status: statusOf(c), check: c,
        dman: nameOf(c.dman_id), helpers: crew.slice(1).map(nameOf).join(', '),
        // รูปภาพ column = photos taken around the vehicle (failed-item photos are in the detail popup)
        fail: c.fail_count, filled: c.filled_count, photos: Object.keys(c.photos ?? {}).length,
        ppeOk: crew.filter((id) => mine.some((p) => p.employee_id === id && p.status === 'ครบ')).length, ppeTotal: crew.length,
      };
    });
    if (singleDay) {
      const checked = new Set(checks.map((c) => c.plate));
      for (const v of vehicles) {
        if (!v.active || checked.has(v.plate)) continue;
        rows.push({ key: `none-${v.plate}`, date: applied.from, plate: v.plate, status: 'none', dman: '', helpers: '', fail: 0, filled: 0, photos: 0, ppeOk: 0, ppeTotal: 0 });
      }
    }
    const order: Record<Status, number> = { wait: 0, bad: 1, ok: 2, none: 3 };
    return rows.sort((a, b) => b.date.localeCompare(a.date) || order[a.status] - order[b.status]
      || (b.check?.inspect_time ?? '').localeCompare(a.check?.inspect_time ?? '') || a.plate.localeCompare(b.plate, 'th'));
  }, [checks, ppe, vehicles, nameOf, singleDay, applied.from]);

  // filters (plate / D-Man / result) first, then the status chip
  const has = (cell: string, q: string) => !q || cell.toLowerCase().includes(q.trim().toLowerCase());
  const filtered = useMemo(() => all.filter((r) => has(r.plate, applied.plate) && has(r.dman, applied.dman)
    && (!applied.check || (r.status !== 'none' && (applied.check === 'fail' ? r.fail > 0 : r.fail === 0)))), [all, applied]);
  const count = (s: Status) => filtered.filter((r) => r.status === s).length;
  const shown = useMemo(() => filtered.filter((r) => chip === 'all' || r.status === chip), [filtered, chip]);
  useEffect(() => { setPage(0); }, [shown.length, chip, applied]);
  /** pending checks with every item filled and nothing failed — safe to approve in one go */
  const cleanPending = filtered.filter((r) => r.status === 'wait' && r.check && !r.fail && r.filled >= totalItems);

  function search(next: Filters = draft) {
    if (!next.from || !next.to) return setMsg('เลือกวันที่เริ่มและวันที่สิ้นสุด');
    if (next.from > next.to) return setMsg('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
    if ((Date.parse(next.to) - Date.parse(next.from)) / 86_400_000 > 366) return setMsg('เลือกช่วงวันที่ได้ไม่เกิน 1 ปี');
    setMsg(''); setDraft(next);
    if (next.from === applied.from && next.to === applied.to) load();
    setApplied(next);
  }
  const quick = (from: string, to: string) => search({ ...draft, from, to });
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const plateOpts = useMemo(() => [...vehicles].sort((a, b) => a.plate.localeCompare(b.plate, 'th')).map((v) => ({ value: v.plate })), [vehicles]);
  const peopleOpts = useMemo(() => employees.filter((e) => e.name).map((e) => ({ value: e.name, label: e.code ? `${e.name} (${e.code})` : e.name })), [employees]);

  async function run(id: string, fn: () => Promise<void>, ok: string) {
    setBusy(id);
    try { await fn(); toast(ok); await load(); return true; }
    catch (e) { toast('ไม่สำเร็จ: ' + errMsg(e)); return false; }
    finally { setBusy(''); }
  }
  function approve(c: VehicleInspection) {
    const fails = c.fail_count > 0 ? `มี ${c.fail_count} ข้อไม่ผ่าน\n` : '';
    if (!window.confirm(`อนุมัติรถ ${c.plate}?\n${fails}${FINAL_NOTE}`)) return;
    void run(c.id, () => setVehicleApproval(c.id, true), `อนุมัติรถ ${c.plate} แล้ว`);
  }
  const reject = (c: VehicleInspection, reason: string) =>
    run(c.id, () => setVehicleRejection(c.id, reason), `ไม่อนุมัติรถ ${c.plate} แล้ว — พนักงานจะเห็นเหตุผล`);
  const unreject = (c: VehicleInspection) =>
    void run(c.id, () => setVehicleRejection(c.id, null), `ยกเลิกไม่อนุมัติรถ ${c.plate} แล้ว (กลับเป็นรออนุมัติ)`);

  async function approveAllClean() {
    if (!cleanPending.length) return;
    if (!window.confirm(`อนุมัติรถที่ผ่านครบทุกข้อ ${cleanPending.length} คัน?\n${cleanPending.map((r) => r.plate).join(', ')}\n${FINAL_NOTE}`)) return;
    setBusy('all');
    let ok = 0;
    for (const r of cleanPending) { try { await setVehicleApproval(r.check!.id, true); ok++; } catch { /* reported below */ } }
    toast(ok === cleanPending.length ? `อนุมัติแล้ว ${ok} คัน` : `อนุมัติได้ ${ok} จาก ${cleanPending.length} คัน`);
    setBusy('');
    await load();
  }

  const pages = Math.max(1, Math.ceil(shown.length / 10));
  const p = Math.min(page, pages - 1);
  const rowsOnPage = shown.slice(p * 10, p * 10 + 10);
  const opened = checks?.find((c) => c.id === openId);
  const chips: Chip[] = singleDay ? ['all', 'wait', 'bad', 'ok', 'none'] : ['all', 'wait', 'bad', 'ok'];

  return (
    <>
      <section className="panel rp-filters">
        <h2 className="rp-title"><span className="rp-dot" />ตรวจสอบสถานะรถ</h2>
        <div className="rp-grid">
          <label className="rp-field"><span className="ro-label">วันที่ตรวจจาก</span>
            <input type="date" aria-label="วันที่ตรวจจาก" value={draft.from} max={today()} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="rp-field"><span className="ro-label">วันที่ตรวจถึง</span>
            <input type="date" aria-label="วันที่ตรวจถึง" value={draft.to} max={today()} onChange={(e) => set('to', e.target.value)} /></label>
          <div className="rp-field"><span className="ro-label">ทะเบียนรถ</span>
            <ComboText value={draft.plate} onChange={(v) => set('plate', v)} options={plateOpts} blank="— ทั้งหมด —" ariaLabel="ค้นหา ทะเบียนรถ" onEnter={() => search()} /></div>
          <div className="rp-field"><span className="ro-label">D-Man</span>
            <ComboText value={draft.dman} onChange={(v) => set('dman', v)} options={peopleOpts} blank="— ทั้งหมด —" ariaLabel="ค้นหา D-Man" onEnter={() => search()} /></div>
          <label className="rp-field"><span className="ro-label">ผลการตรวจ</span>
            <select aria-label="ผลการตรวจ" value={draft.check} onChange={(e) => set('check', e.target.value as Filters['check'])}>
              <option value="">— ทั้งหมด —</option><option value="pass">ผ่าน</option><option value="fail">ไม่ผ่าน</option>
            </select></label>
        </div>
        <div className="row spread rp-actions">
          <div className="row rp-quick" role="group" aria-label="ช่วงวันที่ด่วน">
            <button type="button" className="btn ghost sm" onClick={() => quick(today(), today())}>วันนี้</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(addDays(today(), -1), addDays(today(), -1))}>เมื่อวาน</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(addDays(today(), -6), today())}>7 วันล่าสุด</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(today().slice(0, 8) + '01', today())}>เดือนนี้</button>
          </div>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => search(todayFilters())}>ล้างตัวกรอง</button>
            <button type="button" className="btn rp-search" onClick={() => search()}>🔍 ค้นหาข้อมูล</button>
          </div>
        </div>
        {msg && <div className="error">{msg}</div>}
        {error && <div className="error">{error}</div>}
        {checks && (
          <div className="row spread vs-chips">
            <div className="seg compact vs-filter" role="group" aria-label="กรองตามสถานะ">
              {chips.map((c) => (
                <button key={c} type="button" aria-pressed={chip === c} onClick={() => setChip(c)}>
                  {c === 'all' ? `ทั้งหมด ${filtered.length}` : `${STATUS[c].text} ${count(c)}`}
                </button>
              ))}
            </div>
            <button className="btn sm" disabled={!cleanPending.length || !!busy} onClick={approveAllClean}
              title="อนุมัติเฉพาะรถที่ตรวจครบทุกข้อและไม่มีข้อไม่ผ่าน">อนุมัติทุกคันที่ผ่าน ({cleanPending.length})</button>
          </div>
        )}
      </section>

      {!checks && !error && <div className="empty">กำลังโหลด…</div>}
      {checks && (
        <div className="rp-cards">
          {[
            { icon: <ListIcon />, label: 'ผลตรวจทั้งหมด', value: filtered.filter((r) => r.check).length, tone: 'all' },
            { icon: <CheckCircleIcon />, label: 'ผ่าน', value: filtered.filter((r) => r.check && !r.fail).length, tone: 'pass' },
            { icon: <AlertIcon />, label: 'ไม่ผ่าน', value: filtered.filter((r) => r.check && r.fail).length, tone: 'fail' },
            { icon: <HourglassIcon />, label: 'รออนุมัติ', value: count('wait'), tone: 'wait' },
            { icon: <XCircleIcon />, label: 'ไม่อนุมัติ', value: count('bad'), tone: 'fail' },
            { icon: <BadgeCheckIcon />, label: 'อนุมัติแล้ว', value: count('ok'), tone: 'pass' },
          ].map((c) => (
            <div key={c.label} className={`rp-card ${c.tone}`}>
              <span className="rp-ico" aria-hidden="true">{c.icon}</span>
              <div><span>{c.label}</span><b>{c.value}</b></div>
            </div>
          ))}
        </div>
      )}

      {checks && (
        <section className="panel">
          <div className="row spread head-row">
            <span className="note">ช่วง {mdy(applied.from)}{singleDay ? '' : ` – ${mdy(applied.to)}`} · {shown.length} แถว</span>
          </div>
          {!shown.length ? <div className="empty">ไม่มีรถในสถานะ / เงื่อนไขนี้</div> : (
            <div className="tbl">
              <table className="sum-tbl rp-tbl vs-tbl">
                <thead>
                  <tr>
                    <th className="num">ลำดับ</th><th>ผลการตรวจ</th><th>สถานะอนุมัติ</th><th>รายละเอียด</th><th className="c">รูปภาพ</th>
                    <th>ทะเบียนรถ</th><th>D-Man</th><th>ผู้ช่วย</th><th>PPE</th><th>วันที่ตรวจ</th><th>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsOnPage.map((r, i) => (
                    <tr key={r.key} className={r.status === 'none' ? 'vs-none' : ''}>
                      <td className="num">{p * 10 + i + 1}</td>
                      <td>{!r.check ? '–' : r.fail ? <span className="pill f">● ไม่ผ่าน {r.fail}</span> : <span className="pill p">● ผ่าน</span>}</td>
                      <td><span className={`pill ${STATUS[r.status].cls}`}>● {STATUS[r.status].text}</span></td>
                      <td>{r.check && <button type="button" className="vs-detail" onClick={() => setOpenId(r.check!.id)} aria-label={`รายละเอียด ${r.plate}`}>☰ ดู</button>}</td>
                      <td className="c">
                        {r.check ? (
                          <button type="button" className="vs-photo-btn" disabled={!r.photos} onClick={() => setPhotosOf(r.check!)}
                            title={r.photos ? `ดูรูปรอบรถ ${r.photos} รูป` : 'ไม่ได้ถ่ายรูปรถ'} aria-label={`รูปรอบรถ ${r.plate} ${r.photos} รูป`}>
                            <ImageIcon /><span>{r.photos}</span>
                          </button>
                        ) : '–'}
                      </td>
                      <td><b>{r.plate}</b></td>
                      <td>{r.dman || '–'}</td>
                      <td>{r.helpers || '–'}</td>
                      <td>{r.check ? <span className={`pill ${r.ppeOk === r.ppeTotal ? 'p' : 'w'}`}>{r.ppeOk}/{r.ppeTotal}</span> : '–'}</td>
                      <td className="mono">{mdy(r.date)}{r.check?.inspect_time ? ` ${r.check.inspect_time.slice(0, 5)}` : ''}</td>
                      <td>
                        {r.status === 'wait' && <button className="btn sm vs-approve" disabled={!!busy} onClick={() => approve(r.check!)}>✓ อนุมัติ</button>}
                        {r.status === 'bad' && <button className="btn ghost sm" onClick={() => setOpenId(r.check!.id)}>ดูเหตุผล</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shown.length > 10 && (
            <div className="pager" role="navigation" aria-label="เปลี่ยนหน้า">
              <span className="note">แถวที่ {p * 10 + 1}–{Math.min(shown.length, p * 10 + 10)} จาก {shown.length}</span>
              <div className="row">
                <button type="button" className="btn ghost sm" disabled={p === 0} onClick={() => setPage(p - 1)}>‹ ก่อนหน้า</button>
                <span className="pager-no">หน้า {p + 1}/{pages}</span>
                <button type="button" className="btn ghost sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>ถัดไป ›</button>
              </div>
            </div>
          )}
        </section>
      )}

      {photosOf && <CarPhotos c={photosOf} onClose={() => setPhotosOf(null)} />}
      {opened && (
        <DetailDialog c={opened} ppe={ppe} busy={busy === opened.id} onClose={() => setOpenId(null)}
          onApprove={() => approve(opened)} onReject={(reason) => reject(opened, reason)} onUnreject={() => unreject(opened)} />
      )}
    </>
  );
}

/* ---------------- detail popup ---------------- */

function DetailDialog({ c, ppe, busy, onClose, onApprove, onReject, onUnreject }: {
  c: VehicleInspection; ppe: PpeInspection[]; busy: boolean; onClose: () => void;
  onApprove: () => void; onReject: (reason: string) => Promise<boolean>; onUnreject: () => void;
}) {
  const { checkItems, photoSlots, nameOf, codeOf } = useMaster();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [viewer, setViewer] = useState<number | null>(null);
  const status = statusOf(c);
  const items = checkItems.filter((i) => i.active || c.results?.[String(i.item_no)] !== undefined);
  const crew = crewOf(c);
  const ppeOk = crew.filter((id) => ppe.some((p) => p.employee_id === id && p.plate === c.plate && p.inspect_date === c.inspect_date && p.status === 'ครบ')).length;

  const carPhotos = photoSlots.filter((s) => c.photos?.[s.code]).map((s) => ({ key: c.photos[s.code], caption: `รูปรถ: ${s.name}` }));
  const defectPhotos = Object.entries(c.defects ?? {}).filter(([, d]) => d.photo)
    .map(([no, d]) => ({ key: d.photo as string, caption: `ข้อ ${no}. ${checkItems.find((i) => String(i.item_no) === no)?.name ?? ''} — ${d.note || 'ไม่มีหมายเหตุ'}` }));
  const urls = useSignedUrls([...defectPhotos, ...carPhotos].map((x) => x.key));
  const gallery = useMemo<(LightboxPhoto & { key: string })[]>(() => [...defectPhotos, ...carPhotos]
    .map((x) => ({ ...x, url: urls[x.key] ?? '' })).filter((x) => x.url), [defectPhotos, carPhotos, urls]);
  const open = (key: string) => { const i = gallery.findIndex((g) => g.key === key); if (i >= 0) setViewer(i); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && viewer === null) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, viewer]);

  async function submitReject() {
    const t = reason.trim();
    if (!t) return;
    if (await onReject(t)) { setRejecting(false); setReason(''); }
  }

  return createPortal(
    <div className="dlg-back" onClick={onClose}>
      <div className="dlg vs-dlg" role="dialog" aria-modal="true" aria-label={`รายละเอียดผลการตรวจ ${c.plate}`} onClick={(e) => e.stopPropagation()}>
        <div className="row spread dlg-head">
          <h2 className="flush">รายละเอียดผลการตรวจ</h2>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="ปิด">✕</button>
        </div>

        <div className="vs-info">
          <div><span className="ro-label">สถานะ</span>
            <span className="row">
              {c.fail_count ? <span className="pill f">● ไม่ผ่าน {c.fail_count} ข้อ</span> : <span className="pill p">● ผ่าน</span>}
              <span className={`pill ${STATUS[status].cls}`}>● {STATUS[status].text}</span>
            </span></div>
          <div><span className="ro-label">ผู้ตรวจ (D-Man)</span><b>{nameOf(c.dman_id)}{codeOf(c.dman_id) && <span className="note mono"> ({codeOf(c.dman_id)})</span>}</b></div>
          <div><span className="ro-label">ทะเบียนรถ</span><b>{c.plate}</b></div>
          <div><span className="ro-label">วันที่ตรวจ</span><b className="mono">{mdy(c.inspect_date)} {(c.inspect_time ?? '').slice(0, 5)}</b></div>
          <div><span className="ro-label">เลขไมล์</span><b className="mono">{c.mileage == null ? '–' : c.mileage.toLocaleString('th-TH')}</b></div>
          <div><span className="ro-label">ผู้ช่วย</span><b>{crew.length > 1 ? crew.slice(1).map(nameOf).join(', ') : '–'}</b></div>
          <div><span className="ro-label">PPE ครบ</span><b>{ppeOk}/{crew.length}</b></div>
          <div><span className="ro-label">ตรวจแล้ว</span><b>{c.filled_count}/{checkItems.filter((i) => i.active).length} ข้อ</b></div>
        </div>

        {status === 'bad' && (
          <div className="vs-reject-note">
            <b>ไม่อนุมัติ</b> โดย {c.rejected_by ?? '—'} เมื่อ {thTime(c.rejected_at)} น.
            <div>เหตุผล: {c.reject_reason || '—'}</div>
            <div className="note">รอพนักงานแก้ไขและส่งใหม่</div>
          </div>
        )}
        {status === 'ok' && <div className="vs-ok-note">อนุมัติโดย {c.approved_by} เมื่อ {mdy((c.approved_at ?? '').slice(0, 10) || c.inspect_date)} {thTime(c.approved_at)} น.</div>}

        <div className="tbl dlg-body">
          <table className="sum-tbl rp-tbl vs-items">
            <thead>
              <tr><th className="num">ลำดับ</th><th>รายการตรวจสอบ</th><th className="c">ผ่าน</th><th className="c">ไม่ผ่าน</th><th>หมายเหตุ</th><th className="c">รูปภาพ</th></tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const v = c.results?.[String(it.item_no)];
                const d = c.defects?.[String(it.item_no)];
                return (
                  <tr key={it.item_no} className={v === 2 ? 'bad' : ''}>
                    <td className="num">{it.item_no}</td>
                    <td><b>{it.name}</b>{it.hint && <div className="note">{it.hint}</div>}</td>
                    <td className="c">{v === 1 ? <span className="vs-yes">✓</span> : ''}</td>
                    <td className="c">{v === 2 ? <span className="vs-no">✕</span> : v === undefined ? <span className="note">ไม่ได้ตรวจ</span> : ''}</td>
                    <td>{d?.note || ''}</td>
                    <td className="c">
                      {d?.photo ? (
                        <button type="button" className="vs-photo-btn" disabled={!urls[d.photo]} onClick={() => open(d.photo as string)}
                          title={`ดูรูปข้อ ${it.item_no}`} aria-label={`ดูรูปข้อ ${it.item_no} ${it.name}`}>
                          <ImageIcon /><span>ดูรูป</span>
                        </button>
                      ) : <span className="note">–</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="vs-photos">
          <div className="ro-label">รูปรถ ({carPhotos.length}/{photoSlots.length})</div>
          {carPhotos.length ? (
            <div className="vs-photo-grid">
              {carPhotos.map((x) => (
                <button key={x.key} type="button" className="vs-photo" onClick={() => open(x.key)} title={`${x.caption} — กดเพื่อดูรูปใหญ่`}>
                  {urls[x.key] ? <img src={urls[x.key]} alt={x.caption} /> : <span className="note">…</span>}
                  <span>{x.caption.replace('รูปรถ: ', '')}</span>
                </button>
              ))}
            </div>
          ) : <div className="note">ไม่ได้ถ่ายรูปรถ</div>}
        </div>

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
          <div className="row spread vs-dlg-foot">
            <div className="row">
              {status === 'wait' && <button className="btn vs-reject" disabled={busy} onClick={() => setRejecting(true)}>✕ ไม่อนุมัติ</button>}
              {status === 'bad' && <button className="btn ghost" disabled={busy} onClick={onUnreject}>ยกเลิกไม่อนุมัติ</button>}
              {(status === 'wait' || status === 'bad') && <button className="btn vs-approve" disabled={busy} onClick={onApprove}>✓ อนุมัติ</button>}
            </div>
            <button type="button" className="btn ghost" onClick={onClose}>ปิดหน้าต่าง</button>
          </div>
        )}

        {viewer !== null && <Lightbox photos={gallery} start={viewer} onClose={() => setViewer(null)} />}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- photos around the vehicle (รูปภาพ column) ---------------- */

/** opens the full-screen viewer straight away with every vehicle photo of this check */
function CarPhotos({ c, onClose }: { c: VehicleInspection; onClose: () => void }) {
  const { photoSlots } = useMaster();
  const list = photoSlots.filter((s) => c.photos?.[s.code]).map((s) => ({ key: c.photos[s.code], caption: `${c.plate} · รูปรถ: ${s.name}` }));
  const urls = useSignedUrls(list.map((x) => x.key));
  const photos = list.map((x) => ({ url: urls[x.key] ?? '', caption: x.caption })).filter((x) => x.url);
  if (!list.length) return null;
  if (photos.length < list.length) {
    return createPortal(<div className="dlg-back" onClick={onClose}><div className="dlg vs-loading">กำลังโหลดรูป…</div></div>, document.body);
  }
  return <Lightbox photos={photos} start={0} onClose={onClose} />;
}
