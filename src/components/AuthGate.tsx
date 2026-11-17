/**
 * Login flow shared by both web pages: first-time setup → login → (forced password change) → page.
 * Each role has exactly one page (the Worker enforces this too):
 *   staff  — role user only; a signed-in admin is sent to /admin/
 *   admin  — role admin only; anyone else is sent to / (where the login screen is)
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { UNAUTHORIZED_EVENT, authStatus, logout, type Me } from '../lib/api';
import { errMsg } from '../lib/utils';
import { ChangePasswordForm, LoginForm, SetupForm } from './Auth';

export const ADMIN_HOME = '/admin/';
export const STAFF_HOME = '/';

type AuthState = { needs_setup: boolean; user: Me | null };

export function AuthGate({ area, children }: { area: 'staff' | 'admin'; children: (me: Me, signOut: () => void) => ReactNode }) {
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
    setState({ needs_setup: false, user });
  };
  const signOut = async () => {
    await logout().catch(() => { /* cookie is cleared anyway on next login */ });
    if (area === 'admin') window.location.replace(STAFF_HOME);
    else setState({ needs_setup: false, user: null });
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
  if (!state || leaveTo) return <div className="center-screen note">กำลังโหลด…</div>;
  if (state.needs_setup) return <SetupForm onDone={signedIn} />;
  if (!state.user) return <LoginForm onDone={signedIn} />;
  if (state.user.must_change_password) {
    const u = state.user;
    return <ChangePasswordForm forced onDone={() => signedIn({ ...u, must_change_password: false })} onLogout={signOut} />;
  }
  return <>{children(state.user, signOut)}</>;
}
