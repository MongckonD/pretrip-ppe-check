import { createContext, useContext } from 'react';
import type { Employee, Master } from '../lib/types';

export interface MasterCtx extends Master {
  reload: () => Promise<void>;
  activeEmployees: Employee[];
  nameOf: (id?: string | null) => string;
}

export const MasterContext = createContext<MasterCtx | null>(null);

export function useMaster() {
  const m = useContext(MasterContext);
  if (!m) throw new Error('MasterContext missing');
  return m;
}

export function buildMasterCtx(m: Master, reload: () => Promise<void>): MasterCtx {
  const byId = new Map(m.employees.map((e) => [e.id, e]));
  return {
    ...m,
    reload,
    activeEmployees: m.employees.filter((e) => e.active),
    nameOf: (id) => {
      if (!id) return '-';
      const e = byId.get(id);
      return e?.name || id;
    },
  };
}
