import { useEffect, useId, useRef, useState } from 'react';
import { useMaster } from './MasterContext';
import { signedUrls } from '../lib/api';

/**
 * Employee picker you can type into: type part of a code or name to filter, then pick
 * (click, or ↑ ↓ + Enter). Only employees in the system can be chosen, because every
 * record is linked to an employee in the database; leaving the box empty means "none".
 */
export function EmployeeSelect(props: {
  value: string;
  onChange: (v: string) => void;
  blank: string;
  id?: string;
  /** people already picked in another slot (e.g. D-Man vs helpers) */
  exclude?: string[];
}) {
  const { activeEmployees } = useMaster();
  const autoId = useId();
  const listId = `${props.id ?? autoId}-list`;
  const taken = new Set((props.exclude ?? []).filter((x) => x && x !== props.value));
  const choices = activeEmployees.filter((e) => !taken.has(e.id));
  const labelOf = (id: string) => {
    const e = activeEmployees.find((x) => x.id === id);
    return e ? (e.name ? `${e.id} · ${e.name}` : e.id) : id;
  };

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(0);
  const [alignRight, setAlignRight] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /** open the list; near the right edge of the screen it opens leftwards so it never goes off screen */
  const openList = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (r) {
      const listW = Math.max(r.width, Math.min(260, window.innerWidth - 32));
      setAlignRight(r.left + listW > window.innerWidth - 8);
    }
    setOpen(true);
  };

  const q = typing ? text.trim().toLowerCase() : '';
  const matches = q ? choices.filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)) : choices;
  // first row clears the field ("ไม่มี" / "เลือกผู้ตรวจ"), then the matching employees
  const rows: { id: string; label: string }[] = [
    ...(q ? [] : [{ id: '', label: props.blank }]),
    ...matches.map((e) => ({ id: e.id, label: e.name ? `${e.id} · ${e.name}` : e.id })),
  ];

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (id: string) => {
    props.onChange(id);
    setTyping(false);
    setOpen(false);
  };
  /** leaving the box: keep what was typed only if it names exactly one employee */
  const settle = () => {
    if (typing) {
      const t = text.trim().toLowerCase();
      if (!t) props.onChange('');
      else {
        const exact = choices.find((e) => e.id.toLowerCase() === t || e.name.toLowerCase() === t);
        const only = matches.length === 1 ? matches[0] : undefined;
        const hit = exact ?? only;
        if (hit) props.onChange(hit.id);
      }
    }
    setTyping(false);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      const n = rows.length;
      if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      if (open && rows[active]) { e.preventDefault(); pick(rows[active].id); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setTyping(false); setOpen(false); }
    }
  };

  return (
    <div className="combo" ref={boxRef}>
      <input
        id={props.id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={props.blank}
        value={typing ? text : props.value ? labelOf(props.value) : ''}
        onFocus={(e) => { openList(); setActive(0); e.currentTarget.select(); }}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => { setText(e.target.value); setTyping(true); if (!open) openList(); setActive(0); }}
        onBlur={settle}
        onKeyDown={onKey}
      />
      <span className="combo-caret" aria-hidden="true" />
      {open && (
        <ul className={`combo-list${alignRight ? ' right' : ''}`} id={listId} role="listbox" ref={listRef}>
          {rows.length ? rows.map((r, i) => (
            <li
              key={r.id || '_blank'}
              id={`${listId}-${i}`}
              data-i={i}
              role="option"
              aria-selected={r.id === props.value}
              className={`${i === active ? 'active' : ''}${r.id ? '' : ' blank'}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              // preventDefault: the field sits inside a <label>, which would otherwise click the input and reopen the list
              onClick={(e) => { e.preventDefault(); pick(r.id); }}
            >
              {r.label}
            </li>
          )) : <li className="combo-empty">ไม่พบพนักงาน "{text.trim()}"</li>}
        </ul>
      )}
    </div>
  );
}

/** Current time, refreshed every 15 s (for date/time shown on the forms; the server stamps the real one). */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export const thaiDay = (d: Date) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
export const thaiClock = (d: Date) => `${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
/** "2026-11-18" (+ "08:05") → Date in local time */
export const fromIso = (date: string, time = '00:00') => new Date(`${date}T${time.slice(0, 5)}:00`);

/** Value the user can see but not change (e.g. the date/time the system records). */
export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="ro">
      <span className="ro-label">{label}</span>
      <div className="ro-value" aria-label={`${label} (ระบบกำหนด)`}>{value}</div>
    </div>
  );
}

export function PlateInput(props: { value: string; onChange: (v: string) => void; id?: string }) {
  const { vehicles } = useMaster();
  const listId = `${props.id ?? 'plate'}-list`;
  return (
    <>
      <input
        id={props.id}
        list={listId}
        value={props.value}
        placeholder="เช่น 1กก 1234"
        onChange={(e) => props.onChange(e.target.value)}
      />
      <datalist id={listId}>
        {vehicles.filter((v) => v.active).map((v) => (
          <option key={v.id} value={v.plate}>{v.type}</option>
        ))}
      </datalist>
    </>
  );
}

type Opt<T> = { v: T; label: string; cls: 'p' | 'f' | 'x' };

export function Seg<T extends number>(props: {
  value: T | undefined;
  options: Opt<T>[];
  onChange: (v: T | undefined) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <div className={`seg${props.compact ? ' compact' : ''}`} role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={o.cls}
          aria-pressed={props.value === o.v}
          onClick={() => props.onChange(props.value === o.v ? undefined : o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Resolve private storage paths to short-lived signed URLs. */
export function useSignedUrls(paths: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = [...paths].sort().join('|');
  useEffect(() => {
    let alive = true;
    const missing = paths.filter((p) => !urls[p]);
    if (!missing.length) return;
    signedUrls(missing)
      .then((u) => alive && setUrls((prev) => ({ ...prev, ...u })))
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

export function Kpi(props: { value: string | number; label: string; tone?: 'good' | 'bad' | '' }) {
  return (
    <div className={`kpi ${props.tone ?? ''}`}>
      <b>{props.value}</b>
      <span>{props.label}</span>
    </div>
  );
}

export function ConfirmDelete(props: { onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  return ask ? (
    <>
      <button className="btn danger sm" onClick={() => { setAsk(false); props.onConfirm(); }}>ยืนยันลบ</button>
      <button className="btn ghost sm" onClick={() => setAsk(false)}>ยกเลิก</button>
    </>
  ) : (
    <button className="btn danger sm" onClick={() => setAsk(true)}>ลบ</button>
  );
}
