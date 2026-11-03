import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { isTestMode, loadMaster } from './lib/api';
import type { Master } from './lib/types';
import { errMsg, today } from './lib/utils';
import { Login } from './components/Login';
import { MasterContext, buildMasterCtx } from './components/MasterContext';
import { VehiclePage } from './pages/VehiclePage';
import { PpePage } from './pages/PpePage';
import { DailyPage } from './pages/DailyPage';
import { DashboardPage } from './pages/DashboardPage';
import { DataPage } from './pages/DataPage';
import { SettingsPage } from './pages/SettingsPage';

const TABS = [
  ['veh', 'ตรวจรถ'],
  ['ppe', 'PPE'],
  ['day', 'รายวัน'],
  ['dash', 'ภาพรวม'],
  ['data', 'ข้อมูล'],
  ['cfg', 'ตั้งค่า'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function App() {
  // Test mode: no Supabase, no login — data stays in this browser.
  if (isTestMode) return <Shell email="" />;
  return <AuthGate />;
}

function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="center-screen note">กำลังโหลด…</div>;
  if (!session) return <Login />;
  return <Shell email={session.user.email ?? ''} />;
}

function Shell({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('tab') as Tab) || 'veh');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [master, setMaster] = useState<Master | null>(null);
  const [error, setError] = useState('');

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
    <>
      <header className="topbar">
        <div className="wrap topbar-in">
          <div>
            <div className="eyebrow">Piyachart 54 · Daily Safety</div>
            <h1>ตรวจรถก่อนออกงาน และ PPE</h1>
          </div>
          {isTestMode ? (
            <div className="user">
              <span className="test-badge" title="ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น ยังไม่ได้เชื่อม Supabase">โหมดทดสอบ</span>
            </div>
          ) : (
            <div className="user">
              <span className="user-email">{email}</span>
              <button className="btn ghost-inv sm" onClick={() => supabase.auth.signOut()}>ออกจากระบบ</button>
            </div>
          )}
        </div>
      </header>
      <nav className="tabs" role="tablist">
        <div className="wrap tabs-in">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(k)}>{l}</button>
          ))}
        </div>
      </nav>
      <main className="wrap">
        {error && (
          <div className="panel error-panel">
            <b>เชื่อมต่อฐานข้อมูลไม่สำเร็จ</b>
            <div className="note">{error}</div>
            <div className="note">ตรวจว่ารัน SQL ใน supabase/migrations แล้ว</div>
            <button className="btn sm" onClick={reload}>ลองใหม่</button>
          </div>
        )}
        {!ctx && !error && <div className="empty">กำลังโหลดข้อมูล…</div>}
        {ctx && (
          <MasterContext.Provider value={ctx}>
            {tab === 'veh' && <VehiclePage />}
            {tab === 'ppe' && <PpePage />}
            {tab === 'day' && <DailyPage />}
            {tab === 'dash' && <DashboardPage month={month} setMonth={setMonth} />}
            {tab === 'data' && <DataPage month={month} setMonth={setMonth} />}
            {tab === 'cfg' && <SettingsPage />}
          </MasterContext.Provider>
        )}
      </main>
    </>
  );
}
