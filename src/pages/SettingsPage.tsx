/**
 * Admin "ตั้งค่า" (/admin/settings): employees · vehicles · system users (+ test-mode tools).
 * Each part is its own box with a header (icon, title, count, what it is for) and the add form at the bottom.
 * Status is a green / grey switch (red is kept for delete only).
 */
import { useEffect, useRef, useState } from 'react';
import { useMe } from '../components/Auth';
import { ActiveSwitch, CFG_PAGE, CfgHead, CfgPager } from '../components/CfgUi';
import { useMaster } from '../components/MasterContext';
import { UsersPanel } from '../components/UsersPanel';
import { ImportBox } from '../components/ImportEmployees';
import { TruckIcon, UserIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { isTestMode, resetDemo, upsertEmployee, upsertVehicle } from '../lib/api';
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
  const me = useMe();
  const toast = useToast();
  const [emps, setEmps] = useState<Employee[]>(master.employees);
  const [vehs, setVehs] = useState<Vehicle[]>(master.vehicles);
  const [newPlate, setNewPlate] = useState('');
  const [newType, setNewType] = useState('');
  const [empPage, setEmpPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newEmp, setNewEmp] = useState({ code: '', name: '', role: '' });
  const [vehPage, setVehPage] = useState(0);

  // rows the user is editing but has not saved yet: a reload from the server must not wipe what they typed
  const dirtyEmp = useRef(new Set<string>());
  const dirtyVeh = useRef(new Set<string>());

  useEffect(() => setEmps((prev) => master.employees.map((m) =>
    dirtyEmp.current.has(m.id) ? prev.find((p) => p.id === m.id) ?? m : m)), [master.employees]);
  // no delete: a vehicle / employee no longer used is switched off (its history stays); every vehicle is listed, on and off
  useEffect(() => setVehs((prev) => master.vehicles.map((m) =>
    dirtyVeh.current.has(m.id) ? prev.find((p) => p.id === m.id) ?? m : m)), [master.vehicles]);

  async function run(fn: () => Promise<void>, ok = 'บันทึกแล้ว') {
    try { await fn(); await master.reload(); toast(ok); }
    catch (e) { toast('บันทึกไม่สำเร็จ: ' + errMsg(e)); }
  }

  const editEmp = (i: number, patch: Partial<Employee>) => {
    dirtyEmp.current.add(emps[i].id);
    setEmps((l) => l.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  };
  /** Save the whole row (code + name + role + active) as it is on screen. */
  const saveEmpRow = (e: Employee) => {
    dirtyEmp.current.delete(e.id);
    run(() => upsertEmployee(e));
  };
  const saveEmp = (i: number) => {
    const e = emps[i];
    dirtyEmp.current.delete(e.id);
    const orig = master.employees.find((x) => x.id === e.id);
    if (orig && orig.name === e.name && orig.role === e.role && (orig.code ?? '') === (e.code ?? '')) return;
    run(() => upsertEmployee(e));
  };

  /** nothing is saved until the form is filled and "บันทึก" pressed (a mis-click adds nothing) */
  function addEmp() {
    const code = newEmp.code.trim().toUpperCase();
    const name = newEmp.name.trim();
    if (!code || !name) return toast('กรอกรหัสพนักงานและชื่อ-นามสกุลก่อน');
    if (master.employees.some((e) => (e.code ?? '') === code)) return toast(`รหัสพนักงาน ${code} มีอยู่แล้ว`);
    const nums = master.employees.map((e) => Number(e.id.replace(/\D/g, '')) || 0);
    const id = 'EMP' + pad2(Math.max(0, ...nums) + 1);
    run(async () => {
      await upsertEmployee({ id, name, role: newEmp.role, active: true, code });
      setNewEmp({ code: '', name: '', role: '' });
      setAdding(false);
      setEmpPage(Math.floor(emps.length / CFG_PAGE)); // the new row is the last one: show its page
    }, `เพิ่ม ${name} แล้ว`);
  }

  const editVeh = (i: number, patch: Partial<Vehicle>) => {
    dirtyVeh.current.add(vehs[i].id);
    setVehs((l) => l.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  };
  const saveVeh = (i: number) => {
    const v = vehs[i];
    dirtyVeh.current.delete(v.id);
    const orig = master.vehicles.find((x) => x.id === v.id);
    if (!v.plate.trim()) return toast('ทะเบียนว่างไม่ได้');
    if (orig && orig.plate === v.plate && orig.type === v.type) return;
    run(() => upsertVehicle({ ...v, plate: v.plate.trim() }));
  };

  /** switch a vehicle on / off (the server refuses to switch off a vehicle that still has stores to deliver) */
  const toggleVeh = (v: Vehicle) => {
    dirtyVeh.current.delete(v.id);
    run(() => upsertVehicle({ ...v, plate: v.plate.trim(), active: !v.active }), v.active ? `ปิดใช้งานรถ ${v.plate} แล้ว` : `เปิดใช้งานรถ ${v.plate} แล้ว`);
  };

  function addVeh() {
    if (!newPlate.trim()) return toast('กรอกทะเบียนก่อน');
    run(async () => {
      await upsertVehicle({ plate: newPlate.trim(), type: newType.trim(), active: true });
      setNewPlate(''); setNewType('');
    }, 'เพิ่มทะเบียนแล้ว');
  }

  const activeEmps = emps.filter((e) => e.active).length;
  const activeVehs = vehs.filter((v) => v.active).length;
  // 10 rows per page; the page number is clamped when the list gets shorter
  const ep = Math.min(empPage, Math.max(0, Math.ceil(emps.length / CFG_PAGE) - 1));
  const vp = Math.min(vehPage, Math.max(0, Math.ceil(vehs.length / CFG_PAGE) - 1));

  return (
    <div className="two cfg-page">
      <section className="panel cfg-box">
        <CfgHead icon={<UserIcon />} title="พนักงาน" count={`${activeEmps}/${emps.length} ใช้งาน`} />
        <div className="cfg-table">
          <div className="cfg-row cfg-th" aria-hidden>
            <span>รหัสพนักงาน</span><span>ชื่อ-นามสกุล</span><span>ตำแหน่ง</span><span>สถานะ</span>
          </div>
          {emps.slice(ep * CFG_PAGE, ep * CFG_PAGE + CFG_PAGE).map((e, k) => { const i = ep * CFG_PAGE + k; return (
            <div className={`cfg-row ${e.active ? '' : 'off'}`} key={e.id}>
              <input className="mono" aria-label={`รหัสพนักงาน แถวที่ ${i + 1}`} placeholder="รหัสพนักงาน" inputMode="text" autoCapitalize="characters"
                value={e.code ?? ''} maxLength={20}
                onChange={(ev) => editEmp(i, { code: ev.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} onBlur={() => saveEmp(i)} />
              <input aria-label={`ชื่อ-นามสกุล แถวที่ ${i + 1}`} placeholder="ชื่อ-นามสกุล" value={e.name}
                onChange={(ev) => editEmp(i, { name: ev.target.value })} onBlur={() => saveEmp(i)} />
              <select aria-label={`ตำแหน่ง แถวที่ ${i + 1}`} value={e.role}
                onChange={(ev) => {
                  const role = ev.target.value;
                  setEmps((l) => l.map((x, j) => (j === i ? { ...x, role } : x)));
                  saveEmpRow({ ...e, role });
                }}>
                <option value="">ไม่ระบุตำแหน่ง</option>
                {[...master.roles, ...(e.role && !master.roles.includes(e.role) ? [e.role] : [])].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <div className="row cfg-state">
                <ActiveSwitch on={e.active} label={`สถานะ แถวที่ ${i + 1}`} onToggle={() => saveEmpRow({ ...e, active: !e.active })} />
              </div>
            </div>
          ); })}
        </div>
        <CfgPager page={ep} total={emps.length} onPage={setEmpPage} />
        <div className="cfg-add">
          {!adding ? (
            <button className="btn sm" onClick={() => setAdding(true)}>＋ เพิ่มพนักงาน</button>
          ) : (<>
            <b className="cfg-add-title">เพิ่มพนักงานใหม่</b>
            <div className="cfg-row cfg-new">
              <input className="mono" aria-label="รหัสพนักงานใหม่" placeholder="รหัสพนักงาน *" maxLength={20} autoFocus
                value={newEmp.code} onChange={(ev) => setNewEmp({ ...newEmp, code: ev.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} />
              <input aria-label="ชื่อ-นามสกุลใหม่" placeholder="ชื่อ-นามสกุล *" value={newEmp.name}
                onChange={(ev) => setNewEmp({ ...newEmp, name: ev.target.value })} />
              <select aria-label="ตำแหน่งใหม่" value={newEmp.role} onChange={(ev) => setNewEmp({ ...newEmp, role: ev.target.value })}>
                <option value="">ไม่ระบุตำแหน่ง</option>
                {master.roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="row">
                <button className="btn sm" onClick={addEmp} disabled={!newEmp.code.trim() || !newEmp.name.trim()}>บันทึก</button>
                <button className="btn ghost sm" onClick={() => { setAdding(false); setNewEmp({ code: '', name: '', role: '' }); }}>ยกเลิก</button>
              </div>
            </div>
          </>)}
        </div>
        <p className="note cfg-foot">พนักงานที่ไม่ใช้แล้วให้ปิดสถานะเป็น "ปิดอยู่" — ประวัติยังอยู่ครบ และเปิดกลับได้ทุกเมื่อ</p>
      </section>

      <section className="panel cfg-box">
        <CfgHead icon={<TruckIcon />} title="ทะเบียนรถ" count={`${activeVehs}/${vehs.length} ใช้งาน`} />
        <div className="cfg-table">
          {vehs.length > 0 && (
            <div className="cfg-row v cfg-th" aria-hidden><span>ทะเบียน</span><span>ประเภทรถ</span><span>สถานะ</span></div>
          )}
          {vehs.length ? vehs.slice(vp * CFG_PAGE, vp * CFG_PAGE + CFG_PAGE).map((v, k) => { const i = vp * CFG_PAGE + k; return (
            <div className={`cfg-row v ${v.active ? '' : 'off'}`} key={v.id}>
              <input aria-label="ทะเบียน" placeholder="ทะเบียน" value={v.plate}
                onChange={(ev) => editVeh(i, { plate: ev.target.value })} onBlur={() => saveVeh(i)} />
              <input aria-label="ประเภทรถ" placeholder="ประเภทรถ" value={v.type}
                onChange={(ev) => editVeh(i, { type: ev.target.value })} onBlur={() => saveVeh(i)} />
              <div className="row cfg-state"><ActiveSwitch on={v.active} label={`สถานะ รถ ${v.plate}`} onToggle={() => toggleVeh(v)} /></div>
            </div>
          ); }) : <div className="empty">ยังไม่มีทะเบียนรถ เพิ่มแล้วจะเลือกได้ในแท็บตรวจรถและ PPE</div>}
        </div>
        <CfgPager page={vp} total={vehs.length} onPage={setVehPage} />
        <p className="note cfg-foot">รถที่ไม่ใช้แล้วให้ปิดสถานะ — ประวัติยังอยู่ครบ รถที่ปิดอยู่จะไม่ขึ้นให้เลือกตอนตรวจรถ</p>
        <div className="cfg-add">
          <b className="cfg-add-title">เพิ่มรถคันใหม่</b>
          <div className="cfg-row v">
            <input aria-label="ทะเบียนใหม่" placeholder="ทะเบียน เช่น 1กก 1234" value={newPlate} onChange={(e) => setNewPlate(e.target.value)} />
            <input aria-label="ประเภทรถใหม่" placeholder="ประเภทรถ เช่น 6 ล้อ" value={newType} onChange={(e) => setNewType(e.target.value)} />
            <button className="btn sm" onClick={addVeh}>＋ เพิ่ม</button>
          </div>
        </div>
      </section>

      {me?.role === 'admin' && <UsersPanel />}
      {(me?.role === 'admin' || isTestMode) && <ImportBox />}

      {isTestMode && (
        <section className="panel test-panel">
          <h2>โหมดทดสอบ</h2>
          <p className="note">
            ตอนนี้ยังไม่ได้เชื่อม Cloudflare ข้อมูลทั้งหมดเก็บในเบราว์เซอร์นี้เท่านั้น (รูปถ่ายเก็บใน IndexedDB)
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
