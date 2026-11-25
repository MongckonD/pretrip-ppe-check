/**
 * PPE check, linked to today's vehicle check: the vehicle and the team (D-Man, Helper 1, Helper 2)
 * come from the vehicle-check tab, and only those people are listed here. The server enforces the same rule.
 * Once the team's PPE is saved the tab shows its summary (no admin approval for PPE); "แก้ไข PPE" opens the form again.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReadOnlyField, Seg, thaiDay, useNow } from '../components/Fields';
import { useMaster } from '../components/MasterContext';
import { CheckPicker, NoCheckYet, useTodayChecks } from '../components/TodayChecks';
import { useToast } from '../components/Toast';
import { RefreshButton } from '../components/RefreshButton';
import { listPpeInspections, savePpeInspections } from '../lib/api';
import type { PpeInspection, PpeItem, PpeResult } from '../lib/types';
import { errMsg, today } from '../lib/utils';
import { AlertIcon, CheckCircleIcon } from '../components/Icons';

const PPE_OPTS = [
  { v: 1 as PpeResult, label: 'มี', cls: 'p' as const },
  { v: 2 as PpeResult, label: 'ไม่มี', cls: 'f' as const },
];

type Rows = Record<string, Record<string, PpeResult>>;

interface CrewMember { id: string; role: string }

export function PpePage({ goVehicle, goTime }: { goVehicle?: () => void; goTime?: () => void }) {
  const { ppeItems, nameOf, codeOf } = useMaster();
  const toast = useToast();
  const items = ppeItems.filter((p) => p.active);

  // the PPE date is not editable: always today (the server stamps it on save)
  const now = useNow();
  const [day, setDay] = useState(today());
  useEffect(() => { if (today() !== day) setDay(today()); }, [now, day]);

  const { checks, check, selId, setSelId, reload: reloadChecks } = useTodayChecks(day);
  const [records, setRecords] = useState<PpeInspection[]>([]);
  const [rows, setRows] = useState<Rows>({});
  const [saving, setSaving] = useState(false);
  // the vehicle check whose saved PPE is being edited (otherwise a saved team shows its summary)
  const [editing, setEditing] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setRecords(await listPpeInspections({ date: day })); }
    catch (e) { toast('โหลดข้อมูลไม่สำเร็จ: ' + errMsg(e)); }
  }, [day, toast]);
  useEffect(() => { reload(); }, [reload]);
  const crew = useMemo<CrewMember[]>(() => (check ? [
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
      await reload();
      setEditing(null);
    } catch (e) {
      toast('บันทึกไม่สำเร็จ: ' + errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (checks === null) return <div className="empty">กำลังโหลด…</div>;

  // "รีเฟรช": the team's PPE may have been saved / changed on another phone (not on the form: it keeps what is typed)
  const refresh = () => Promise.all([reloadChecks(), reload()]);
  if (!checks.length) return <NoCheckYet title="ตรวจ PPE พนักงาน" then="รายชื่อทีมจะขึ้นที่นี่ให้ตรวจ PPE" goVehicle={goVehicle} onRefresh={refresh} />;

  const saved = crew.filter((c) => records.some((r) => r.employee_id === c.id && r.plate === check?.plate));
  if (check && saved.length && editing !== check.id) {
    return (
      <>
        {checks.length > 1 && <section className="panel"><CheckPicker checks={checks} selId={selId} onPick={setSelId} /></section>}
        <PpeSummary plate={check.plate} dman={check.dman_id} crew={crew} items={items}
          records={records.filter((r) => r.plate === check.plate)}
          onEdit={() => setEditing(check.id)} onTime={goTime} onRefresh={refresh} />
      </>
    );
  }

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
            <div><b>{nameOf(c.id)}</b> <span className="note">{[codeOf(c.id), c.role].filter(Boolean).join(' · ')}</span></div>
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
        <div className="row">
          <button className="btn ghost sm" type="button" onClick={allHave}>มีครบทุกคน</button>
          {saved.length > 0 && <button className="btn ghost sm" type="button" onClick={() => setEditing(null)}>ยกเลิกการแก้ไข</button>}
        </div>
        <button className="btn" type="button" disabled={saving || !check} onClick={save}>{saving ? 'กำลังบันทึก…' : 'บันทึก PPE'}</button>
      </div>
    </section>
  );
}

/** Shown once the team's PPE is saved: who has everything and what is missing. PPE needs no admin approval. */
function PpeSummary({ plate, dman, crew, items, records, onEdit, onTime, onRefresh }: {
  plate: string; dman: string; crew: CrewMember[]; items: PpeItem[]; records: PpeInspection[];
  onEdit: () => void; onTime?: () => void; onRefresh: () => unknown;
}) {
  const { nameOf } = useMaster();
  const rows = crew.map((c) => {
    const r = records.find((x) => x.employee_id === c.id);
    const missing = r ? items.filter((i) => r.results?.[i.code] === 2).map((i) => i.name) : [];
    const blank = r ? items.filter((i) => !r.results?.[i.code]).length : items.length;
    return { ...c, r, missing, blank };
  });
  const ok = rows.filter((x) => x.r?.status === 'ครบ').length;
  const notOk = rows.filter((x) => x.r && x.r.status !== 'ครบ').length;
  const notYet = rows.filter((x) => !x.r).length;
  const allOk = ok === crew.length;
  const day = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <section className="panel sum">
      <div className={`sum-status ${allOk ? 'ok' : 'wait'}`} role="status">
        <span className="sum-icon" aria-hidden="true">{allOk ? <CheckCircleIcon /> : <AlertIcon />}</span>
        <div>
          <b>บันทึก PPE แล้ว</b>
          <span>{allOk ? 'ทุกคนในทีมมีอุปกรณ์ครบ' : notYet ? `ยังไม่ได้ตรวจ ${notYet} คน` : `มีอุปกรณ์ไม่ครบ ${notOk} คน`}</span>
        </div>
        <RefreshButton className="sum-refresh" onRefresh={onRefresh} />
      </div>

      <h2 className="sum-title">สรุปผลการตรวจ PPE <span className={`pill ${allOk ? 'p' : 'f'}`}>{allOk ? 'ครบทุกคน' : 'ไม่ครบ'}</span></h2>
      <dl className="sum-meta">
        <dt>ทะเบียนรถ</dt><dd>{plate}</dd>
        <dt>วันที่</dt><dd>{day}</dd>
        <dt>ผู้ตรวจ D-Man</dt><dd>{nameOf(dman)}</dd>
      </dl>

      <div className="sum-counts">
        <div className="sum-count pass"><b>{ok}</b><span>ครบ</span></div>
        <div className="sum-count fail"><b>{notOk}</b><span>ไม่ครบ</span></div>
        <div className="sum-count"><b>{notYet}</b><span>ยังไม่ได้ตรวจ</span></div>
        <div className="sum-count"><b>{crew.length}</b><span>คนในทีม</span></div>
      </div>

      <ul className="ppe-sum-list">
        {rows.map((x) => (
          <li key={x.id}>
            <div>
              <b>{nameOf(x.id)}</b> <span className="note">{x.role}</span>
              {x.missing.length > 0 && <div className="ppe-sum-miss">ไม่มี: {x.missing.join(', ')}</div>}
              {x.r && !x.missing.length && x.blank > 0 && <div className="note">ยังไม่ได้ตรวจ {x.blank} รายการ</div>}
            </div>
            {!x.r ? <span className="pill x">ยังไม่ได้ตรวจ</span>
              : x.r.status === 'ครบ' ? <span className="pill p">ครบ</span>
                : <span className="pill f">{x.r.status}</span>}
          </li>
        ))}
      </ul>

      <div className="sum-actions">
        {onTime && <button className="btn" onClick={onTime}>ไปบันทึกเวลาทำงาน</button>}
        <button className="btn ghost" onClick={onEdit}>แก้ไข PPE</button>
      </div>
    </section>
  );
}
