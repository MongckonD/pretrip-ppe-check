import { useCallback, useEffect, useState } from 'react';
import { useMaster } from '../components/MasterContext';
import { ConfirmDelete, EmployeeSelect, PlateInput, Seg, useSignedUrls } from '../components/Fields';
import { useToast } from '../components/Toast';
import {
  deleteVehicleInspection, listVehicleInspections, removePhotos, saveVehicleInspection, uploadPhoto,
} from '../lib/api';
import { shrinkImage } from '../lib/image';
import type { VehicleForm, VehicleInspection, VehResult } from '../lib/types';
import { PHOTO_STATUS, countBy, errMsg, nowTime, pad2, photoStatus, today } from '../lib/utils';

const VEH_OPTS = [
  { v: 1 as VehResult, label: 'ผ่าน', cls: 'p' as const },
  { v: 2 as VehResult, label: 'ไม่ผ่าน', cls: 'f' as const },
  { v: 3 as VehResult, label: 'N/A', cls: 'x' as const },
];

const blankForm = (keep?: Partial<VehicleForm>): VehicleForm => ({
  id: null, date: today(), time: nowTime(), dman: '', h1: '', h2: '',
  plate: '', mileage: '', note: '', results: {}, photos: {}, ...keep,
});

export function VehiclePage() {
  const { checkItems, photoSlots, nameOf } = useMaster();
  const toast = useToast();
  const items = checkItems.filter((i) => i.active);
  const total = items.length;

  const [f, setF] = useState<VehicleForm>(() => blankForm());
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

  const set = <K extends keyof VehicleForm>(k: K, v: VehicleForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const done = Object.keys(f.results).length;
  const fails = countBy(f.results, 2);
  const photoCount = Object.keys(f.photos).length;
  const pStatus = photoStatus(photoCount, photoSlots.length);

  const formUrls = useSignedUrls(Object.values(f.photos));

  function setResult(no: number, v: VehResult | undefined) {
    setF((p) => {
      const r = { ...p.results };
      if (v === undefined) delete r[no]; else r[no] = v;
      return { ...p, results: r };
    });
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
    if (f.mileage && !/^\d+$/.test(f.mileage.trim())) return toast('เลขไมล์ต้องเป็นตัวเลข');
    const dup = records.find((r) => r.plate === f.plate.trim() && r.id !== f.id);
    if (dup) return toast(`ทะเบียน ${dup.plate} มีบันทึกของวันนี้แล้ว กด "แก้ไข" ที่รายการด้านขวาแทน`);
    setSaving(true);
    try {
      // photos that the edited record had but this form no longer references
      const prev = f.id ? records.find((r) => r.id === f.id) : undefined;
      const kept = new Set(Object.values(f.photos));
      const orphaned = Object.values(prev?.photos ?? {}).filter((p) => !kept.has(p));
      await saveVehicleInspection(f);
      if (orphaned.length) removePhotos(orphaned).catch(() => {});
      setFresh(new Set());
      setF(blankForm({ date: f.date, dman: f.dman, h1: f.h1, h2: f.h2 }));
      toast('บันทึกการตรวจรถแล้ว');
      reload();
    } catch (e) {
      toast('บันทึกไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  function edit(r: VehicleInspection) {
    const results: Record<number, VehResult> = {};
    Object.entries(r.results ?? {}).forEach(([k, v]) => { results[Number(k)] = v; });
    setF({
      id: r.id, date: r.inspect_date, time: (r.inspect_time ?? '').slice(0, 5), dman: r.dman_id,
      h1: r.helper1_id ?? '', h2: r.helper2_id ?? '', plate: r.plate, mileage: r.mileage?.toString() ?? '',
      note: r.note, results, photos: { ...(r.photos ?? {}) },
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(r: VehicleInspection) {
    try {
      await deleteVehicleInspection(r);
      if (f.id === r.id) setF(blankForm({ date: f.date }));
      toast('ลบแล้ว');
      reload();
    } catch (e) { toast('ลบไม่สำเร็จ: ' + errMsg(e)); }
  }

  return (
    <div className="two">
      <section className="panel">
        <div className="row spread">
          <h2>{f.id ? 'แก้ไขการตรวจรถ' : 'ตรวจรถประจำวัน'}</h2>
          {f.id && <button className="btn ghost sm" onClick={() => setF(blankForm({ date: f.date }))}>ยกเลิกแก้ไข</button>}
        </div>
        <div className="grid">
          <label>วันที่<input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label>D-Man<EmployeeSelect value={f.dman} onChange={(v) => set('dman', v)} blank="เลือกผู้ตรวจ" exclude={[f.h1, f.h2]} /></label>
          <label>Helper 1<EmployeeSelect value={f.h1} onChange={(v) => set('h1', v)} blank="ไม่มี" exclude={[f.dman, f.h2]} /></label>
          <label>Helper 2<EmployeeSelect value={f.h2} onChange={(v) => set('h2', v)} blank="ไม่มี" exclude={[f.dman, f.h1]} /></label>
          <label>ทะเบียนรถ<PlateInput id="v-plate" value={f.plate} onChange={(v) => set('plate', v)} /></label>
          <label>เลขไมล์<input inputMode="numeric" value={f.mileage} onChange={(e) => set('mileage', e.target.value)} /></label>
          <label>เวลาตรวจ<input type="time" value={f.time} onChange={(e) => set('time', e.target.value)} /></label>
        </div>

        <div className="row spread section-head">
          <b>รายการตรวจ <span className="mono">{done}/{total}</span></b>
          <button className="btn ghost sm" type="button"
            onClick={() => set('results', Object.fromEntries(items.map((i) => [i.item_no, 1 as VehResult])))}>
            ผ่านทั้งหมด
          </button>
        </div>
        <div className="prog" aria-hidden="true"><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
        <div className="checks">
          {items.map((it) => (
            <div className="check" key={it.item_no}>
              <div><span className="n">{pad2(it.item_no)}</span><span className="t">{it.name}</span></div>
              <div className="h">{it.hint}</div>
              <Seg label={`ข้อ ${it.item_no}`} value={f.results[it.item_no]} options={VEH_OPTS}
                onChange={(v) => setResult(it.item_no, v)} />
            </div>
          ))}
        </div>

        <div className="section-head"><b>ภาพถ่ายรถ และ PPE</b> <span className="note mono">{photoCount}/{photoSlots.length}</span></div>
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

        <label className="mt">ข้อบกพร่อง / หมายเหตุ
          <textarea value={f.note} onChange={(e) => set('note', e.target.value)} />
        </label>
        <div className="row spread mt">
          <span className={`note ${fails ? 'fail-text' : ''}`}>
            {fails ? `พบ ${fails} ข้อไม่ผ่าน ผลตรวจ: ไม่ผ่าน` : done ? 'ผลตรวจ: ผ่าน' : 'ยังไม่ได้ตรวจ'}
          </span>
          <button className="btn" type="button" disabled={saving || uploading !== null} onClick={save}>
            {saving ? 'กำลังบันทึก…' : 'บันทึกการตรวจ'}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>บันทึกของวันที่ <span className="mono">{f.date}</span></h2>
        <RecordList records={records} total={total} nameOf={nameOf} onEdit={edit} onDelete={remove} />
      </section>
    </div>
  );
}

function RecordList(props: {
  records: VehicleInspection[];
  total: number;
  nameOf: (id?: string | null) => string;
  onEdit: (r: VehicleInspection) => void;
  onDelete: (r: VehicleInspection) => void;
}) {
  const urls = useSignedUrls(props.records.flatMap((r) => Object.values(r.photos ?? {})));
  if (!props.records.length) return <div className="empty">ยังไม่มีบันทึกของวันนี้ กรอกฟอร์มแล้วกดบันทึก</div>;
  return (
    <>
      {props.records.map((r) => (
        <div className="emp" key={r.id}>
          <div className="row spread">
            <b>{r.plate}</b>
            <span className={`pill ${r.fail_count ? 'f' : 'p'}`}>{r.fail_count ? `${r.fail_count} ข้อไม่ผ่าน` : 'ผ่าน'}</span>
          </div>
          <div className="note">
            D-Man {props.nameOf(r.dman_id)}
            {r.helper1_id && ` · H1 ${props.nameOf(r.helper1_id)}`}
            {r.helper2_id && ` · H2 ${props.nameOf(r.helper2_id)}`}
            {` · ${(r.inspect_time ?? '').slice(0, 5)} · ไมล์ ${r.mileage ?? '-'} · ตรวจ ${r.filled_count}/${props.total} · ภาพ ${PHOTO_STATUS[r.photo_status]}`}
          </div>
          {r.note && <div className="note">{r.note}</div>}
          {Object.keys(r.photos ?? {}).length > 0 && (
            <div className="thumbs">
              {Object.entries(r.photos).map(([slot, p]) => urls[p] && (
                <a key={slot} href={urls[p]} target="_blank" rel="noopener noreferrer"><img src={urls[p]} alt={slot} /></a>
              ))}
            </div>
          )}
          <div className="row">
            <button className="btn ghost sm" onClick={() => props.onEdit(r)}>แก้ไข</button>
            <ConfirmDelete onConfirm={() => props.onDelete(r)} />
          </div>
        </div>
      ))}
    </>
  );
}
