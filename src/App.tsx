import { useCallback, useEffect, useMemo, useState } from 'react';
import { UNAUTHORIZED_EVENT, authStatus, isTestMode, loadMaster, logout, type Me } from './lib/api';
import type { Master } from './lib/types';
import { errMsg, today } from './lib/utils';
import { ChangePasswordForm, LoginForm, MeContext, ROLE_LABEL, SetupForm } from './components/Auth';
import { MasterContext, buildMasterCtx } from './components/MasterContext';
import { VehiclePage } from './pages/VehiclePage';
import { PpePage } from './pages/PpePage';
import { DashboardPage } from './pages/DashboardPage';
import { DataPage } from './pages/DataPage';
import { SettingsPage } from './pages/SettingsPage';

const TABS = [
  ['veh', 'ตรวจรถ'],
  ['ppe', 'PPE'],
  ['dash', 'ภาพรวม'],
  ['data', 'ข้อมูล'],
  ['cfg', 'ตั้งค่า'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function App() {
  // test mode: no login, data stays in this browser
  if (isTestMode) return <Shell me={null} />;
  return <AuthGate />;
}

type AuthState = { needs_setup: boolean; user: Me | null };

/** Real backend: setup → login → (forced password change) → app. */
function AuthGate() {
  const [state, setState] = useState<AuthState | undefined>(undefined);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    setError('');
    try { setState(await authStatus()); }
    catch (e) { setError(errMsg(e)); }
  }, []);

  useEffect(() => {
    check();
    // any API call that finds the session gone sends the user back to the login screen
    const onLost = () => setState((s) => (s ? { ...s, user: null } : s));
    window.addEventListener(UNAUTHORIZED_EVENT, onLost);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onLost);
  }, [check]);

  const signedIn = (user: Me) => setState({ needs_setup: false, user });
  const signOut = async () => {
    await logout().catch(() => { /* cookie is cleared anyway on next login */ });
    setState({ needs_setup: false, user: null });
  };

  if (error) {
    return (
      <div className="center-screen">
        <div className="panel login">
          <b>เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ</b>
          <div className="note">{error}</div>
          <button className="btn" onClick={check}>ลองใหม่</button>
        </div>
      </div>
    );
  }
  if (!state) return <div className="center-screen note">กำลังโหลด…</div>;
  if (state.needs_setup) return <SetupForm onDone={signedIn} />;
  if (!state.user) return <LoginForm onDone={signedIn} />;
  if (state.user.must_change_password) {
    const u = state.user;
    return <ChangePasswordForm forced onDone={() => signedIn({ ...u, must_change_password: false })} onLogout={signOut} />;
  }
  return <Shell me={state.user} onLogout={signOut} />;
}

function Shell({ me, onLogout }: { me: Me | null; onLogout?: () => void }) {
  // แท็บตั้งค่า (พนักงาน, รถ, ผู้ใช้) เฉพาะ admin · โหมดทดสอบ (me = null) เห็นทุกแท็บ
  const tabs = TABS.filter(([k]) => k !== 'cfg' || !me || me.role === 'admin');
  const [tab, setTab] = useState<Tab>(() => {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem('tab'); } catch { /* storage unavailable */ }
    // a remembered tab may no longer exist, or this user may not be allowed to see it
    return tabs.some(([k]) => k === saved) ? (saved as Tab) : 'veh';
  });
  const [month, setMonth] = useState(today().slice(0, 7));
  const [master, setMaster] = useState<Master | null>(null);
  const [error, setError] = useState('');
  const [pwOpen, setPwOpen] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  const reload = useCallback(async () => {
    try { setMaster(await loadMaster()); setError(''); }
    catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const ctx = useMemo(() => (master ? buildMasterCtx(master, reload) : null), [master, reload]);

  function go(t: Tab) {
    setTab(t);
    try { sessionStorage.setItem('tab', t); } catch { /* storage unavailable */ }
  }

  return (
    <MeContext.Provider value={me}>
      <header className="topbar">
        <div className="wrap topbar-in">
          <div>
            <div className="eyebrow">Piyachart 54 · Daily Safety</div>
            <h1>ตรวจรถก่อนออกงาน และ PPE</h1>
          </div>
          {isTestMode ? (
            <div className="user">
              <span className="test-badge" title="ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น ยังไม่ได้เชื่อม Cloudflare">โหมดทดสอบ</span>
            </div>
          ) : me && (
            <div className="user">
              <span className="user-email" title={`${me.id} · ${ROLE_LABEL[me.role]}`}>{me.display_name || me.id}</span>
              <button className="btn ghost-inv sm" onClick={() => { setPwOpen((o) => !o); setPwDone(false); }}>เปลี่ยนรหัสผ่าน</button>
              <button className="btn ghost-inv sm" onClick={onLogout}>ออกจากระบบ</button>
            </div>
          )}
        </div>
      </header>
      <nav className="tabs" role="tablist">
        <div className="wrap tabs-in">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(k)}>{l}</button>
          ))}
        </div>
      </nav>
      <main className="wrap">
        {pwOpen && <ChangePasswordForm onDone={() => { setPwOpen(false); setPwDone(true); }} onCancel={() => setPwOpen(false)} />}
        {pwDone && <div className="panel ok-panel">เปลี่ยนรหัสผ่านแล้ว</div>}
        {error && (
          <div className="panel error-panel">
            <b>เชื่อมต่อฐานข้อมูลไม่สำเร็จ</b>
            <div className="note">{error}</div>
            <button className="btn sm" onClick={reload}>ลองใหม่</button>
          </div>
        )}
        {!ctx && !error && <div className="empty">กำลังโหลดข้อมูล…</div>}
        {ctx && (
          <MasterContext.Provider value={ctx}>
            {tab === 'veh' && <VehiclePage />}
            {tab === 'ppe' && <PpePage />}
            {tab === 'dash' && <DashboardPage month={month} setMonth={setMonth} />}
            {tab === 'data' && <DataPage month={month} setMonth={setMonth} />}
            {tab === 'cfg' && tabs.some(([k]) => k === 'cfg') && <SettingsPage />}
          </MasterContext.Provider>
        )}
      </main>
    </MeContext.Provider>
  );
}
