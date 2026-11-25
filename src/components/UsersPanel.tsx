import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { createUser, deleteUser, listUsers, resetUserPassword, updateUser, type AppUser, type Role } from '../lib/api';
import { errMsg } from '../lib/utils';
import { ActiveSwitch, CfgHead } from './CfgUi';
import { ROLE_LABEL, useMe } from './Auth';
import { KeyIcon, AlertIcon, PersonAvatar } from './Icons';
import { useMaster } from './MasterContext';
import { useToast } from './Toast';

const ROLES: Role[] = ['user', 'admin'];
const PAGE = 10;

/** Admin-only: create users, change role, deactivate, unlock, set a new password. */
export function UsersPanel() {
  const me = useMe();
  const { employees } = useMaster();
  const toast = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetFor, setResetFor] = useState<string | null>(null);
  // permanent delete: typed confirmation shown on the page (never window.prompt — some browsers block pop-ups)
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [resetPw, setResetPw] = useState('');
  const [form, setForm] = useState({ display_name: '', role: 'user' as Role, employee_id: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  /** the account whose details popup is open */
  const [open, setOpen] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setUsers(await listUsers()); }
    catch (e) { toast('โหลดรายชื่อผู้ใช้ไม่สำเร็จ: ' + errMsg(e)); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { reload(); }, [reload]);
  // Esc closes the details popup
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function run(fn: () => Promise<void>, ok: string) {
    try { await fn(); toast(ok); await reload(); }
    catch (e) { toast('ไม่สำเร็จ: ' + errMsg(e)); }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createUser(form);
      toast(`เพิ่มบัญชีแล้ว — แจ้งรหัสพนักงาน ${codeOf(form.employee_id)} และรหัสผ่านให้เจ้าตัว`);
      setForm({ display_name: '', role: 'user', employee_id: '', password: '' });
      setPage(0); // the new account is the newest: first page
      await reload();
    } catch (err) { toast('เพิ่มผู้ใช้ไม่สำเร็จ: ' + errMsg(err)); }
    finally { setBusy(false); }
  }

  /** employee id → the account it is linked to */
  const linkedTo = new Map(users.filter((u) => u.employee_id).map((u) => [u.employee_id as string, u.id]));
  /** the employee code an account signs in with ('' = none: that account cannot sign in) */
  const codeOf = (empId?: string | null) => employees.find((e) => e.id === empId)?.code ?? '';
  // the employee's name first (display names may be old account ids); never the internal account id
  const nameOfAcc = (u: AppUser) => employees.find((e) => e.id === u.employee_id)?.name || u.display_name || 'ไม่ทราบชื่อ';
  /**
   * employee options: every account signs in with its employee's code, so only employees that have a code
   * and are not linked to another account can be picked; the others are shown greyed with the reason
   */
  const empOptions = (self?: string) => employees.map((e) => {
    const owner = linkedTo.get(e.id);
    const taken = !!owner && owner !== self;
    const noCode = !e.code;
    return (
      <option key={e.id} value={e.id} disabled={taken || noCode}>
        {e.code ? `${e.code} · ` : ''}{e.name || 'ยังไม่มีชื่อ'}{noCode ? ' — ยังไม่มีรหัสพนักงาน' : taken ? ' — มีบัญชีแล้ว' : ''}
      </option>
    );
  });
  const formTaken = form.employee_id ? linkedTo.get(form.employee_id) : undefined;

  /** permanent delete — the admin types the employee code (or the account id when there is none) in the box shown below */
  const deleteKey = (u: AppUser) => codeOf(u.employee_id) || u.id;
  const typedOk = (u: AppUser) => deleteTyped.replace(/\s+/g, '').toUpperCase() === deleteKey(u).toUpperCase();
  async function remove(u: AppUser, e?: FormEvent) {
    e?.preventDefault();
    if (!typedOk(u)) return toast('พิมพ์ไม่ตรง — ยังไม่ได้ลบ');
    setDeleteFor(null);
    setDeleteTyped('');
    await run(() => deleteUser(u.id), `ลบบัญชีของ ${nameOfAcc(u)} แล้ว`);
  }

  async function doReset(e: FormEvent) {
    e.preventDefault();
    if (!resetFor) return;
    const id = resetFor;
    const u = users.find((x) => x.id === id);
    await run(() => resetUserPassword(id, resetPw), `ตั้งรหัสผ่านใหม่ให้ ${u ? nameOfAcc(u) : id} แล้ว — ใช้รหัสนี้เข้าสู่ระบบได้เลย`);
    setResetFor(null); setResetPw('');
  }

  const activeUsers = users.filter((u) => u.active).length;
  // newest account first, 10 per page
  const sorted = [...users].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const p = Math.min(page, pages - 1);
  const pageRows = sorted.slice(p * PAGE, p * PAGE + PAGE);
  /** the account shown in the popup (fresh after every reload; gone after a delete) */
  const openUser = open ? users.find((u) => u.id === open) : undefined;

  return (
    <section className="panel cfg-box users-panel">
      <CfgHead icon={<KeyIcon />} title="ผู้ใช้งานระบบ" count={loading ? undefined : `${activeUsers}/${users.length} ใช้งาน`} />
      {loading ? <div className="empty">กำลังโหลด…</div> : (
        <div className="user-list">
          {/* one row per account (newest first, 10 per page); "ดูรายละเอียด" opens a popup to see / change it */}
          {pageRows.map((u) => (
            <div className={`user-item ${u.active ? '' : 'off'}`} key={u.id}>
              <div className="user-row">
                <span className={`avatar person ${u.role === 'admin' ? 'admin' : ''}`} aria-hidden><PersonAvatar /></span>
                <span className="user-row-name"><b>{nameOfAcc(u)}</b>{u.id === me?.id && <span className="note"> · คุณ</span>}</span>
                <span className="mono user-row-code">{codeOf(u.employee_id) || '—'}</span>
                <span className={`role-tag ${u.role}`}>{ROLE_LABEL[u.role]}</span>
                <span className="user-row-state">
                  {!u.active ? <span className="pill x">ปิดอยู่</span>
                    : u.locked ? <span className="pill f">ถูกล็อก</span>
                    : !codeOf(u.employee_id) ? <span className="pill f">เข้าระบบไม่ได้</span>
                    : u.must_change_password ? <span className="pill w">รอเปลี่ยนรหัส</span>
                    : <span className="pill p">ใช้งาน</span>}
                </span>
                <span className="note user-row-last">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : 'ยังไม่เคยเข้า'}</span>
                <button type="button" className="btn ghost sm user-row-btn" onClick={() => { setOpen(u.id); setResetFor(null); }}>ดูรายละเอียด ›</button>
              </div>
            </div>
          ))}
          {!users.length && <div className="empty">ยังไม่มีบัญชีผู้ใช้</div>}
        </div>
      )}
      {sorted.length > PAGE && (
        <div className="pager" role="navigation" aria-label="เปลี่ยนหน้า">
          <span className="note">รายชื่อที่ {p * PAGE + 1}–{Math.min(sorted.length, p * PAGE + PAGE)} จาก {sorted.length} · ใหม่ล่าสุดก่อน</span>
          <div className="row">
            <button type="button" className="btn ghost sm" disabled={p === 0} onClick={() => setPage(p - 1)}>‹ ก่อนหน้า</button>
            <span className="pager-no">หน้า {p + 1}/{pages}</span>
            <button type="button" className="btn ghost sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>ถัดไป ›</button>
          </div>
        </div>
      )}

      {openUser && createPortal(
        <div className="dlg-back" onClick={() => setOpen(null)}>
          <div className="dlg user-dlg" role="dialog" aria-modal="true" aria-label={`บัญชีของ ${nameOfAcc(openUser)}`} onClick={(e) => e.stopPropagation()}>
            {(() => { const u = openUser; return (<>
              <div className="row spread dlg-head">
                <div className="user-top">
                  <span className={`avatar person ${u.role === 'admin' ? 'admin' : ''}`} aria-hidden><PersonAvatar /></span>
                  <div className="user-name">
                    <h2 className="flush">{nameOfAcc(u)}</h2>
                    <span className="note">{codeOf(u.employee_id) ? <>รหัสพนักงาน <span className="mono">{codeOf(u.employee_id)}</span></> : 'ยังไม่มีรหัสพนักงาน'}{u.id === me?.id && ' · คุณ'}</span>
                  </div>
                  <span className={`role-tag ${u.role}`}>{ROLE_LABEL[u.role]}</span>
                </div>
                <button type="button" className="btn ghost sm" onClick={() => setOpen(null)} aria-label="ปิด">✕ ปิด</button>
              </div>
        {(u.locked || u.must_change_password) && (
          <div className="row user-flags">
            {u.locked && <span className="pill f">ถูกล็อก</span>}
            {u.must_change_password && <span className="pill x">รอเปลี่ยนรหัส</span>}
          </div>
        )}
        {/* sign-in is by the linked employee's code only: without one this account cannot sign in */}
        {!codeOf(u.employee_id) && (
          <div className="user-warn" role="status">
            <span className="warn-ico" aria-hidden><AlertIcon /></span>เข้าสู่ระบบไม่ได้ — {u.employee_id
              ? <>ใส่ <b>รหัสพนักงาน</b> ให้ {employees.find((e) => e.id === u.employee_id)?.name || 'พนักงานคนนี้'} ในตารางพนักงานด้านบน</>
              : <>ผูกบัญชีกับพนักงานที่มีรหัสพนักงาน</>}
          </div>
        )}
        <dl className="user-info">
          <div><dt>เข้าสู่ระบบด้วย</dt><dd>{codeOf(u.employee_id)
            ? <><b className="mono">{codeOf(u.employee_id)}</b> <span className="note">(รหัสพนักงาน)</span></>
            : <span className="note">— ยังไม่มีรหัสพนักงาน</span>}</dd></div>
          <div><dt>พนักงาน</dt><dd>{u.employee_id ? employees.find((e) => e.id === u.employee_id)?.name || 'ยังไม่มีชื่อ' : '—'}</dd></div>
          <div><dt>เข้าใช้ล่าสุด</dt><dd>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd></div>
        </dl>
        <div className="user-ctrls">
          <label>สิทธิ์
            <select aria-label={`สิทธิ์ของ ${nameOfAcc(u)}`} value={u.role}
              onChange={(e) => run(() => updateUser(u.id, { role: e.target.value as Role }), 'เปลี่ยนสิทธิ์แล้ว')}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label>ผูกกับพนักงาน
            <select aria-label={`พนักงานที่ผูกกับบัญชีของ ${nameOfAcc(u)}`} value={u.employee_id ?? ''}
              onChange={(e) => run(() => updateUser(u.id, { employee_id: e.target.value }),
                `ผูกบัญชีกับพนักงาน ${e.target.value} แล้ว — เข้าสู่ระบบด้วยรหัส ${codeOf(e.target.value)}`)}>
              {/* no "unlink": an account without an employee code could not sign in */}
              {!u.employee_id && <option value="" disabled>— เลือกพนักงาน —</option>}
              {empOptions(u.id)}
            </select>
          </label>
          <div className="user-status">
            <span className="ro-label">สถานะบัญชี</span>
            <ActiveSwitch on={u.active} label={`สถานะบัญชี ${nameOfAcc(u)}`}
              onToggle={() => run(() => updateUser(u.id, { active: !u.active }), u.active ? 'ปิดบัญชีแล้ว' : 'เปิดบัญชีแล้ว')} />
          </div>
        </div>
        <div className="user-actions">
          {u.locked && <button className="btn ghost sm" onClick={() => run(() => updateUser(u.id, { unlock: true }), 'ปลดล็อกแล้ว')}>ปลดล็อก</button>}
          <button className="btn ghost sm" onClick={() => { setResetFor(u.id); setResetPw(''); }}>ตั้งรหัสผ่านใหม่</button>
          {u.id !== me?.id && (
            <button className="btn danger sm" aria-expanded={deleteFor === u.id}
              onClick={() => { setDeleteFor(deleteFor === u.id ? null : u.id); setDeleteTyped(''); setResetFor(null); }}>ลบผู้ใช้</button>
          )}
        </div>
        {deleteFor === u.id && (
          <form className="user-delete" onSubmit={(e) => remove(u, e)}>
            <b>ลบบัญชีของ "{nameOfAcc(u)}" ถาวร — กู้คืนไม่ได้</b>
            <ul>
              <li>ลบ: บัญชี การเข้าสู่ระบบ ความยินยอม และใบขับขี่ (รวมรูป) ของบัญชีนี้</li>
              <li>ยังอยู่: บันทึกตรวจรถ / PPE / เวลาทำงาน แต่จะไม่แสดงว่าบัญชีนี้เป็นผู้บันทึก</li>
              <li>ถ้าแค่ไม่ให้เข้าใช้ ให้ปิด "สถานะบัญชี" แทน</li>
            </ul>
            <label>พิมพ์ <b className="mono">{deleteKey(u)}</b> เพื่อยืนยันการลบ
              <input type="text" value={deleteTyped} onChange={(e) => setDeleteTyped(e.target.value)} autoComplete="off" autoFocus
                aria-label={`พิมพ์ ${deleteKey(u)} เพื่อยืนยันการลบ`} />
            </label>
            <div className="row">
              <button className="btn danger sm" type="submit" disabled={!typedOk(u)}>ลบถาวร</button>
              <button className="btn ghost sm" type="button" onClick={() => { setDeleteFor(null); setDeleteTyped(''); }}>ยกเลิก</button>
            </div>
          </form>
        )}
        {resetFor === u.id && (
          <form className="row user-reset" onSubmit={doReset}>
            <input type="text" aria-label="รหัสผ่านใหม่" placeholder="รหัสผ่านใหม่ (8 ตัวขึ้นไป)" value={resetPw}
              onChange={(e) => setResetPw(e.target.value)} autoComplete="off" required />
            <button className="btn sm" type="submit">บันทึก</button>
            <button className="btn ghost sm" type="button" onClick={() => setResetFor(null)}>ยกเลิก</button>
          </form>
        )}
            </>); })()}
          </div>
        </div>,
        document.body,
      )}

      <form className="add-user cfg-add" onSubmit={add}>
        <b className="cfg-add-title">＋ เพิ่มผู้ใช้ใหม่</b>
        <div className="grid">
          <label>พนักงาน (รหัสพนักงาน = ใช้เข้าสู่ระบบ)
            <select value={form.employee_id} required
              onChange={(e) => setForm({ ...form, employee_id: e.target.value, display_name: form.display_name || (employees.find((x) => x.id === e.target.value)?.name ?? '') })}>
              <option value="">— เลือกพนักงาน —</option>
              {empOptions()}
            </select>
            {formTaken && <span className="error-text">พนักงานนี้มีบัญชีแล้ว</span>}
          </label>
          <label>ชื่อที่แสดง
            <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="ใช้ชื่อพนักงานถ้าเว้นว่าง" />
          </label>
          <label>สิทธิ์
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label>รหัสผ่าน
            <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="8 ตัวขึ้นไป" autoComplete="off" required />
          </label>
        </div>
        <div className="row spread mt-s">
          <span />
          <button className="btn sm" type="submit" disabled={busy || !!formTaken}>{busy ? 'กำลังเพิ่ม…' : 'เพิ่มผู้ใช้'}</button>
        </div>
      </form>
    </section>
  );
}
