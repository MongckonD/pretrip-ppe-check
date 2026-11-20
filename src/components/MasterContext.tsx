import { createContext, useContext } from 'react';
import type { Employee, Master } from '../lib/types';

/**
 * Master data + how to show an employee. The internal id (EMP01) is only a database key and is never shown:
 * people are shown by name, and by their company employee code (employees.emp_code) where a code is needed.
 */
export interface MasterCtx extends Master {
  reload: () => Promise<void>;
  activeEmployees: Employee[];
  /** name; falls back to the employee code when the name is empty */
  nameOf: (id?: string | null) => string;
  /** company employee code ('' when not set) */
  codeOf: (id?: string | null) => string;
  /** "650123 · สมชาย ใจดี" (code and name, whichever exist) */
  labelOf: (id?: string | null) => string;
}

export const MasterContext = createContext<MasterCtx | null>(null);

export function useMaster() {
  const m = useContext(MasterContext);
  if (!m) throw new Error('MasterContext missing');
  return m;
}

/** "650123 · สมชาย ใจดี" for one employee */
export const employeeLabel = (e: Employee) => [e.code, e.name].filter(Boolean).join(' · ') || 'พนักงาน (ยังไม่มีชื่อและรหัส)';

export function buildMasterCtx(m: Master, reload: () => Promise<void>): MasterCtx {
  const byId = new Map(m.employees.map((e) => [e.id, e]));
  return {
    ...m,
    reload,
    activeEmployees: m.employees.filter((e) => e.active),
    nameOf: (id) => {
      if (!id) return '-';
      const e = byId.get(id);
      return e?.name || e?.code || 'ไม่ทราบชื่อ';
    },
    codeOf: (id) => (id ? byId.get(id)?.code ?? '' : ''),
    labelOf: (id) => {
      if (!id) return '-';
      const e = byId.get(id);
      return e ? employeeLabel(e) : 'ไม่ทราบชื่อ';
    },
  };
}
