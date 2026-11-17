/**
 * Driver licence for staff:
 *   - LicenseCapture: photo box → "ถ่ายรูปใบขับขี่" (camera only) → OCR fills name / number / expiry → user checks → save
 *   - LicenseOnboarding: required step right after the consent; staff cannot enter the app without a licence
 *   - LicensePage (tab "ใบขับขี่"): current licence + status, send a new one
 *   - LicenseBanner: reminder on every page when the licence is expiring or expired
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarIcon, CameraIcon, HashIcon, LogoutIcon, UserIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { licensePhotoUrl, saveMyLicense } from '../lib/api';
import {
  LICENSE_WARN_DAYS, licenseStatus, statusText, thaiDate, type DriverLicense, type LicenseInfo,
} from '../lib/license';
import type { ParsedLicense } from '../lib/licenseParse';
import type { OcrStage, PreparedPhoto } from '../lib/licenseOcr';
import { errMsg, today } from '../lib/utils';

const TONE: Record<string, string> = { ok: 'p', lifetime: 'p', expiring: 'w', expired: 'f' };
const LABEL: Record<string, string> = {
  ok: 'ใช้ได้', lifetime: 'ตลอดชีพ', expiring: 'ใกล้หมดอายุ', expired: 'หมดอายุแล้ว',
};

export function LicensePill({ status }: { status: string }) {
  return <span className={`pill ${TONE[status] ?? 'x'}`}>{LABEL[status] ?? status}</span>;
}

/* ---------------------------------------------------------------------
 * Capture → OCR → check → save
 * ------------------------------------------------------------------- */

interface Fields { full_name: string; license_no: string; expiry_date: string; lifetime: boolean }
const EMPTY: Fields = { full_name: '', license_no: '', expiry_date: '', lifetime: false };

function IconField(props: { icon: () => JSX.Element; label: string; auto: boolean; children: ReactNode }) {
  return (
    <label className="ifield">
      <span className="ifield-ico" aria-hidden="true"><props.icon /></span>
      <span className="ifield-body">
        <span className="ifield-label">{props.label}{props.auto && <em className="auto-tag">อ่านจากรูป</em>}</span>
        {props.children}
      </span>
    </label>
  );
}

export function LicenseCapture({ onSaved, submitLabel, onCancel }: {
  onSaved: (i: LicenseInfo) => void; submitLabel: string; onCancel?: () => void;
}) {
  const toast = useToast();
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [ocr, setOcr] = useState<{ stage: OcrStage; pct: number } | null>(null);
  const [found, setFound] = useState<ParsedLicense | null>(null);
  const [f, setF] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useRef(0);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.previewUrl); }, [photo]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const id = ++run.current;
    setError(''); setFound(null);
    try {
      const { preparePhoto, readLicense } = await import('../lib/licenseOcr');
      const p = await preparePhoto(file);
      if (id !== run.current) return;
      setPhoto(p);
      setOcr({ stage: 'loading', pct: 0 });
      const { parsed } = await readLicense(p, (stage, pct) => { if (id === run.current) setOcr({ stage, pct }); });
      if (id !== run.current) return;
      setFound(parsed);
      // fill what was read; keep what the user already typed for fields OCR could not read
      setF((cur) => ({
        full_name: parsed.fullName ?? cur.full_name,
        license_no: parsed.licenseNo ?? cur.license_no,
        expiry_date: parsed.expiry ?? (parsed.lifetime ? '' : cur.expiry_date),
        lifetime: parsed.lifetime ?? (parsed.expiry ? false : cur.lifetime),
      }));
      if (!Object.values(parsed).some(Boolean)) setError('อ่านข้อมูลจากรูปไม่ได้ ถ่ายใหม่ให้ชัดขึ้น หรือกรอกข้อมูลเอง');
    } catch (e) {
      if (id === run.current) { setFound({}); setError(`อ่านข้อมูลอัตโนมัติไม่สำเร็จ (${errMsg(e)}) กรอกข้อมูลเองได้`); }
    } finally {
      if (id === run.current) setOcr(null);
    }
  }

  async function save() {
    if (!photo) { setError('กรุณาถ่ายรูปใบขับขี่ก่อน'); return; }
    setBusy(true); setError('');
    try {
      const info = await saveMyLicense({
        photo: photo.upload, ...f, ocr_used: !!found && Object.values(found).some(Boolean),
      });
      toast('บันทึกใบขับขี่แล้ว');
      onSaved(info);
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  const ready = !!photo && !ocr && f.full_name.trim().length >= 2
    && f.license_no.replace(/[\s-]/g, '').length >= 5 && (f.lifetime || !!f.expiry_date);
  const preview = !f.lifetime && f.expiry_date ? licenseStatus(f.expiry_date, false, today()) : null;
  const auto = (k: keyof ParsedLicense) => !!found?.[k];

  return (
    <div className="lic-cap">
      {/* photo box: placeholder → photo; reading progress on top */}
      <div className={`lic-shot${photo ? ' has' : ''}`}>
        {photo ? <img src={photo.previewUrl} alt="รูปใบขับขี่ที่ถ่าย" /> : (
          <div className="lic-empty"><CameraIcon /><span>ยังไม่มีรูปใบขับขี่</span></div>
        )}
        {ocr && (
          <div className="lic-reading" role="status">
            <b>{ocr.stage === 'loading' ? 'กำลังเตรียมตัวอ่าน…' : 'กำลังอ่านข้อมูลจากรูป…'}</b>
            <div className="prog"><i style={{ width: `${ocr.pct}%` }} /></div>
          </div>
        )}
      </div>
      {/* camera only: no picking an old photo from the gallery */}
      <label className={`btn lic-shoot${photo ? ' ghost' : ''}`}>
        <CameraIcon /> {photo ? 'ถ่ายรูปใหม่' : 'ถ่ายรูปใบขับขี่'}
        <input type="file" accept="image/*" capture="environment" disabled={!!ocr || busy}
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {!photo && <p className="note lic-hint">วางบัตรบนพื้นเรียบ ถ่ายด้านหน้าให้เต็มกรอบ แสงพอและไม่สะท้อน ระบบจะอ่านข้อมูลให้อัตโนมัติ</p>}

      <h3 className="lic-sub">ข้อมูลใบขับขี่</h3>
      {found && Object.values(found).some(Boolean) && <p className="note">ตรวจสอบข้อมูลที่อ่านได้ให้ตรงกับใบขับขี่ แก้ได้ถ้าไม่ถูก</p>}
      <div className="lic-fields">
        <IconField icon={UserIcon} label="ชื่อ-นามสกุล" auto={auto('fullName')}>
          <input value={f.full_name} autoComplete="off" placeholder="กรอกชื่อ-นามสกุล"
            onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        </IconField>
        <IconField icon={HashIcon} label="เลขที่ใบขับขี่" auto={auto('licenseNo')}>
          <input value={f.license_no} inputMode="numeric" autoComplete="off" placeholder="กรอกเลขใบขับขี่"
            onChange={(e) => setF({ ...f, license_no: e.target.value })} />
        </IconField>
        <IconField icon={CalendarIcon} label="วันหมดอายุ" auto={auto('expiry') || auto('lifetime')}>
          <input type="date" value={f.lifetime ? '' : f.expiry_date} disabled={f.lifetime}
            onChange={(e) => setF({ ...f, expiry_date: e.target.value })} />
        </IconField>
        <label className="check-line">
          <input type="checkbox" checked={f.lifetime} onChange={(e) => setF({ ...f, lifetime: e.target.checked })} />
          ใบขับขี่ตลอดชีพ (ไม่มีวันหมดอายุ)
        </label>
      </div>
      {preview && preview.status !== 'ok' && (
        <div className={`lic-warn ${preview.status}`}>
          {preview.status === 'expired' ? 'ใบขับขี่นี้หมดอายุแล้ว' : `ใบขับขี่นี้จะหมดอายุใน ${preview.days_left} วัน`} — กรุณาต่ออายุ
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <button className="btn lic-save" onClick={save} disabled={!ready || busy}>
        {busy ? 'กำลังบันทึก…' : submitLabel}
      </button>
      {!photo && <p className="note lic-hint">ต้องถ่ายรูปใบขับขี่ก่อนจึงจะบันทึกได้</p>}
      {onCancel && <button className="btn ghost" type="button" onClick={onCancel} disabled={busy}>ยกเลิก</button>}
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Required step after login (no licence on file yet)
 * ------------------------------------------------------------------- */

export function LicenseOnboarding({ onSaved, onLogout, onSkip }: {
  onSaved: (i: LicenseInfo) => void; onLogout: () => void; onSkip?: () => void;
}) {
  return (
    <div className="lic-screen">
      <header className="lic-bar">
        <b>ใบขับขี่</b>
        <button className="lic-bar-out" onClick={onLogout}><LogoutIcon /> ออกจากระบบ</button>
      </header>
      <main className="lic-screen-body">
        <p className="lic-lead">กรุณาถ่ายรูปใบขับขี่และกรอกข้อมูลให้ครบก่อนเข้าหน้าหลัก</p>
        <LicenseCapture onSaved={onSaved} submitLabel="บันทึกและไปหน้าหลัก" />
        {onSkip && <button className="btn ghost lic-skip" onClick={onSkip}>ข้ามไปหน้าหลัก</button>}
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Tab "ใบขับขี่"
 * ------------------------------------------------------------------- */

function LicenseCard({ l }: { l: DriverLicense }) {
  const [showPhoto, setShowPhoto] = useState(false);
  return (
    <div className="lic-card">
      <div className="row spread">
        <b>{l.full_name}</b>
        <LicensePill status={l.status} />
      </div>
      <dl>
        <dt>เลขที่ใบขับขี่</dt><dd className="mono">{l.license_no}</dd>
        <dt>วันหมดอายุ</dt><dd>{l.lifetime ? 'ตลอดชีพ' : `${thaiDate(l.expiry_date)} · ${statusText(l)}`}</dd>
        <dt>ส่งเมื่อ</dt><dd>{new Date(l.submitted_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
      </dl>
      {l.has_photo && (
        showPhoto
          ? <img className="lic-photo" src={licensePhotoUrl(l.id)} alt="รูปใบขับขี่" />
          : <button className="btn ghost sm" onClick={() => setShowPhoto(true)}>ดูรูปใบขับขี่</button>
      )}
    </div>
  );
}

export function LicensePage({ info, onSaved }: { info: LicenseInfo | null | undefined; onSaved: (i: LicenseInfo) => void }) {
  const [capturing, setCapturing] = useState(false);
  if (info === undefined) return <div className="empty">กำลังโหลด…</div>;
  const l = info?.license ?? null;
  return (
    <div className="two">
      <section className="panel">
        <h2>{capturing || !l ? 'ส่งรูปใบขับขี่ใบใหม่' : 'ใบขับขี่ของฉัน'}</h2>
        {capturing || !l ? (
          <LicenseCapture submitLabel="บันทึกใบขับขี่" onSaved={(i) => { setCapturing(false); onSaved(i); }}
            onCancel={l ? () => setCapturing(false) : undefined} />
        ) : (
          <>
            <LicenseCard l={l} />
            <button className="btn mt" onClick={() => setCapturing(true)}>ส่งใบขับขี่ใบใหม่</button>
          </>
        )}
      </section>
      <section className="panel">
        <h2>เกี่ยวกับการแจ้งเตือน</h2>
        <p className="note">
          ระบบจะแจ้งเตือนบนทุกหน้าเมื่อใบขับขี่เหลืออายุไม่เกิน {info?.warn_days ?? LICENSE_WARN_DAYS} วัน หรือหมดอายุแล้ว
          เมื่อต่ออายุแล้วให้ถ่ายรูปใบใหม่ส่งที่หน้านี้ ข้อมูลใบเก่าจะถูกแทนที่และรูปเก่าจะถูกลบ
        </p>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Reminder banner
 * ------------------------------------------------------------------- */

export function LicenseBanner({ info, onOpen }: { info: LicenseInfo | null | undefined; onOpen: () => void }) {
  if (!info) return null;
  const l = info.license;
  const status = l ? l.status : 'missing';
  if (status === 'ok' || status === 'lifetime') return null;
  const msg = !l ? 'คุณยังไม่ได้ส่งรูปใบขับขี่'
    : l.status === 'expired' ? `ใบขับขี่ของคุณหมดอายุแล้ว (${thaiDate(l.expiry_date)}) กรุณาต่ออายุและส่งใบใหม่`
    : `ใบขับขี่ของคุณจะหมดอายุ ${thaiDate(l.expiry_date)} (${statusText(l)})`;
  return (
    <div className={`lic-banner ${status}`} role="alert">
      <span>{msg}</span>
      <button className="btn sm" onClick={onOpen}>{l ? 'ส่งใบใหม่' : 'ส่งใบขับขี่'}</button>
    </div>
  );
}
