import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDelete, EmployeeSelect, PlateInput } from '../components/Fields';
import { useMaster } from '../components/MasterContext';
import { useToast } from '../components/Toast';
import { deleteTripActivity, listTripActivities, saveTripActivity } from '../lib/api';
import type { TripActivity, TripForm } from '../lib/types';
import { errMsg, nowTime, today } from '../lib/utils';

const blankForm = (keep?: Partial<TripForm>): TripForm => ({
  id: null, date: today(), time: nowTime(), plate: '', dman: '', areas: [], note: '', ...keep,
});

/** Time activities: before leaving, record departure time, D-Man and the area types of the route. */
export function TimeActivitiesPage() {
  const { areaTypes, nameOf } = useMaster();
  const toast = useToast();
  const [f, setF] = useState<TripForm>(() => blankForm());
  const [records, setRecords] = useState<TripActivity[]>([]);
  const [saving, setSaving] = useState(false);

  // active area types, plus any switched-off type that the record being edited still uses
  const choices = useMemo(
    () => areaTypes.filter((a) => a.active || f.areas.includes(a.code)),
    [areaTypes, f.areas],
  );
  const areaName = useMemo(() => new Map(areaTypes.map((a) => [a.code, a.name])), [areaTypes]);

  const reload = useCallback(async () => {
    try { setRecords(await listTripActivities({ date: f.date })); }
    catch (e) { toast('โหลดข้อมูลไม่สำเร็จ: ' + errMsg(e)); }
  }, [f.date, toast]);
  useEffect(() => { reload(); }, [reload]);

  const set = <K extends keyof TripForm>(k: K, v: TripForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const toggleArea = (code: string) =>
    setF((p) => ({ ...p, areas: p.areas.includes(code) ? p.areas.filter((c) => c !== code) : [...p.areas, code] }));

  async function save() {
    if (!f.dman || !f.plate.trim()) return toast('เลือก D-Man และกรอกทะเบียนรถก่อน');
    if (!f.time) return toast('กรุณาระบุเวลาออกงาน');
    if (!f.areas.length) return toast('เลือกประเภทพื้นที่อย่างน้อย 1 อย่าง');
    const dup = records.find((r) => r.plate === f.plate.trim() && r.id !== f.id);
    if (dup) return toast(`ทะเบียน ${dup.plate} มีบันทึกของวันนี้แล้ว กด "แก้ไข" ที่รายการด้านขวาแทน`);
    setSaving(true);
    try {
      await saveTripActivity(f);
      toast('บันทึกก่อนออกงานแล้ว');
      setF(blankForm({ date: f.date, dman: f.dman }));
      reload();
    } catch (e) {
      toast('บันทึกไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  function edit(r: TripActivity) {
    setF({
      id: r.id, date: r.activity_date, time: r.depart_time.slice(0, 5), plate: r.plate, dman: r.dman_id,
      areas: [...r.area_codes], note: r.note,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(r: TripActivity) {
    try {
      await deleteTripActivity(r.id);
      if (f.id === r.id) setF(blankForm({ date: f.date }));
      toast('ลบแล้ว');
      reload();
    } catch (e) { toast('ลบไม่สำเร็จ: ' + errMsg(e)); }
  }

  // how many trips of this day go through each area type
  const dayCounts = useMemo(() => {
    const m = new Map<string, number>();
    records.forEach((r) => r.area_codes.forEach((c) => m.set(c, (m.get(c) ?? 0) + 1)));
    return areaTypes.filter((a) => m.has(a.code)).map((a) => ({ ...a, n: m.get(a.code)! }));
  }, [records, areaTypes]);

  return (
    <div className="two">
      <section className="panel">
        <div className="row spread">
          <h2>{f.id ? 'แก้ไขบันทึกก่อนออกงาน' : 'บันทึกก่อนออกงาน'}</h2>
          {f.id && <button className="btn ghost sm" onClick={() => setF(blankForm({ date: f.date }))}>ยกเลิกแก้ไข</button>}
        </div>
        <div className="grid">
          <label>วันที่<input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label>เวลาออกงาน<input type="time" value={f.time} onChange={(e) => set('time', e.target.value)} /></label>
          <label>D-Man<EmployeeSelect value={f.dman} onChange={(v) => set('dman', v)} blank="เลือก D-Man" /></label>
          <label>ทะเบียนรถ<PlateInput id="t-plate" value={f.plate} onChange={(v) => set('plate', v)} /></label>
        </div>

        <div className="row spread section-head">
          <b>ประเภทพื้นที่ <span className="note">(เลือกได้หลายอย่าง)</span></b>
          <span className="note mono">{f.areas.length}/{choices.length}</span>
        </div>
        <div className="area-grid" role="group" aria-label="ประเภทพื้นที่">
          {choices.map((a) => {
            const on = f.areas.includes(a.code);
            return (
              <button key={a.code} type="button" className="area-chip" aria-pressed={on} aria-label={a.name} onClick={() => toggleArea(a.code)}>
                <span className="area-check" aria-hidden="true">{on ? '✓' : ''}</span>
                <span>{a.name}</span>
              </button>
            );
          })}
        </div>

        <label className="mt">หมายเหตุ
          <textarea value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="เช่น เส้นทาง จุดส่งพิเศษ" />
        </label>
        <div className="row spread mt">
          <span className="note">{f.areas.length ? `เลือก ${f.areas.length} ประเภท` : 'ยังไม่ได้เลือกประเภทพื้นที่'}</span>
          <button className="btn" type="button" disabled={saving} onClick={save}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </section>

      <section className="panel">
        <h2>บันทึกของวันที่ <span className="mono">{f.date}</span></h2>
        {dayCounts.length > 0 && (
          <div className="area-summary">
            {dayCounts.map((a) => <span key={a.code} className="tag">{a.name} <b>{a.n}</b></span>)}
          </div>
        )}
        {records.length ? records.map((r) => (
          <div className="emp" key={r.id}>
            <div className="row spread">
              <b>{r.plate} <span className="mono note">{r.depart_time.slice(0, 5)}</span></b>
              <span className={`pill ${r.inspected ? 'p' : 'x'}`}>{r.inspected ? 'ตรวจรถแล้ว' : 'ยังไม่ตรวจรถ'}</span>
            </div>
            <div className="note">D-Man {nameOf(r.dman_id)}</div>
            <div className="tags">
              {r.area_codes.map((c) => <span key={c} className="tag on">{areaName.get(c) ?? c}</span>)}
            </div>
            {r.note && <div className="note">{r.note}</div>}
            <div className="row">
              <button className="btn ghost sm" onClick={() => edit(r)}>แก้ไข</button>
              <ConfirmDelete onConfirm={() => remove(r)} />
            </div>
          </div>
        )) : <div className="empty">ยังไม่มีบันทึกก่อนออกงานของวันนี้</div>}
      </section>
    </div>
  );
}
