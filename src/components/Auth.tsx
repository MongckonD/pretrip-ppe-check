import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import { changePassword, login, setupAdmin, type Me } from '../lib/api';
import { errMsg } from '../lib/utils';

/** The signed-in user (null in test mode). */
export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

export const ROLE_LABEL: Record<string, string> = { admin: 'ผู้ดูแลระบบ', user: 'ผู้ใช้' };

function Card(props: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="center-screen">
      <div className="panel login">
        <div className="brand-mark" aria-hidden="true" />
        <div>
          <div className="brand-name">D-Trip</div>
          <div className="brand-sub">Delivery Team App</div>
          <h1>{props.title}</h1>
        </div>
        {props.sub && <p className="note">{props.sub}</p>}
        {props.children}
      </div>
    </div>
  );
}

function PasswordInput(props: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <label>{props.label}
      <div className="pw">
        <input type={show ? 'text' : 'password'} value={props.value} autoComplete={props.autoComplete}
          autoFocus={props.autoFocus} onChange={(e) => props.onChange(e.target.value)} required />
        <button type="button" className="btn ghost sm" onClick={() => setShow((s) => !s)}
          aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>{show ? 'ซ่อน' : 'แสดง'}</button>
      </div>
    </label>
  );
}

const PW_RULE = 'อย่างน้อย 8 ตัวอักษร และต้องไม่มีรหัสพนักงานอยู่ในรหัสผ่าน';

export function LoginForm({ onDone, notice }: { onDone: (me: Me) => void; notice?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { onDone(await login(username, password)); }
    catch (err) { setError(errMsg(err)); setPassword(''); }
    finally { setBusy(false); }
  }

  return (
    <Card title="เข้าสู่ระบบ">
      <form className="login-form" onSubmit={submit}>
        {notice && <div className="login-notice" role="status">{notice}</div>}
        <label>รหัสพนักงาน
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
            placeholder="เช่น 650123" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoFocus required />
        </label>
        <PasswordInput label="รหัสผ่าน" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        <p className="note">ลืมรหัสผ่าน ติดต่อผู้ดูแลระบบเพื่อตั้งรหัสใหม่</p>
      </form>
    </Card>
  );
}

export function SetupForm({ onDone }: { onDone: (me: Me) => void }) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('ยืนยันรหัสผ่านไม่ตรงกัน');
    setBusy(true); setError('');
    try { onDone(await setupAdmin(username, name, password)); }
    catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card title="ตั้งค่าครั้งแรก" sub="ยังไม่มีผู้ใช้ในระบบ สร้างบัญชีผู้ดูแลระบบ (admin) คนแรก แล้วค่อยเพิ่มพนักงานคนอื่นได้ที่แท็บตั้งค่า">
      <form className="login-form" onSubmit={submit}>
        <label>รหัสพนักงาน
          <input value={username} onChange={(e) => setUsername(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} autoComplete="username"
            autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="เช่น 650123" maxLength={20} autoFocus required />
          <span className="note">ใช้เข้าสู่ระบบ · ตัวอักษรภาษาอังกฤษ ตัวเลข หรือ - ไม่เกิน 20 ตัว</span>
        </label>
        <label>ชื่อ-นามสกุล
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น สมชาย ใจดี" required />
        </label>
        <PasswordInput label="รหัสผ่าน" value={password} onChange={setPassword} autoComplete="new-password" />
        <PasswordInput label="ยืนยันรหัสผ่าน" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <span className="note">{PW_RULE}</span>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'กำลังสร้าง…' : 'สร้างผู้ดูแลระบบ'}</button>
      </form>
    </Card>
  );
}

/** Change password. `forced` = full-screen after a temporary password; otherwise a panel inside the app. */
export function ChangePasswordForm(props: { forced?: boolean; onDone: () => void; onCancel?: () => void; onLogout?: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
    setBusy(true); setError('');
    try { await changePassword(current, next); props.onDone(); }
    catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  }

  const form = (
    <form className="login-form" onSubmit={submit}>
      <PasswordInput label={props.forced ? 'รหัสผ่านชั่วคราว (ที่ได้รับ)' : 'รหัสผ่านปัจจุบัน'} value={current}
        onChange={setCurrent} autoComplete="current-password" autoFocus />
      <PasswordInput label="รหัสผ่านใหม่" value={next} onChange={setNext} autoComplete="new-password" />
      <PasswordInput label="ยืนยันรหัสผ่านใหม่" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <span className="note">{PW_RULE} · เครื่องอื่นที่ login บัญชีนี้อยู่จะถูกออกจากระบบ</span>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่าน'}</button>
        {props.onCancel && <button className="btn ghost" type="button" onClick={props.onCancel}>ยกเลิก</button>}
        {props.onLogout && <button className="btn ghost" type="button" onClick={props.onLogout}>ออกจากระบบ</button>}
      </div>
    </form>
  );

  if (props.forced) {
    return <Card title="ตั้งรหัสผ่านใหม่" sub="บัญชีนี้ใช้รหัสผ่านชั่วคราว กรุณาตั้งรหัสผ่านของคุณเองก่อนใช้งาน">{form}</Card>;
  }
  return (
    <section className="panel pw-panel">
      <h2>เปลี่ยนรหัสผ่าน</h2>
      {form}
    </section>
  );
}
