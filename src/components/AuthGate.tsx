/**
 * Login flow shared by both web pages: first-time setup → login → (forced password change) → page.
 * Each role has exactly one page (the Worker enforces this too):
 *   staff  — role user only; a signed-in admin is sent to /admin/
 *   admin  — role admin only; anyone else is sent to / (where the login screen is)
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { UNAUTHORIZED_EVENT, authStatus, logout, type Me } from '../lib/api';
import { IDLE_NOTICE, NOTICE_KEY, useIdleSignOut } from '../lib/session';
import { errMsg } from '../lib/utils';
import { ChangePasswordForm, LoginForm, SetupForm } from './Auth';

export const ADMIN_HOME = '/admin/';
export const STAFF_HOME = '/';

type AuthState = { needs_setup: boolean; user: Me | null };

export function AuthGate({ area, children }: { area: 'staff' | 'admin'; children: (me: Me, signOut: () => void) => ReactNode }) {
  const [state, setState] = useState<AuthState | undefined>(undefined);
  const [error, setError] = useState('');
  // message on the login screen (e.g. signed out for being idle); survives the admin → / redirect
  const [notice, setNotice] = useState(() => {
    try { const n = sessionStorage.getItem(NOTICE_KEY) ?? ''; sessionStorage.removeItem(NOTICE_KEY); return n; } catch { return ''; }
  });

  const check = useCallback(async () => {
    setError('');
    try { setState(await authStatus()); }
    catch (e) { setError(errMsg(e)); }
  }, []);

  useEffect(() => {
    check();
    // any API call that finds the session gone sends the user back to the login screen
    const onLost = () => {
      setNotice('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
      setState((s) => (s ? { ...s, user: null } : s));
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onLost);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onLost);
  }, [check]);

  // wrong page for this role → go to the right one (nothing is drawn meanwhile)
  const isAdmin = (u: Me | null | undefined) => !!u && u.role === 'admin' && !u.must_change_password;
  const leaveTo = !state ? null
    : area === 'admin' ? (isAdmin(state.user) ? null : STAFF_HOME)
    : (isAdmin(state.user) ? ADMIN_HOME : null);
  useEffect(() => { if (leaveTo) window.location.replace(leaveTo); }, [leaveTo]);

  /** After login/setup/password change, each role lands on its own page. */
  const signedIn = (user: Me) => {
    if (area === 'staff' && isAdmin(user)) {
      window.location.replace(ADMIN_HOME);
      return;
    }
    setNotice('');
    setState({ needs_setup: false, user });
  };
  const signOut = async (why = '') => {
    await logout().catch(() => { /* cookie is cleared anyway on next login */ });
    setNotice(why);
    if (area === 'admin') {
      try { if (why) sessionStorage.setItem(NOTICE_KEY, why); } catch { /* ignore */ }
      window.location.replace(STAFF_HOME);
    } else {
      setState({ needs_setup: false, user: null });
    }
  };

  // both roles: signed out automatically after IDLE_MINUTES without use
  useIdleSignOut(!!state?.user && !leaveTo, () => { void signOut(IDLE_NOTICE); });

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
  if (!state || leaveTo) return <div className="center-screen note">กำลังโหลด…</div>;
  if (state.needs_setup) return <SetupForm onDone={signedIn} />;
  if (!state.user) return <LoginForm onDone={signedIn} notice={notice} />;
  if (state.user.must_change_password) {
    const u = state.user;
    return <ChangePasswordForm forced onDone={() => signedIn({ ...u, must_change_password: false })} onLogout={() => signOut()} />;
  }
  return <>{children(state.user, () => { void signOut(); })}</>;
}
