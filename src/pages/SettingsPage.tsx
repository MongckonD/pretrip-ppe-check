import { useEffect, useState } from 'react';
import { useMaster } from '../components/MasterContext';
import { ConfirmDelete } from '../components/Fields';
import { useToast } from '../components/Toast';
import { deleteVehicle, isTestMode, resetDemo, upsertEmployee, upsertVehicle } from '../lib/api';
import type { Employee, Vehicle } from '../lib/types';
import { errMsg, pad2 } from '../lib/utils';

function ConfirmAction(props: { label: string; confirm: string; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  return ask ? (
    <>
      <button className="btn sm" onClick={() => { setAsk(false); props.onConfirm(); }}>{props.confirm}</button>
      <button className="btn ghost sm" onClick={() => setAsk(false)}>ยกเลิก</button>
    </>
  ) : (
    <button className="btn ghost sm" onClick={() => setAsk(true)}>{props.label}</button>
  );
}

export function SettingsPage() {
  const master = useMaster();
  const toast = useToast();
  const [emps, setEmps] = useState<Employee[]>(master.employees);
  const [vehs, setVehs] = useState<Vehicle[]>(master.vehicles);
  const [newPlate, setNewPlate] = useState('');
  const [newType, setNewType] = useState('');

  useEffect(() => setEmps(master.employees), [master.employees]);
  useEffect(() => setVehs(master.vehicles), [master.vehicles]);

  async function run(fn: () => Promise<void>, ok = 'บันทึกแล้ว') {
    try { await fn(); await master.reload(); toast(ok); }
    catch (e) { toast('บันทึกไม่สำเร็จ: ' + errMsg(e)); }
  }

  const editEmp = (i: number, patch: Partial<Employee>) =>
    setEmps((l) => l.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const saveEmp = (i: number) => {
    const e = emps[i];
    const orig = master.employees.find((x) => x.id === e.id);
    if (orig && orig.name === e.name && orig.role === e.role) return;
    run(() => upsertEmployee(e));
  };

  function addEmp() {
    const nums = master.employees.map((e) => Number(e.id.replace(/\D/g, '')) || 0);
    const id = 'EMP' + pad2(Math.max(0, ...nums) + 1);
    run(() => upsertEmployee({ id, name: '', role: '', active: true }), `เพิ่ม ${id} แล้ว`);
  }

  const editVeh = (i: number, patch: Partial<Vehicle>) =>
    setVehs((l) => l.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const saveVeh = (i: number) => {
    const v = vehs[i];
    const orig = master.vehicles.find((x) => x.id === v.id);
    if (!v.plate.trim()) return toast('ทะเบียนว่างไม่ได้');
    if (orig && orig.plate === v.plate && orig.type === v.type) return;
    run(() => upsertVehicle({ ...v, plate: v.plate.trim() }));
  };

  function addVeh() {
    if (!newPlate.trim()) return toast('กรอกทะเบียนก่อน');
    run(async () => {
      await upsertVehicle({ plate: newPlate.trim(), type: newType.trim(), active: true });
      setNewPlate(''); setNewType('');
    }, 'เพิ่มทะเบียนแล้ว');
  }

  return (
    <div className="two">
      <section className="panel">
        <h2>พนักงาน</h2>
        {emps.map((e, i) => (
          <div className="cfg" key={e.id}>
            <span className="mono code">{e.id}</span>
            <input aria-label="ชื่อ" placeholder="ชื่อ-นามสกุล" value={e.name}
              onChange={(ev) => editEmp(i, { name: ev.target.value })} onBlur={() => saveEmp(i)} />
            <input aria-label="ตำแหน่ง" placeholder="ตำแหน่ง" value={e.role}
              onChange={(ev) => editEmp(i, { role: ev.target.value })} onBlur={() => saveEmp(i)} />
            <button className={`btn sm ${e.active ? 'on' : 'ghost'}`}
              onClick={() => run(() => upsertEmployee({ ...e, active: !e.active }))}>
              {e.active ? 'ใช้งาน' : 'ปิดอยู่'}
            </button>
          </div>
        ))}
        <div className="mt"><button className="btn ghost sm" onClick={addEmp}>เพิ่มพนักงาน</button></div>
        <p className="note">พนักงานที่เคยมีบันทึกจะลบไม่ได้ ให้กด "ปิดอยู่" แทน เพื่อเก็บประวัติไว้</p>
      </section>

      <section className="panel">
        <h2>ทะเบียนรถ</h2>
        {vehs.length ? vehs.map((v, i) => (
          <div className="cfg v" key={v.id}>
            <input aria-label="ทะเบียน" placeholder="ทะเบียน" value={v.plate}
              onChange={(ev) => editVeh(i, { plate: ev.target.value })} onBlur={() => saveVeh(i)} />
            <input aria-label="ประเภทรถ" placeholder="ประเภทรถ" value={v.type}
              onChange={(ev) => editVeh(i, { type: ev.target.value })} onBlur={() => saveVeh(i)} />
            <div className="row"><ConfirmDelete onConfirm={() => run(() => deleteVehicle(v.id), 'ลบแล้ว')} /></div>
          </div>
        )) : <div className="empty">ยังไม่มีทะเบียนรถ เพิ่มแล้วจะเลือกได้ในแท็บตรวจรถและ PPE</div>}
        <div className="cfg v mt">
          <input aria-label="ทะเบียนใหม่" placeholder="ทะเบียนใหม่" value={newPlate} onChange={(e) => setNewPlate(e.target.value)} />
          <input aria-label="ประเภทรถใหม่" placeholder="ประเภทรถ" value={newType} onChange={(e) => setNewType(e.target.value)} />
          <button className="btn sm" onClick={addVeh}>เพิ่ม</button>
        </div>
        <p className="note">รหัส: 1 = ผ่าน/มี, 2 = ไม่ผ่าน/ไม่มี, 3 = ไม่เกี่ยวข้อง (ใช้กับรถเท่านั้น)</p>
        {!isTestMode && <p className="note">ข้อมูลเก็บใน Supabase (PostgreSQL) และใช้ร่วมกันทุกเครื่อง</p>}
      </section>

      {isTestMode && (
        <section className="panel test-panel">
          <h2>โหมดทดสอบ</h2>
          <p className="note">
            ตอนนี้ยังไม่ได้เชื่อม Supabase ข้อมูลทั้งหมดเก็บในเบราว์เซอร์นี้เท่านั้น (รูปถ่ายเก็บใน IndexedDB)
            เมื่อใส่ค่าใน <code>.env</code> แอปจะสลับไปใช้ฐานข้อมูลจริงเอง
          </p>
          <div className="row">
            <ConfirmAction label="สร้างข้อมูลตัวอย่างใหม่" confirm="ยืนยัน ล้างแล้วสร้างใหม่"
              onConfirm={() => run(() => resetDemo(false), 'สร้างข้อมูลตัวอย่างใหม่แล้ว')} />
            <ConfirmAction label="ล้างบันทึกการตรวจทั้งหมด" confirm="ยืนยัน ล้างทั้งหมด"
              onConfirm={() => run(() => resetDemo(true), 'ล้างบันทึกแล้ว')} />
          </div>
        </section>
      )}
    </div>
  );
}
