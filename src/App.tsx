import { useCallback, useEffect, useMemo, useState } from 'react';
import { UNAUTHORIZED_EVENT, authStatus, isTestMode, loadMaster, logout, type Me } from './lib/api';
import type { Master } from './lib/types';
import { errMsg, today } from './lib/utils';
import { ChangePasswordForm, LoginForm, MeContext, ROLE_LABEL, SetupForm } from './components/Auth';
import { ChartIcon, ClockIcon, GearIcon, KeyIcon, LogoutIcon, TableIcon, TruckIcon, VestIcon } from './components/Icons';
import { MasterContext, buildMasterCtx } from './components/MasterContext';
import { VehiclePage } from './pages/VehiclePage';
import { PpePage } from './pages/PpePage';
import { DashboardPage } from './pages/DashboardPage';
import { DataPage } from './pages/DataPage';
import { SettingsPage } from './pages/SettingsPage';
import { TimeActivitiesPage } from './pages/TimeActivitiesPage';

const TABS = [
  ['veh', 'ตรวจรถ'],
  ['ppe', 'PPE'],
  ['time', 'Time activities'],
  ['dash', 'ภาพรวม'],
  ['data', 'ข้อมูล'],
  ['cfg', 'ตั้งค่า'],
] as const;
type Tab = (typeof TABS)[number][0];

const TAB_ICON: Record<Tab, () => JSX.Element> = {
  veh: TruckIcon, ppe: VestIcon, time: ClockIcon, dash: ChartIcon, data: TableIcon, cfg: GearIcon,
};
/** Shorter labels for the phone bottom bar, where space is tight. */
const SHORT_LABEL: Partial<Record<Tab, string>> = { time: 'Time' };

const PAGE_TITLE: Record<Tab, string> = {
  veh: 'ตรวจรถก่อนออกงาน', ppe: 'ตรวจ PPE พนักงาน', time: 'Time activities', dash: 'ภาพรวมประจำเดือน', data: 'ข้อมูลการตรวจ', cfg: 'ตั้งค่าระบบ',
};

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
    setPwOpen(false);
    window.scrollTo({ top: 0 });
    try { sessionStorage.setItem('tab', t); } catch { /* storage unavailable */ }
  }

  const togglePw = () => { setPwOpen((o) => !o); setPwDone(false); };
  const userBox = isTestMode ? (
    <span className="test-badge" title="ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น ยังไม่ได้เชื่อม Cloudflare">โหมดทดสอบ</span>
  ) : me && (
    <>
      <div className="who" title={`${me.id} · ${ROLE_LABEL[me.role]}`}>
        <span className="avatar" aria-hidden="true">{(me.display_name || me.id).slice(0, 1).toUpperCase()}</span>
        <span className="who-text">
          <b>{me.display_name || me.id}</b>
          <span>{ROLE_LABEL[me.role]}</span>
        </span>
      </div>
      <div className="who-actions">
        <button className="icon-btn" onClick={togglePw} aria-label="เปลี่ยนรหัสผ่าน" title="เปลี่ยนรหัสผ่าน">
          <KeyIcon /><span className="lbl">เปลี่ยนรหัสผ่าน</span>
        </button>
        <button className="icon-btn" onClick={onLogout} aria-label="ออกจากระบบ" title="ออกจากระบบ">
          <LogoutIcon /><span className="lbl">ออกจากระบบ</span>
        </button>
      </div>
    </>
  );
  const current = tabs.find(([k]) => k === tab) ?? tabs[0];

  return (
    <MeContext.Provider value={me}>
      <div className="app">
        {/* phone only: compact bar with brand + user actions */}
        <header className="mbar">
          <div className="brand">
            <span className="brand-mark sm" aria-hidden="true" />
            <span className="brand-text"><b className="brand-name">D-Trip</b><span className="brand-sub">Delivery Team App</span></span>
          </div>
          <div className="mbar-user">{userBox}</div>
        </header>

        {/* sidebar on desktop / tablet, bottom bar on phone */}
        <aside className="side">
          <div className="brand side-brand">
            <span className="brand-mark sm" aria-hidden="true" />
            <span className="brand-text">
              <b className="brand-name">D-Trip</b>
              <span className="brand-sub">Delivery Team App</span>
            </span>
          </div>
          <nav className="nav" role="tablist" aria-label="เมนูหลัก" aria-orientation="vertical">
            {tabs.map(([k, l]) => {
              const Icon = TAB_ICON[k];
              return (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(k)}>
                  <Icon /><span className="nav-full">{l}</span><span className="nav-short">{SHORT_LABEL[k] ?? l}</span>
                </button>
              );
            })}
          </nav>
          <div className="side-foot">{userBox}</div>
        </aside>

        <div className="main-col">
          <div className="page-head">
            <h1>{PAGE_TITLE[current[0]]}</h1>
            <span className="note">{new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
      <main className="content">
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
            {tab === 'time' && <TimeActivitiesPage />}
            {tab === 'dash' && <DashboardPage month={month} setMonth={setMonth} />}
            {tab === 'data' && <DataPage month={month} setMonth={setMonth} />}
            {tab === 'cfg' && tabs.some(([k]) => k === 'cfg') && <SettingsPage />}
          </MasterContext.Provider>
        )}
      </main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
