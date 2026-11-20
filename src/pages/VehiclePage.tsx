import { useCallback, useEffect, useState } from 'react';
import { notifyVehicleCheckChanged } from '../components/CheckStatus';
import { useMe } from '../components/Auth';
import { useMaster } from '../components/MasterContext';
import { EmployeeSelect, PlateInput, ReadOnlyField, Seg, fromIso, thaiClock, thaiDay, useNow, useSignedUrls } from '../components/Fields';
import { useToast } from '../components/Toast';
import { listVehicleInspections, removePhotos, saveVehicleInspection, uploadPhoto } from '../lib/api';
import { shrinkImage } from '../lib/image';
import type { VehicleForm, VehicleInspection, VehResult } from '../lib/types';
import { PHOTO_STATUS, countBy, errMsg, nowTime, pad2, photoStatus, today } from '../lib/utils';

// ผ่าน / ไม่ผ่าน only (N/A removed). ไม่ผ่าน opens a note (required) + photo (optional) for that item.
const VEH_OPTS = [
  { v: 1 as VehResult, label: 'ผ่าน', cls: 'p' as const },
  { v: 2 as VehResult, label: 'ไม่ผ่าน', cls: 'f' as const },
];

const blankForm = (keep?: Partial<VehicleForm>): VehicleForm => ({
  id: null, date: today(), time: nowTime(), dman: '', h1: '', h2: '',
  plate: '', mileage: '', note: '', results: {}, photos: {}, defects: {}, ...keep,
});

/** a sent check back into the form (to fix it after ไม่อนุมัติ) */
const formFrom = (r: VehicleInspection): VehicleForm => ({
  id: r.id, date: r.inspect_date, time: (r.inspect_time ?? '').slice(0, 5),
  dman: r.dman_id, h1: r.helper1_id ?? '', h2: r.helper2_id ?? '',
  plate: r.plate, mileage: r.mileage == null ? '' : String(r.mileage), note: r.note ?? '',
  results: Object.fromEntries(Object.entries(r.results ?? {}).map(([k, v]) => [Number(k), v])) as VehicleForm['results'],
  photos: { ...(r.photos ?? {}) },
  defects: Object.fromEntries(Object.entries(r.defects ?? {}).map(([k, d]) => [Number(k), { note: d.note, photo: d.photo }])),
});

/** sessionStorage: the check whose summary the user closed with "ตรวจรถคันอื่น" (show the form instead) */
const NEW_FORM_KEY = 'veh-new-form-after';
const readKey = () => { try { return sessionStorage.getItem(NEW_FORM_KEY); } catch { return null; } };
const writeKey = (v: string | null) => {
  try { if (v) sessionStorage.setItem(NEW_FORM_KEY, v); else sessionStorage.removeItem(NEW_FORM_KEY); } catch { /* ignore */ }
};

/**
 * Vehicle-check tab. Once I have sent a check today, the tab shows its summary (pass / fail, waiting for approval)
 * — also after switching tabs or reloading — instead of a blank form. "ตรวจรถคันอื่น" opens the form for the next
 * vehicle; from the summary the team goes on to PPE (goPpe).
 */
export function VehiclePage({ goPpe }: { goPpe?: () => void }) {
  const me = useMe();
  // undefined = still loading; null = show the form
  const [summary, setSummary] = useState<VehicleInspection | null | undefined>(undefined);
  // a sent check being fixed (after ไม่อนุมัติ, or before it is approved)
  const [editing, setEditing] = useState<VehicleInspection | null>(null);

  useEffect(() => {
    let alive = true;
    listVehicleInspections({ date: today() }).then((list) => {
      if (!alive) return;
      const mine = list.filter((r) => !me || r.created_by === me.id)
        .sort((a, b) => (b.updated_at ?? b.inspect_time ?? '').localeCompare(a.updated_at ?? a.inspect_time ?? ''));
      const latest = mine[0];
      setSummary(latest && readKey() !== latest.id ? latest : null);
    }).catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, [me]);

  if (summary === undefined) return <div className="empty">กำลังโหลด…</div>;
  if (summary && !editing) {
    return (
      <CheckSummary r={summary} onPpe={goPpe}
        onEdit={summary.approved_at ? undefined : () => setEditing(summary)}
        onAnother={() => { writeKey(summary.id); setSummary(null); }} />
    );
  }
  return (
    <VehicleForm key={editing?.id ?? 'new'} initial={editing ? formFrom(editing) : undefined}
      onCancelEdit={editing ? () => setEditing(null) : undefined}
      onSaved={(r) => { writeKey(null); setEditing(null); setSummary(r); notifyVehicleCheckChanged(); }} />
  );
}

function VehicleForm({ onSaved: setSummary, initial, onCancelEdit }: {
  onSaved: (r: VehicleInspection | null) => void; initial?: VehicleForm; onCancelEdit?: () => void;
}) {
  const { checkItems, photoSlots } = useMaster();
  const toast = useToast();
  const items = checkItems.filter((i) => i.active);
  const total = items.length;

  const [f, setF] = useState<VehicleForm>(() => initial ?? blankForm());
  // today's records: not shown on this page, only used to warn before replacing a plate's earlier check
  const [records, setRecords] = useState<VehicleInspection[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  // photos uploaded in this form session but not yet saved; cleaned up when replaced/removed
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try { setRecords(await listVehicleInspections({ date: f.date })); }
    catch (e) { toast('โหลดข้อมูลไม่สำเร็จ: ' + errMsg(e)); }
  }, [f.date, toast]);
  useEffect(() => { reload(); }, [reload]);

  // date + time of the check are not editable: shown live here, and the server stamps its own (Thai) time on save
  const now = useNow();
  // past midnight: move the form (and the duplicate-plate check) to the new day
  useEffect(() => { if (today() !== f.date) setF((p) => ({ ...p, date: today() })); }, [now, f.date]);

  const set = <K extends keyof VehicleForm>(k: K, v: VehicleForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const done = Object.keys(f.results).length;
  const fails = countBy(f.results, 2);
  const photoCount = Object.keys(f.photos).length;
  const pStatus = photoStatus(photoCount, photoSlots.length);

  const defectPhotos = Object.values(f.defects).flatMap((d) => (d.photo ? [d.photo] : []));
  const formUrls = useSignedUrls([...Object.values(f.photos), ...defectPhotos]);

  function setResult(no: number, v: VehResult | undefined) {
    // leaving ไม่ผ่าน: the item's note and photo are no longer needed
    if (v !== 2) dropFresh(f.defects[no]?.photo ?? undefined);
    setF((p) => {
      const r = { ...p.results };
      if (v === undefined) delete r[no]; else r[no] = v;
      const d = { ...p.defects };
      if (v !== 2) delete d[no];
      return { ...p, results: r, defects: d };
    });
  }

  function setAllPass() {
    defectPhotos.forEach((p) => dropFresh(p));
    setF((p) => ({ ...p, results: Object.fromEntries(items.map((i) => [i.item_no, 1 as VehResult])), defects: {} }));
  }

  const setDefectNote = (no: number, note: string) =>
    setF((p) => ({ ...p, defects: { ...p.defects, [no]: { photo: p.defects[no]?.photo ?? null, note } } }));

  async function onDefectPhoto(no: number, file: File | undefined) {
    if (!file) return;
    setUploading(`item-${no}`);
    try {
      const path = await uploadPhoto(await shrinkImage(file), f.date);
      dropFresh(f.defects[no]?.photo ?? undefined);
      setFresh((s) => new Set(s).add(path));
      setF((p) => ({ ...p, defects: { ...p.defects, [no]: { note: p.defects[no]?.note ?? '', photo: path } } }));
      toast('อัปโหลดรูปแล้ว');
    } catch (e) {
      toast('อัปโหลดรูปไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setUploading(null);
    }
  }

  function removeDefectPhoto(no: number) {
    dropFresh(f.defects[no]?.photo ?? undefined);
    setF((p) => ({ ...p, defects: { ...p.defects, [no]: { note: p.defects[no]?.note ?? '', photo: null } } }));
  }

  function dropFresh(path: string | undefined) {
    if (path && fresh.has(path)) {
      removePhotos([path]).catch(() => {});
      setFresh((s) => { const n = new Set(s); n.delete(path); return n; });
    }
  }

  async function onPhoto(slot: string, file: File | undefined) {
    if (!file) return;
    setUploading(slot);
    try {
      const path = await uploadPhoto(await shrinkImage(file), f.date);
      dropFresh(f.photos[slot]);
      setFresh((s) => new Set(s).add(path));
      setF((p) => ({ ...p, photos: { ...p.photos, [slot]: path } }));
      toast('อัปโหลดรูปแล้ว');
    } catch (e) {
      toast('อัปโหลดรูปไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setUploading(null);
    }
  }

  function removeSlot(slot: string) {
    dropFresh(f.photos[slot]);
    setF((p) => { const ph = { ...p.photos }; delete ph[slot]; return { ...p, photos: ph }; });
  }

  async function save() {
    if (!f.dman || !f.plate.trim()) return toast('เลือก D-Man และกรอกทะเบียนรถก่อน');
    const crew = [f.dman, f.h1, f.h2].filter(Boolean);
    if (new Set(crew).size !== crew.length) return toast('D-Man และ Helper ต้องเป็นคนละคนกัน');
    if (!done) return toast('ยังไม่ได้ตรวจรายการใด');
    const noNote = Object.entries(f.results).filter(([k, v]) => v === 2 && !f.defects[Number(k)]?.note.trim()).map(([k]) => k);
    if (noNote.length) {
      document.getElementById(`defect-${noNote[0]}`)?.focus();
      return toast(`ระบุหมายเหตุของข้อที่ไม่ผ่าน: ข้อ ${noNote.join(', ')}`);
    }
    if (f.mileage && !/^\d+$/.test(f.mileage.trim())) return toast('เลขไมล์ต้องเป็นตัวเลข');
    const dup = records.find((r) => r.plate === f.plate.trim() && r.id !== f.id);
    if (dup && !window.confirm(`ทะเบียน ${dup.plate} มีบันทึกการตรวจของวันนี้แล้ว
บันทึกครั้งนี้จะแทนที่ของเดิม ต้องการบันทึกต่อไหม?`)) return;
    setSaving(true);
    try {
      const id = await saveVehicleInspection({ ...f, date: today(), time: nowTime() });
      setFresh(new Set());
      setF(blankForm({ date: f.date, dman: f.dman, h1: f.h1, h2: f.h2 }));
      toast('ส่งข้อมูลการตรวจรถแล้ว');
      // show the result of what was just sent (as stored by the server)
      try {
        const list = await listVehicleInspections({ date: today() });
        setRecords(list);
        setSummary(list.find((r) => r.id === id) ?? null);
      } catch {
        setSummary(null);
        reload();
      }
    } catch (e) {
      toast('บันทึกไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h2>{f.id ? `แก้ไขการตรวจรถ ${f.plate}` : 'ตรวจรถประจำวัน'}</h2>
      <div className="form-head">
        <div className="field-group">ข้อมูลรถ</div>
        <div className="fields c4">
          <ReadOnlyField label="วันที่" value={thaiDay(now)} />
          <ReadOnlyField label="เวลาตรวจ" value={thaiClock(now)} />
          <label>ทะเบียนรถ<PlateInput id="v-plate" value={f.plate} onChange={(v) => set('plate', v)} /></label>
          <label>เลขไมล์<input inputMode="numeric" placeholder="เช่น 125000" value={f.mileage} onChange={(e) => set('mileage', e.target.value)} /></label>
        </div>
        <div className="field-group">ทีมงาน</div>
        <div className="fields c3 team">
          <label>D-Man<EmployeeSelect value={f.dman} onChange={(v) => set('dman', v)} blank="เลือกผู้ตรวจ" exclude={[f.h1, f.h2]} /></label>
          <label>Helper 1<EmployeeSelect value={f.h1} onChange={(v) => set('h1', v)} blank="ไม่มี" exclude={[f.dman, f.h2]} /></label>
          <label>Helper 2<EmployeeSelect value={f.h2} onChange={(v) => set('h2', v)} blank="ไม่มี" exclude={[f.dman, f.h1]} /></label>
        </div>
      </div>

      <div className="row spread section-head">
        <b>รายการตรวจ <span className="mono">{done}/{total}</span></b>
        <button className="btn ghost sm" type="button" onClick={setAllPass}>ผ่านทั้งหมด</button>
      </div>
      <div className="prog" aria-hidden="true"><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      <div className="checks">
        {items.map((it) => {
          const failed = f.results[it.item_no] === 2;
          const d = f.defects[it.item_no];
          const busy = uploading === `item-${it.item_no}`;
          return (
            <div className={`check${failed ? ' failed' : ''}`} key={it.item_no}>
              <div><span className="n">{pad2(it.item_no)}</span><span className="t">{it.name}</span></div>
              <div className="h">{it.hint}</div>
              <Seg label={`ข้อ ${it.item_no}`} value={f.results[it.item_no]} options={VEH_OPTS}
                onChange={(v) => setResult(it.item_no, v)} />
              {failed && (
                <div className="defect">
                  <label>
                    <span>หมายเหตุ (ระบุข้อบกพร่อง) <em className="req">*</em></span>
                    <textarea id={`defect-${it.item_no}`} rows={2} maxLength={500} value={d?.note ?? ''}
                      placeholder="เช่น ยางหน้าซ้ายสึก ดอกยางเหลือน้อย"
                      onChange={(e) => setDefectNote(it.item_no, e.target.value)} />
                  </label>
                  <div className="defect-photo">
                    <div className="box">
                      {d?.photo && formUrls[d.photo] ? <img src={formUrls[d.photo]} alt={`รูปข้อ ${it.item_no}`} />
                        : busy ? 'กำลังอัปโหลด…' : d?.photo ? 'กำลังโหลด…' : 'ถ่ายรูปข้อบกพร่อง'}
                      <input type="file" accept="image/*" capture="environment" aria-label={`ถ่ายรูปข้อ ${it.item_no}`}
                        disabled={uploading !== null}
                        onChange={(e) => { onDefectPhoto(it.item_no, e.target.files?.[0]); e.target.value = ''; }} />
                    </div>
                    {d?.photo && <button type="button" className="btn danger sm" onClick={() => removeDefectPhoto(it.item_no)}>ลบรูป</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="section-head"><b>ภาพถ่ายรถ</b> <span className="note mono">{photoCount}/{photoSlots.length}</span></div>
      <div className="shots">
        {photoSlots.map((s) => {
          const path = f.photos[s.code];
          return (
            <div className="shot" key={s.code}>
              <span>{s.name}</span>
              <div className="box">
                {path && formUrls[path] ? <img src={formUrls[path]} alt={`ภาพ${s.name}`} /> :
                  uploading === s.code ? 'กำลังอัปโหลด…' : path ? 'กำลังโหลด…' : 'ถ่ายรูป / เลือกรูป'}
                <input type="file" accept="image/*" capture="environment" aria-label={`รูป${s.name}`}
                  disabled={uploading !== null}
                  onChange={(e) => { onPhoto(s.code, e.target.files?.[0]); e.target.value = ''; }} />
              </div>
              {path && <button type="button" className="btn danger sm" onClick={() => removeSlot(s.code)}>ลบรูป</button>}
            </div>
          );
        })}
      </div>
      <p className="note">
        ส่งภาพเข้าระบบ: <span className={`pill ${pStatus === 1 ? 'p' : pStatus === 2 ? 'x' : 'f'}`}>{PHOTO_STATUS[pStatus]}</span>{' '}
        (อัปโหลดครบ {photoSlots.length} รูปถึงจะนับว่าส่งครบ)
      </p>

      <div className="row spread mt">
        <span className={`note ${fails ? 'fail-text' : ''}`}>
          {fails ? `พบ ${fails} ข้อไม่ผ่าน ผลตรวจ: ไม่ผ่าน` : done ? 'ผลตรวจ: ผ่าน' : 'ยังไม่ได้ตรวจ'}
        </span>
        <div className="row">
          {onCancelEdit && <button className="btn ghost" type="button" disabled={saving} onClick={onCancelEdit}>ยกเลิกการแก้ไข</button>}
          <button className="btn" type="button" disabled={saving || uploading !== null} onClick={save}>
            {saving ? 'กำลังบันทึก…' : f.id ? 'ส่งข้อมูลที่แก้ไขอีกครั้ง' : 'บันทึกการตรวจ'}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Shown right after sending a vehicle check: what was recorded and that it now waits for review/approval. */
function CheckSummary({ r, onPpe, onAnother, onEdit }: {
  r: VehicleInspection; onPpe?: () => void; onAnother: () => void; onEdit?: () => void;
}) {
  const { checkItems, photoSlots, nameOf } = useMaster();
  const total = checkItems.filter((i) => i.active).length;
  const itemName = new Map(checkItems.map((i) => [i.item_no, i.name]));
  const failed = Object.entries(r.results ?? {}).filter(([, v]) => v === 2).map(([k]) => ({
    no: k, name: itemName.get(Number(k)) ?? `ข้อ ${k}`, note: r.defects?.[k]?.note ?? '', photo: r.defects?.[k]?.photo ?? null,
  }));
  const urls = useSignedUrls(failed.flatMap((d) => (d.photo ? [d.photo] : [])));
  const approved = !!r.approved_at;
  const verdict = r.fail_count > 0 ? { cls: 'f', text: 'ไม่ผ่าน' }
    : r.filled_count < total ? { cls: 'x', text: 'ตรวจไม่ครบ' } : { cls: 'p', text: 'ผ่าน' };
  const when = `${fromIso(r.inspect_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}`
    + (r.inspect_time ? ` · ${r.inspect_time.slice(0, 5)} น.` : '');
  const crew = [r.helper1_id, r.helper2_id].filter(Boolean).map((h) => nameOf(h)).join(', ');

  return (
    <section className="panel sum">
      {r.rejected_at ? (
        <div className="sum-status bad" role="status">
          <span className="sum-icon" aria-hidden="true">✕</span>
          <div>
            <b>ไม่อนุมัติ</b>
            <span>เหตุผล: {r.reject_reason || '—'}</span>
            <span className="sum-status-hint">กด "แก้ไขการตรวจคันนี้" แก้ตามเหตุผลแล้วส่งอีกครั้ง — สถานะจะกลับเป็นรออนุมัติ</span>
          </div>
        </div>
      ) : (
        <div className={`sum-status ${approved ? 'ok' : 'wait'}`} role="status">
          <span className="sum-icon" aria-hidden="true">{approved ? '✓' : '⏳'}</span>
          <div>
            <b>{approved ? 'อนุมัติแล้ว' : 'ส่งข้อมูลแล้ว · รอการตรวจสอบ / รอการอนุมัติ'}</b>
            <span>{approved ? 'หัวหน้าตรวจสอบและอนุมัติแล้ว' : 'ผลการตรวจนี้จะถูกตรวจสอบและอนุมัติโดยหัวหน้า'}</span>
          </div>
        </div>
      )}

      <h2 className="sum-title">สรุปผลการตรวจรถ <span className={`pill ${verdict.cls}`}>ผลตรวจ: {verdict.text}</span></h2>
      <dl className="sum-meta">
        <dt>ทะเบียนรถ</dt><dd>{r.plate}</dd>
        <dt>วันที่ / เวลา</dt><dd>{when}</dd>
        <dt>D-Man</dt><dd>{nameOf(r.dman_id)}</dd>
        {crew && <><dt>Helper</dt><dd>{crew}</dd></>}
      </dl>

      <div className="sum-counts">
        <div className="sum-count pass"><b>{r.pass_count}</b><span>Pass · ผ่าน</span></div>
        <div className="sum-count fail"><b>{r.fail_count}</b><span>Fail · ไม่ผ่าน</span></div>
        <div className="sum-count"><b>{r.filled_count}/{total}</b><span>ข้อที่ตรวจ</span></div>
        <div className="sum-count"><b>{r.photo_count}/{photoSlots.length}</b><span>ภาพถ่ายรถ</span></div>
      </div>

      {failed.length > 0 && (
        <>
          <h3 className="sum-sub">ข้อที่ไม่ผ่าน ({failed.length})</h3>
          <ul className="defect-list">
            {failed.map((d) => (
              <li key={d.no}>
                <div className="defect-text"><b>{d.no}. {d.name}</b>{d.note && <span>{d.note}</span>}</div>
                {d.photo && urls[d.photo] && <img src={urls[d.photo]} alt={`รูป${d.name}`} />}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="sum-actions">
        {r.rejected_at && onEdit && <button className="btn" onClick={onEdit}>แก้ไขการตรวจคันนี้</button>}
        {onPpe && <button className={`btn ${r.rejected_at ? 'ghost' : ''}`} onClick={onPpe}>ตรวจ PPE ของทีมต่อ</button>}
        {!r.rejected_at && onEdit && <button className="btn ghost" onClick={onEdit}>แก้ไขการตรวจคันนี้</button>}
        <button className="btn ghost" onClick={onAnother}>ตรวจรถคันอื่น</button>
      </div>
    </section>
  );
}
