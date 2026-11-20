/**
 * Shared layout for both web pages (staff `/` and admin `/admin/`):
 * sidebar on desktop, icon rail on tablet, top bar + bottom menu on phone.
 * Each page passes its own tabs; master data, password change and errors are handled here.
 * Every tab has its own URL path (e.g. /ppe, /admin/data): links, refresh and the back button work.
 */
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isTestMode, loadMaster, type Me } from '../lib/api';
import type { Master } from '../lib/types';
import { errMsg, today } from '../lib/utils';
import { ChangePasswordForm, MeContext, ROLE_LABEL } from './Auth';
import { KeyIcon, LogoutIcon } from './Icons';
import { MasterContext, buildMasterCtx } from './MasterContext';

export interface PageCtx { month: string; setMonth: (m: string) => void; go: (key: string) => void }

export interface TabDef {
  key: string;
  /** URL path of this tab, e.g. '/ppe' or '/admin/data' */
  path: string;
  label: string;
  /** shorter label for the tablet rail / phone bottom bar */
  short?: string;
  title: string;
  icon: () => JSX.Element;
  render: (c: PageCtx) => ReactNode;
  /** optional status next to the label (e.g. vehicle-check approval) */
  badge?: ReactNode;
  /**
   * key of the menu item this tab sits under. A tab with children is only a heading: opening it
   * opens its first child. Children show under it in the sidebar; on tablet / phone (no room in the
   * rail or bottom bar) they show as a strip at the top of the page instead.
   */
  parent?: string;
}

export interface ShellProps {
  me: Me | null;
  onLogout?: () => void;
  tabs: TabDef[];
  brandSub: string;
  /** optional notice above every page (e.g. licence reminder); gets the open tab's key */
  banner?: (go: (key: string) => void, currentKey: string) => ReactNode;
}

const normPath = (p: string) => (p.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/');

/** a menu heading opens its first child */
function resolve(tabs: TabDef[], t: TabDef): TabDef {
  return tabs.find((x) => x.parent === t.key) ?? t;
}

/** Tab for the current address; unknown paths fall back to the first tab. */
function tabFromUrl(tabs: TabDef[]): TabDef {
  const here = normPath(window.location.pathname);
  return resolve(tabs, tabs.find((t) => normPath(t.path) === here) ?? tabs[0]);
}

export function AppShell({ me, onLogout, tabs, brandSub, banner }: ShellProps) {
  const [tab, setTab] = useState<string>(() => tabFromUrl(tabs).key);
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

  // address bar always shows the open tab's path (fixes /, /admin/ and unknown paths in place)
  const current = resolve(tabs, tabs.find((t) => t.key === tab) ?? tabs[0]);
  // the open tab's menu heading, and its sub-tabs
  const top = current.parent ? tabs.find((t) => t.key === current.parent) ?? current : current;
  const siblings = tabs.filter((t) => t.parent && t.parent === current.parent);
  useEffect(() => {
    if (normPath(window.location.pathname) !== normPath(current.path)) {
      window.history.replaceState(null, '', current.path + window.location.search + window.location.hash);
    }
    document.title = `${current.title} · D-Trip`;
  }, [current]);

  // back / forward buttons
  useEffect(() => {
    const onPop = () => { setTab(tabFromUrl(tabs).key); setPwOpen(false); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [tabs]);

  const go = useCallback((t: string) => {
    const found = tabs.find((x) => x.key === t);
    if (!found) return;
    const next = resolve(tabs, found);
    if (normPath(window.location.pathname) !== normPath(next.path)) window.history.pushState(null, '', next.path);
    setTab(next.key);
    setPwOpen(false);
    window.scrollTo({ top: 0 });
  }, [tabs]);

  const togglePw = () => { setPwOpen((o) => !o); setPwDone(false); };
  // who is signed in: the employee's name (never the internal account id)
  const who = (me && (master?.employees.find((e) => e.id === me.employee_id)?.name || me.display_name)) || 'ผู้ใช้';
  const userBox = isTestMode ? (
    <>
      <span className="test-badge" title="ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น ยังไม่ได้เชื่อม Cloudflare">โหมดทดสอบ</span>
    </>
  ) : me && (
    <>
      <div className="who" title={`${who} · ${ROLE_LABEL[me.role]}`}>
        <span className="avatar" aria-hidden="true">{who.slice(0, 1).toUpperCase()}</span>
        <span className="who-text">
          <b>{who}</b>
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
            {tabs.filter((t) => !t.parent).map((t) => {
              const kids = tabs.filter((k) => k.parent === t.key);
              const on = top.key === t.key;
              return (
                <Fragment key={t.key}>
                  <button role="tab" aria-selected={on} aria-expanded={kids.length ? on : undefined} aria-label={t.label} onClick={() => go(t.key)}>
                    <t.icon /><span className="nav-full">{t.label}</span><span className="nav-short">{t.short ?? t.label}</span>{t.badge}
                    {kids.length > 0 && <span className="nav-caret" aria-hidden>{on ? '▾' : '▸'}</span>}
                  </button>
                  {/* sub-tabs: sidebar only (desktop) */}
                  {on && kids.length > 0 && (
                    <div className="nav-sub" role="group" aria-label={t.label}>
                      {kids.map((k) => (
                        <button key={k.key} type="button" className="nav-sub-btn" aria-current={current.key === k.key ? 'page' : undefined} onClick={() => go(k.key)}>
                          <k.icon /><span>{k.label}</span>{k.badge}
                        </button>
                      ))}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </nav>
          <div className="side-foot">{userBox}</div>
        </aside>

        <div className="main-col">
          <div className="page-head">
            <h1>{current.title}</h1>
            <span className="note">{new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
          <main className="content">
            {/* sub-tabs on tablet / phone, where the rail and bottom bar have no room for them */}
            {siblings.length > 1 && (
              <div className="page-subtabs" role="tablist" aria-label={top.label}>
                {siblings.map((k) => (
                  <button key={k.key} type="button" role="tab" aria-selected={current.key === k.key} onClick={() => go(k.key)}>
                    <k.icon /><span>{k.label}</span>{k.badge}
                  </button>
                ))}
              </div>
            )}
            {pwOpen && <ChangePasswordForm onDone={() => { setPwOpen(false); setPwDone(true); }} onCancel={() => setPwOpen(false)} />}
            {pwDone && <div className="panel ok-panel">เปลี่ยนรหัสผ่านแล้ว</div>}
            {banner?.(go, current.key)}
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
