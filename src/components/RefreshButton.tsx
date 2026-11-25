/**
 * "รีเฟรช": load the page's data again (another phone of the team, or the admin, may have changed it).
 * Shows "กำลังโหลด…" while busy; an error is left to the page's own load function (it already shows a toast).
 */
import { useState } from 'react';
import { RefreshIcon } from './Icons';

export function RefreshButton({ onRefresh, className = '' }: { onRefresh: () => Promise<unknown> | unknown; className?: string }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true);
    try { await onRefresh(); } catch { /* the page's loader reports it */ } finally { setBusy(false); }
  }
  return (
    <button type="button" className={`btn ghost sm refresh-btn ${className}`} disabled={busy} onClick={run}>
      <span className="ii" aria-hidden><RefreshIcon /></span>{busy ? 'กำลังโหลด…' : 'รีเฟรช'}
    </button>
  );
}
