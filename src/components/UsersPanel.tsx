import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createUser, deleteUser, listUsers, resetUserPassword, updateUser, type AppUser, type Role } from '../lib/api';
import { errMsg } from '../lib/utils';
import { ROLE_LABEL, useMe } from './Auth';
import { useMaster } from './MasterContext';
import { useToast } from './Toast';

const ROLES: Role[] = ['user', 'admin'];
const ROLE_HINT = 'ผู้ใช้ (user) = พนักงานทุกคน บันทึกการตรวจรถ / PPE และดูข้อมูล · ผู้ดูแลระบบ (admin) = ทำได้ทุกอย่าง รวมถึงแท็บตั้งค่าและจัดการผู้ใช้';

/** Admin-only: create users, change role, deactivate, unlock, set a new password. */
export function UsersPanel() {
  const me = useMe();
  const { employees } = useMaster();
  const toast = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [form, setForm] = useState({ id: '', display_name: '', role: 'user' as Role, employee_id: '', password: '' });
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setUsers(await listUsers()); }
    catch (e) { toast('โหลดรายชื่อผู้ใช้ไม่สำเร็จ: ' + errMsg(e)); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { reload(); }, [reload]);

  async function run(fn: () => Promise<void>, ok: string) {
    try { await fn(); toast(ok); await reload(); }
    catch (e) { toast('ไม่สำเร็จ: ' + errMsg(e)); }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createUser(form);
      toast(`เพิ่มผู้ใช้ ${form.id} แล้ว — แจ้งชื่อผู้ใช้และรหัสผ่านให้เจ้าตัว`);
      setForm({ id: '', display_name: '', role: 'user', employee_id: '', password: '' });
      await reload();
    } catch (err) { toast('เพิ่มผู้ใช้ไม่สำเร็จ: ' + errMsg(err)); }
    finally { setBusy(false); }
  }

  /** employee id → the account it is linked to */
  const linkedTo = new Map(users.filter((u) => u.employee_id).map((u) => [u.employee_id as string, u.id]));
  /** employee options; ones linked to another account are shown but cannot be picked */
  const empOptions = (self?: string) => employees.map((e) => {
    const owner = linkedTo.get(e.id);
    const taken = !!owner && owner !== self;
    return (
      <option key={e.id} value={e.id} disabled={taken}>
        {e.id}{e.name && ` · ${e.name}`}{taken ? ` — ผูกกับ ${owner} แล้ว` : ''}
      </option>
    );
  });
  const formTaken = form.employee_id ? linkedTo.get(form.employee_id) : undefined;

  /** permanent delete — the admin must type the username to confirm */
  async function remove(u: AppUser) {
    const typed = window.prompt(
      `ลบบัญชี "${u.id}" ถาวร — กู้คืนไม่ได้\n\n`
      + `• ลบ: บัญชี การเข้าสู่ระบบ ความยินยอม และใบขับขี่ (รวมรูป) ของบัญชีนี้\n`
      + `• ยังอยู่: บันทึกตรวจรถ / PPE / เวลาทำงาน แต่จะไม่แสดงว่าบัญชีนี้เป็นผู้บันทึก\n`
      + `ถ้าแค่ไม่ให้เข้าใช้ ให้กดปุ่ม "ใช้งาน" เพื่อปิดบัญชีแทน\n\n`
      + `พิมพ์ชื่อผู้ใช้ ${u.id} เพื่อยืนยันการลบ`,
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== u.id) return toast('ชื่อผู้ใช้ไม่ตรง — ยังไม่ได้ลบ');
    await run(() => deleteUser(u.id), `ลบบัญชี ${u.id} แล้ว`);
  }

  async function doReset(e: FormEvent) {
    e.preventDefault();
    if (!resetFor) return;
    const id = resetFor;
    await run(() => resetUserPassword(id, resetPw), `ตั้งรหัสผ่านใหม่ให้ ${id} แล้ว — ใช้รหัสนี้ login ได้เลย`);
    setResetFor(null); setResetPw('');
  }

  return (
    <section className="panel users-panel">
      <h2>ผู้ใช้งานระบบ</h2>
      <p className="note">{ROLE_HINT}</p>
      {loading ? <div className="empty">กำลังโหลด…</div> : users.map((u) => (
        <div className="emp" key={u.id}>
          <div className="row spread">
            <div>
              <b className="mono">{u.id}</b> {u.display_name && <span>· {u.display_name}</span>}
              {u.id === me?.id && <span className="note"> (คุณ)</span>}
            </div>
            <div className="row">
              {!u.active && <span className="pill f">ปิดอยู่</span>}
              {u.locked && <span className="pill f">ถูกล็อก</span>}
              {u.must_change_password && <span className="pill x">รอเปลี่ยนรหัส</span>}
            </div>
          </div>
          <div className="note">
            {u.employee_id ? `พนักงาน ${u.employee_id} · ` : ''}
            เข้าใช้ล่าสุด {u.last_login_at ? new Date(u.last_login_at).toLocaleString('th-TH') : '—'}
          </div>
          <div className="row mt-s">
            <select aria-label={`สิทธิ์ของ ${u.id}`} value={u.role}
              onChange={(e) => run(() => updateUser(u.id, { role: e.target.value as Role }), 'เปลี่ยนสิทธิ์แล้ว')}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className={`btn sm ${u.active ? 'on' : 'ghost'}`}
              onClick={() => run(() => updateUser(u.id, { active: !u.active }), u.active ? 'ปิดบัญชีแล้ว' : 'เปิดบัญชีแล้ว')}>
              {u.active ? 'ใช้งาน' : 'ปิดอยู่'}
            </button>
            <select aria-label={`พนักงานที่ผูกกับ ${u.id}`} value={u.employee_id ?? ''}
              onChange={(e) => run(() => updateUser(u.id, { employee_id: e.target.value }),
                e.target.value ? `ผูก ${u.id} กับพนักงาน ${e.target.value} แล้ว` : `ยกเลิกการผูกพนักงานของ ${u.id} แล้ว`)}>
              <option value="">ไม่ผูกพนักงาน</option>
              {empOptions(u.id)}
            </select>
            {u.locked && <button className="btn ghost sm" onClick={() => run(() => updateUser(u.id, { unlock: true }), 'ปลดล็อกแล้ว')}>ปลดล็อก</button>}
            <button className="btn ghost sm" onClick={() => { setResetFor(u.id); setResetPw(''); }}>ตั้งรหัสผ่านใหม่</button>
            {u.id !== me?.id && <button className="btn danger sm" onClick={() => remove(u)}>ลบผู้ใช้</button>}
          </div>
          {resetFor === u.id && (
            <form className="row mt-s" onSubmit={doReset}>
              <input type="text" aria-label="รหัสผ่านใหม่" placeholder="รหัสผ่านใหม่ (8 ตัวขึ้นไป)" value={resetPw}
                onChange={(e) => setResetPw(e.target.value)} autoComplete="off" required />
              <button className="btn sm" type="submit">บันทึก</button>
              <button className="btn ghost sm" type="button" onClick={() => setResetFor(null)}>ยกเลิก</button>
            </form>
          )}
        </div>
      ))}

      <form className="add-user" onSubmit={add}>
        <b>เพิ่มผู้ใช้</b>
        <div className="grid">
          <label>ชื่อผู้ใช้ (id_user)
            <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="เช่น somchai"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          </label>
          <label>ชื่อที่แสดง
            <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </label>
          <label>สิทธิ์
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label>ผูกกับพนักงาน
            <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
              <option value="">ไม่ผูก</option>
              {empOptions()}
            </select>
            {formTaken && <span className="error-text">พนักงานนี้ผูกกับ {formTaken} แล้ว</span>}
          </label>
          <label>รหัสผ่าน
            <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="8 ตัวขึ้นไป" autoComplete="off" required />
          </label>
        </div>
        <div className="row spread mt-s">
          <span className="note">รหัสผ่านนี้ใช้ login ได้เลย · ผู้ใช้เปลี่ยนเองภายหลังได้ที่ปุ่ม "เปลี่ยนรหัสผ่าน"</span>
          <button className="btn sm" type="submit" disabled={busy || !!formTaken}>{busy ? 'กำลังเพิ่ม…' : 'เพิ่มผู้ใช้'}</button>
        </div>
      </form>
    </section>
  );
}
