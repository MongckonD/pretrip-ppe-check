/**
 * Staff web page (`/`): daily work for everyone — vehicle check, PPE, Time activities, driver licence.
 * Role `user` only. Admins are sent to their own page (`/admin/`, see src/admin/AdminApp.tsx).
 *
 * After login a staff member goes through:
 *   1. personal-data consent (until the current version is accepted)
 *   2. driver-licence photo (camera only; OCR fills the fields) — "ข้ามไปหน้าหลัก" allowed while LICENSE_REQUIRED is false
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell, type TabDef } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { ConsentScreen } from './components/Consent';
import { ClockIcon, IdCardIcon, TruckIcon, VestIcon } from './components/Icons';
import { getMyLicense, isTestMode, type Me } from './lib/api';
import { LICENSE_REQUIRED, type LicenseInfo } from './lib/license';
import { errMsg } from './lib/utils';
import { LicenseBanner, LicenseOnboarding, LicensePage } from './pages/LicensePage';
import { PpePage } from './pages/PpePage';
import { TimeActivitiesPage } from './pages/TimeActivitiesPage';
import { VehiclePage } from './pages/VehiclePage';

const WORK_TABS: TabDef[] = [
  { key: 'veh', path: '/vehicle', label: 'ตรวจรถ', title: 'ตรวจรถก่อนออกงาน', icon: TruckIcon, render: (c) => <VehiclePage goPpe={() => c.go('ppe')} /> },
  { key: 'ppe', path: '/ppe', label: 'PPE', title: 'ตรวจ PPE พนักงาน', icon: VestIcon, render: (c) => <PpePage goVehicle={() => c.go('veh')} /> },
  { key: 'time', path: '/time-activities', label: 'Time activities', short: 'Time', title: 'Time activities', icon: ClockIcon, render: (c) => <TimeActivitiesPage goVehicle={() => c.go('veh')} /> },
];

/** "ข้ามไปหน้าหลัก" is remembered until the browser tab is closed (asked again on the next visit). */
const SKIP_KEY = 'license-skipped';
const readSkip = () => { try { return sessionStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } };

function StaffShell({ me, onLogout, onboarding }: { me: Me | null; onLogout?: () => void; onboarding: boolean }) {
  const [lic, setLic] = useState<LicenseInfo | null | undefined>(undefined);
  const [skipped, setSkipped] = useState(() => !LICENSE_REQUIRED && readSkip());
  const [loadError, setLoadError] = useState('');
  const loadLicense = useCallback(() => {
    setLoadError('');
    getMyLicense().then(setLic).catch((e) => { setLic(null); setLoadError(errMsg(e)); });
  }, []);
  useEffect(() => { loadLicense(); }, [loadLicense]);

  const tabs = useMemo<TabDef[]>(() => [
    ...WORK_TABS,
    { key: 'license', path: '/license', label: 'ใบขับขี่', title: 'ใบขับขี่', icon: IdCardIcon, render: () => <LicensePage info={lic} onSaved={setLic} /> },
  ], [lic]);

  // staff must have a licence on file before entering (the Worker enforces this too)
  if (onboarding) {
    if (lic === undefined) return <div className="center-screen note">กำลังโหลด…</div>;
    if (loadError) {
      return (
        <div className="center-screen">
          <div className="panel login">
            <b>โหลดข้อมูลใบขับขี่ไม่สำเร็จ</b>
            <div className="note">{loadError}</div>
            <button className="btn" onClick={loadLicense}>ลองใหม่</button>
          </div>
        </div>
      );
    }
    if (!lic?.license && !skipped) {
      const skip = LICENSE_REQUIRED ? undefined : () => {
        try { sessionStorage.setItem(SKIP_KEY, '1'); } catch { /* storage unavailable */ }
        setSkipped(true);
      };
      return <LicenseOnboarding onSaved={setLic} onLogout={() => onLogout?.()} onSkip={skip} />;
    }
  }
  return (
    <AppShell me={me} onLogout={onLogout} tabs={tabs} brandSub="Delivery Team App"
      banner={(go, cur) => (cur === 'license' ? null : <LicenseBanner info={lic} onOpen={() => go('license')} />)} />
  );
}

function StaffArea({ me, signOut }: { me: Me; signOut: () => void }) {
  const [consented, setConsented] = useState(me.consented);
  if (!consented) return <ConsentScreen onAccepted={() => setConsented(true)} onLogout={signOut} />;
  return <StaffShell me={me} onLogout={signOut} onboarding />;
}

export default function App() {
  // test mode: no login, data stays in this browser
  if (isTestMode) return <StaffShell me={null} onboarding={false} />;
  return <AuthGate area="staff">{(me, signOut) => <StaffArea me={me} signOut={signOut} />}</AuthGate>;
}
