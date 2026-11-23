/**
 * "กำลังพัฒนา" gate for a feature that is not ready for real work yet.
 * Staff see a notice first; "ดูตัวอย่าง" opens the trial version (kept open for this browser tab session).
 * Used by the store-delivery timer until its database design is agreed.
 */
import { useState, type ReactNode } from 'react';
import { AlertIcon } from './Icons';

export function DevBadge() {
  // construction-sign look: black / yellow stripes around the text
  return <span className="dev-badge" title="ฟีเจอร์นี้อยู่ระหว่างพัฒนา ยังไม่ใช้ในงานจริง"><span>กำลังพัฒนา</span></span>;
}

export function DevGate({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const key = `dev-preview:${id}`;
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(key) === '1'; } catch { return false; } });
  const set = (v: boolean) => { setOpen(v); try { sessionStorage.setItem(key, v ? '1' : '0'); } catch { /* storage unavailable */ } };

  if (open) {
    return (
      <>
        <div className="dev-strip" role="note">
          <span><span className="warn-ico" aria-hidden><AlertIcon /></span><b>{title}</b> อยู่ระหว่างพัฒนา — นี่คือหน้าตัวอย่าง ยังไม่ใช้บันทึกงานจริง</span>
          <button type="button" className="btn ghost sm" onClick={() => set(false)}>ปิดตัวอย่าง</button>
        </div>
        {children}
      </>
    );
  }
  return (
    <section className="panel dev-notice">
      <div className="dev-notice-ico" aria-hidden><AlertIcon /></div>
      <DevBadge />
      <h2>{title}</h2>
      <p>ฟีเจอร์นี้<b>อยู่ระหว่างพัฒนา</b> ยังไม่เปิดใช้ในงานจริง<br />ตอนนี้ยังไม่ต้องบันทึกอะไรในหน้านี้</p>
      <button type="button" className="btn ghost" onClick={() => set(true)}>ดูหน้าตัวอย่าง</button>
    </section>
  );
}
