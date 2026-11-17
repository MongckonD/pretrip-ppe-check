/**
 * Shared layout for both web pages (staff `/` and admin `/admin/`):
 * sidebar on desktop, icon rail on tablet, top bar + bottom menu on phone.
 * Each page passes its own tabs; master data, password change and errors are handled here.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isTestMode, loadMaster, type Me } from '../lib/api';
import type { Master } from '../lib/types';
import { errMsg, today } from '../lib/utils';
import { ChangePasswordForm, MeContext, ROLE_LABEL } from './Auth';
import { KeyIcon, LogoutIcon } from './Icons';
import { MasterContext, buildMasterCtx } from './MasterContext';

export interface PageCtx { month: string; setMonth: (m: string) => void; go: (key: string) => void }

export interface TabDef {
  key: string;
  label: string;
  /** shorter label for the tablet rail / phone bottom bar */
  short?: string;
  title: string;
  icon: () => JSX.Element;
  render: (c: PageCtx) => ReactNode;
}

export interface ShellProps {
  me: Me | null;
  onLogout?: () => void;
  tabs: TabDef[];
  /** sessionStorage key for the remembered tab */
  storageKey: string;
  brandSub: string;
  /** link to the other page (staff ↔ admin), shown when present */
}

export function AppShell({ me, onLogout, tabs, storageKey, brandSub }: ShellProps) {
  const [tab, setTab] = useState<string>(() => {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(storageKey); } catch { /* storage unavailable */ }
    return tabs.some((t) => t.key === saved) ? (saved as string) : tabs[0].key;
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

  const go = useCallback((t: string) => {
    if (!tabs.some((x) => x.key === t)) return;
    setTab(t);
    setPwOpen(false);
    window.scrollTo({ top: 0 });
    try { sessionStorage.setItem(storageKey, t); } catch { /* storage unavailable */ }
  }, [tabs, storageKey]);

  const togglePw = () => { setPwOpen((o) => !o); setPwDone(false); };
  const userBox = isTestMode ? (
    <>
      <span className="test-badge" title="ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น ยังไม่ได้เชื่อม Cloudflare">โหมดทดสอบ</span>
    </>
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
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];
  const brand = (
    <>
      <span className="brand-mark sm" aria-hidden="true" />
      <span className="brand-text"><b className="brand-name">D-Trip</b><span className="brand-sub">{brandSub}</span></span>
    </>
  );

  return (
    <MeContext.Provider value={me}>
      <div className="app">
        {/* phone only: compact bar with brand + user actions */}
        <header className="mbar">
          <div className="brand">{brand}</div>
          <div className="mbar-user">{userBox}</div>
        </header>

        {/* sidebar on desktop / tablet, bottom bar on phone */}
        <aside className="side">
          <div className="brand side-brand">{brand}</div>
          <nav className="nav" role="tablist" aria-label="เมนูหลัก" aria-orientation="vertical">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} aria-label={t.label} onClick={() => go(t.key)}>
                <t.icon /><span className="nav-full">{t.label}</span><span className="nav-short">{t.short ?? t.label}</span>
              </button>
            ))}
          </nav>
          <div className="side-foot">{userBox}</div>
        </aside>

        <div className="main-col">
          <div className="page-head">
            <h1>{current.title}</h1>
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
                {current.render({ month, setMonth, go })}
              </MasterContext.Provider>
            )}
          </main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
