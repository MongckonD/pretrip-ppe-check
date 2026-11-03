import { useEffect, useState } from 'react';
import { useMaster } from './MasterContext';
import { signedUrls } from '../lib/api';

export function EmployeeSelect(props: {
  value: string;
  onChange: (v: string) => void;
  blank: string;
  id?: string;
  /** people already picked in another slot (e.g. D-Man vs helpers) */
  exclude?: string[];
}) {
  const { activeEmployees } = useMaster();
  const taken = new Set((props.exclude ?? []).filter((x) => x && x !== props.value));
  return (
    <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.blank}</option>
      {activeEmployees.filter((e) => !taken.has(e.id)).map((e) => (
        <option key={e.id} value={e.id}>
          {e.id}
          {e.name ? ` · ${e.name}` : ''}
        </option>
      ))}
    </select>
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
