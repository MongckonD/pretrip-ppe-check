import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { errMsg } from '../lib/utils';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : errMsg(error));
  }

  return (
    <div className="center-screen">
      <form className="panel login" onSubmit={submit}>
        <div className="brand-mark" aria-hidden="true" />
        <div className="eyebrow">Piyachart 54 · Daily Safety</div>
        <h1>เข้าสู่ระบบ</h1>
        <label>อีเมล
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>รหัสผ่าน
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        <p className="note">บัญชีผู้ใช้สร้างโดยผู้ดูแลระบบใน Supabase → Authentication → Users</p>
      </form>
    </div>
  );
}
