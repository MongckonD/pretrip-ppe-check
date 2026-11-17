/**
 * Personal-data consent shown to staff right after login (until they accept the current version).
 * "ยอมรับ" unlocks only after the text has been scrolled to the end.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptConsent } from '../lib/api';
import { CONSENT } from '../lib/consent';
import { errMsg } from '../lib/utils';

export function ConsentScreen({ onAccepted, onLogout }: { onAccepted: () => void; onLogout: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [readAll, setReadAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(() => {
    const b = boxRef.current;
    if (b && b.scrollTop + b.clientHeight >= b.scrollHeight - 8) setReadAll(true);
  }, []);
  // short screens / big fonts: the text may already fit without scrolling
  useEffect(() => { check(); window.addEventListener('resize', check); return () => window.removeEventListener('resize', check); }, [check]);

  async function accept() {
    setBusy(true); setError('');
    try { await acceptConsent(CONSENT.version); onAccepted(); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="center-screen">
      <div className="panel login consent">
        <div className="step-note">ขั้นตอนที่ 1 จาก 2</div>
        <h1>{CONSENT.title}</h1>
        <p className="note">เลื่อนอ่านรายละเอียดให้ครบ แล้วกด "ยอมรับ"</p>
        <div className="consent-text" ref={boxRef} onScroll={check} tabIndex={0} aria-label={CONSENT.title}>
          {CONSENT.sections.map((s) => (
            <section key={s.heading}>
              <h2>{s.heading}</h2>
              {s.body.map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
            </section>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn consent-accept" onClick={accept} disabled={!readAll || busy}>
          {busy ? 'กำลังบันทึก…' : readAll ? 'ยอมรับ' : 'เลื่อนอ่านให้ครบก่อน'}
        </button>
        <button className="btn ghost" onClick={onLogout} disabled={busy}>ไม่ยอมรับ และออกจากระบบ</button>
      </div>
    </div>
  );
}
