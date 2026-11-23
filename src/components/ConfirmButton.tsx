/**
 * A button that asks for a second tap instead of a pop-up: the first tap turns it into "แตะอีกครั้งเพื่อยืนยัน" for
 * a few seconds, the second tap runs the action. Works where window.confirm() is blocked (e.g. embedded browsers,
 * which answer "no" without showing anything).
 */
import { useEffect, useState, type ReactNode } from 'react';

export function ConfirmButton({ onConfirm, children, confirmText = 'แตะอีกครั้งเพื่อยืนยัน', className = 'btn ghost sm', disabled, title, ariaLabel }: {
  onConfirm: () => void; children: ReactNode; confirmText?: ReactNode; className?: string; disabled?: boolean; title?: string; ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  // back to normal if the second tap does not come
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={`${className}${armed ? ' confirm-armed' : ''}`} disabled={disabled} title={title}
      aria-label={armed ? undefined : ariaLabel}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? confirmText : children}
    </button>
  );
}
