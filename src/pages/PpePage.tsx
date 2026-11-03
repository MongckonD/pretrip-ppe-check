import { useCallback, useEffect, useState } from 'react';
import { useMaster } from '../components/MasterContext';
import { ConfirmDelete, EmployeeSelect, PlateInput, Seg } from '../components/Fields';
import { useToast } from '../components/Toast';
import { deletePpeInspection, listPpeInspections, savePpeInspections } from '../lib/api';
import type { PpeForm, PpeInspection, PpeResult } from '../lib/types';
import { errMsg, today } from '../lib/utils';

const PPE_OPTS = [
  { v: 1 as PpeResult, label: 'มี', cls: 'p' as const },
  { v: 2 as PpeResult, label: 'ไม่มี', cls: 'f' as const },
];

export function PpePage() {
  const { activeEmployees, ppeItems, nameOf } = useMaster();
  const toast = useToast();
  const items = ppeItems.filter((p) => p.active);

  const [f, setF] = useState<PpeForm>({ date: today(), plate: '', inspector: '', rows: {} });
  const [records, setRecords] = useState<PpeInspection[]>([]);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try { setRecords(await listPpeInspections({ date: f.date })); }
    catch (e) { toast('โหลดข้อมูลไม่สำเร็จ: ' + errMsg(e)); }
  }, [f.date, toast]);
  useEffect(() => { reload(); }, [reload]);

  function setCell(emp: string, code: string, v: PpeResult | undefined) {
    setF((p) => {
      const row = { ...(p.rows[emp] ?? {}) };
      if (v === undefined) delete row[code]; else row[code] = v;
      return { ...p, rows: { ...p.rows, [emp]: row } };
    });
  }

  function allHave() {
    const full = Object.fromEntries(items.map((i) => [i.code, 1 as PpeResult]));
    setF((p) => ({ ...p, rows: Object.fromEntries(activeEmployees.map((e) => [e.id, { ...full }])) }));
  }

  async function save() {
    if (!f.inspector) return toast('เลือกผู้ตรวจ D-Man ก่อน');
    const filled = Object.values(f.rows).filter((r) => Object.keys(r).length).length;
    if (!filled) return toast('ยังไม่ได้ตรวจ PPE ของใคร');
    setSaving(true);
    try {
      const n = await savePpeInspections(f);
      setF((p) => ({ ...p, rows: {} }));
      toast(`บันทึก PPE ${n} คนแล้ว`);
      reload();
    } catch (e) {
      toast('บันทึกไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  function edit(r: PpeInspection) {
    setF((p) => ({
      ...p, plate: r.plate || p.plate, inspector: r.inspector_id || p.inspector,
      rows: { ...p.rows, [r.employee_id]: { ...r.results } },
    }));
  }

  async function remove(id: string) {
    try { await deletePpeInspection(id); toast('ลบแล้ว'); reload(); }
    catch (e) { toast('ลบไม่สำเร็จ: ' + errMsg(e)); }
  }

  return (
    <div className="two">
      <section className="panel">
        <h2>ตรวจ PPE พนักงาน</h2>
        <div className="grid">
          <label>วันที่<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label>ทะเบียนรถ<PlateInput id="p-plate" value={f.plate} onChange={(v) => setF({ ...f, plate: v })} /></label>
          <label>ผู้ตรวจ D-Man<EmployeeSelect value={f.inspector} onChange={(v) => setF({ ...f, inspector: v })} blank="เลือกผู้ตรวจ" /></label>
        </div>
        <div className="mt">
          {activeEmployees.length ? activeEmployees.map((e) => (
            <div className="emp" key={e.id}>
              <div><b>{e.name || e.id}</b> <span className="note">{e.id}{e.role && ` · ${e.role}`}</span></div>
              <div className="ppeit">
                {items.map((p) => (
                  <div key={p.code}>
                    <span>{p.name}</span>
                    <Seg compact label={`${e.id} ${p.name}`} value={f.rows[e.id]?.[p.code]} options={PPE_OPTS}
                      onChange={(v) => setCell(e.id, p.code, v)} />
                  </div>
                ))}
              </div>
            </div>
          )) : <div className="empty">ยังไม่มีพนักงานที่ใช้งาน เพิ่มได้ที่แท็บตั้งค่า</div>}
        </div>
        <div className="row spread mt">
          <button className="btn ghost sm" type="button" onClick={allHave}>มีครบทุกคน</button>
          <button className="btn" type="button" disabled={saving} onClick={save}>{saving ? 'กำลังบันทึก…' : 'บันทึก PPE'}</button>
        </div>
      </section>

      <section className="panel">
        <h2>บันทึกของวันที่ <span className="mono">{f.date}</span></h2>
        {records.length ? records.map((r) => (
          <div className="emp" key={r.id}>
            <div className="row spread">
              <b>{nameOf(r.employee_id)}</b>
              <span className={`pill ${r.status === 'ครบ' ? 'p' : 'f'}`}>{r.status}</span>
            </div>
            <div className="note">
              {items.map((p) => `${p.name} ${r.results?.[p.code] === 1 ? 'มี' : r.results?.[p.code] === 2 ? 'ไม่มี' : '–'}`).join(' · ')}
            </div>
            <div className="note">ผู้ตรวจ {nameOf(r.inspector_id)}{r.plate && ` · ${r.plate}`}</div>
            <div className="row">
              <button className="btn ghost sm" onClick={() => edit(r)}>แก้ไข</button>
              <ConfirmDelete onConfirm={() => remove(r.id)} />
            </div>
          </div>
        )) : <div className="empty">ยังไม่มีบันทึก PPE ของวันนี้</div>}
      </section>
    </div>
  );
}
