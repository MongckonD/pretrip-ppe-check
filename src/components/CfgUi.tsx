/** Building blocks of the admin settings page (shared with UsersPanel). */
import type { ReactNode } from 'react';

/** green "ใช้งาน" / grey "ปิดอยู่" switch */
export function ActiveSwitch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={onToggle}>
      <span className="switch-knob" aria-hidden />
      <span className="switch-text">{on ? 'ใช้งาน' : 'ปิดอยู่'}</span>
    </button>
  );
}

/** box header: icon · title · count · one line on what it is for */
export function CfgHead({ icon, title, count, sub }: { icon: ReactNode; title: string; count?: string; sub?: string }) {
  return (
    <div className="cfg-head">
      <span className="cfg-ico" aria-hidden>{icon}</span>
      <div>
        <h2 className="flush">{title}{count && <span className="cfg-count">{count}</span>}</h2>
        {sub && <p className="note flush-note">{sub}</p>}
      </div>
    </div>
  );
}

export const CFG_PAGE = 10;

/** "แถวที่ 1–10 จาก 21 · ‹ ก่อนหน้า · หน้า 1/3 · ถัดไป ›" (nothing when it all fits on one page) */
export function CfgPager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / CFG_PAGE));
  if (pages <= 1) return null;
  return (
    <div className="pager" role="navigation" aria-label="เปลี่ยนหน้า">
      <span className="note">แถวที่ {page * CFG_PAGE + 1}–{Math.min(total, page * CFG_PAGE + CFG_PAGE)} จาก {total}</span>
      <div className="row">
        <button type="button" className="btn ghost sm" disabled={page === 0} onClick={() => onPage(page - 1)}>‹ ก่อนหน้า</button>
        <span className="pager-no">หน้า {page + 1}/{pages}</span>
        <button type="button" className="btn ghost sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>ถัดไป ›</button>
      </div>
    </div>
  );
}
