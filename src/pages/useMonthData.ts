import { useEffect, useState } from 'react';
import { listPpeInspections, listVehicleInspections } from '../lib/api';
import type { PpeInspection, VehicleInspection } from '../lib/types';
import { errMsg } from '../lib/utils';

export function useMonthData(month: string) {
  const [veh, setVeh] = useState<VehicleInspection[]>([]);
  const [ppe, setPpe] = useState<PpeInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([listVehicleInspections({ month }), listPpeInspections({ month })])
      .then(([v, p]) => { if (alive) { setVeh(v); setPpe(p); setError(''); } })
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [month]);

  return { veh, ppe, loading, error };
}
