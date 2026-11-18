/**
 * PPE check, linked to today's vehicle check: the vehicle and the team (D-Man, Helper 1, Helper 2)
 * come from the vehicle-check tab, and only those people are listed here. The server enforces the same rule.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReadOnlyField, Seg, thaiDay, useNow } from '../components/Fields';
import { useMaster } from '../components/MasterContext';
import { CheckPicker, NoCheckYet, useTodayChecks } from '../components/TodayChecks';
import { useToast } from '../components/Toast';
import { listPpeInspections, savePpeInspections } from '../lib/api';
import type { PpeInspection, PpeResult } from '../lib/types';
import { errMsg, today } from '../lib/utils';

const PPE_OPTS = [
  { v: 1 as PpeResult, label: 'มี', cls: 'p' as const },
  { v: 2 as PpeResult, label: 'ไม่มี', cls: 'f' as const },
];

type Rows = Record<string, Record<string, PpeResult>>;

export function PpePage({ goVehicle }: { goVehicle?: () => void }) {
  const { ppeItems, nameOf } = useMaster();
  const toast = useToast();
  const items = ppeItems.filter((p) => p.active);

  // the PPE date is not editable: always today (the server stamps it on save)
  const now = useNow();
  const [day, setDay] = useState(today());
  useEffect(() => { if (today() !== day) setDay(today()); }, [now, day]);

  const { checks, check, selId, setSelId } = useTodayChecks(day);
  const [records, setRecords] = useState<PpeInspection[]>([]);
  const [rows, setRows] = useState<Rows>({});
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try { setRecords(await listPpeInspections({ date: day })); }
    catch (e) { toast('โหลดข้อมูลไม่สำเร็จ: ' + errMsg(e)); }
  }, [day, toast]);
  useEffect(() => { reload(); }, [reload]);
  const crew = useMemo(() => (check ? [
    { id: check.dman_id, role: 'D-Man' },
    ...(check.helper1_id ? [{ id: check.helper1_id, role: 'Helper 1' }] : []),
    ...(check.helper2_id ? [{ id: check.helper2_id, role: 'Helper 2' }] : []),
  ] : []), [check]);

  // switching vehicle: start from what was already saved today for these people
  useEffect(() => {
    setRows(Object.fromEntries(crew.map((c) => [c.id, { ...(records.find((r) => r.employee_id === c.id)?.results ?? {}) }])));
  }, [crew, records]);

  function setCell(emp: string, code: string, v: PpeResult | undefined) {
    setRows((p) => {
      const row = { ...(p[emp] ?? {}) };
      if (v === undefined) delete row[code]; else row[code] = v;
      return { ...p, [emp]: row };
    });
  }

  function allHave() {
    const full = Object.fromEntries(items.map((i) => [i.code, 1 as PpeResult]));
    setRows(Object.fromEntries(crew.map((c) => [c.id, { ...full }])));
  }

  async function save() {
    if (!check) return;
    const filled = crew.filter((c) => Object.keys(rows[c.id] ?? {}).length);
    if (!filled.length) return toast('ยังไม่ได้ตรวจ PPE ของใคร');
    setSaving(true);
    try {
      const n = await savePpeInspections({
        date: today(), plate: check.plate, inspector: check.dman_id,
        rows: Object.fromEntries(filled.map((c) => [c.id, rows[c.id]])),
      });
      toast(`บันทึก PPE ${n} คนแล้ว`);
      reload();
    } catch (e) {
      toast('บันทึกไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (checks === null) return <div className="empty">กำลังโหลด…</div>;

  if (!checks.length) return <NoCheckYet title="ตรวจ PPE พนักงาน" then="รายชื่อทีมจะขึ้นที่นี่ให้ตรวจ PPE" goVehicle={goVehicle} />;

  return (
    <section className="panel">
      <h2>ตรวจ PPE พนักงาน</h2>

      <CheckPicker checks={checks} selId={selId} onPick={setSelId} />

      <div className="form-head">
        <div className="fields c3">
          <ReadOnlyField label="วันที่" value={thaiDay(now)} />
          <ReadOnlyField label="ทะเบียนรถ" value={check?.plate ?? '–'} />
          <ReadOnlyField label="ผู้ตรวจ D-Man" value={check ? nameOf(check.dman_id) : '–'} />
        </div>
      </div>
      <p className="note">ทะเบียนรถและทีมงานมาจากการตรวจรถ ถ้าต้องการเปลี่ยน ให้แก้ที่แท็บตรวจรถ</p>

      <div className="mt">
        {crew.map((c) => (
          <div className="emp" key={c.id}>
            <div><b>{nameOf(c.id)}</b> <span className="note">{c.id} · {c.role}</span></div>
            <div className="ppeit">
              {items.map((p) => (
                <div key={p.code}>
                  <span>{p.name}</span>
                  <Seg compact label={`${c.id} ${p.name}`} value={rows[c.id]?.[p.code]} options={PPE_OPTS}
                    onChange={(v) => setCell(c.id, p.code, v)} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="row spread mt">
        <button className="btn ghost sm" type="button" onClick={allHave}>มีครบทุกคน</button>
        <button className="btn" type="button" disabled={saving || !check} onClick={save}>{saving ? 'กำลังบันทึก…' : 'บันทึก PPE'}</button>
      </div>
    </section>
  );
}
