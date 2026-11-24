/**
 * Staff web page (`/`): daily work for everyone — vehicle check, PPE, Time activities, driver licence.
 * Role `user` only. Admins are sent to their own page (`/admin/`, see src/admin/AdminApp.tsx).
 *
 * After login a staff member goes through:
 *   1. personal-data consent (until the current version is accepted)
 *   2. driver-licence photo (camera only; OCR fills the fields) — shown after every sign-in until a licence is on file;
 *      "ข้ามไปหน้าหลัก" (allowed while LICENSE_REQUIRED is false) lasts until that account signs out
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell, type TabDef } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { TabBadge, useMyCheckBadge } from './components/CheckStatus';
import { ConsentScreen } from './components/Consent';
import { ClockIcon, IdCardIcon, StoreIcon, TimerIcon, TruckIcon, VestIcon } from './components/Icons';
import { getMyLicense, isTestMode, type Me } from './lib/api';
import { FEATURES } from './lib/features';
import { LICENSE_REQUIRED, readLicenseSkip, writeLicenseSkip, type LicenseInfo } from './lib/license';
import { errMsg } from './lib/utils';
import { LicenseBanner, LicenseOnboarding, LicensePage } from './pages/LicensePage';
import { PpePage } from './pages/PpePage';
import { TimeActivitiesPage } from './pages/TimeActivitiesPage';
import { VehiclePage } from './pages/VehiclePage';

// ร้านค้าที่ต้องส่ง (feature switch storeDelivery): loaded only when its tab opens, so version 1 never loads it
const DeliveryList = lazy(() => import('./components/DeliveryList').then((m) => ({ default: m.DeliveryList })));

const WORK_TABS: TabDef[] = [
  { key: 'veh', path: '/vehicle', label: 'ตรวจรถ', title: 'ตรวจรถก่อนออกงาน', icon: TruckIcon, render: (c) => <VehiclePage goPpe={() => c.go('ppe')} /> },
  { key: 'ppe', path: '/ppe', label: 'PPE', title: 'ตรวจ PPE พนักงาน', icon: VestIcon, render: (c) => <PpePage goVehicle={() => c.go('veh')} goTime={() => c.go('time')} /> },
  // menu heading only: opens its first sub-tab
  { key: 'time', path: '/time-activities', label: 'Time activities', short: 'Time', title: 'Time activities', icon: ClockIcon, render: () => null },
  { key: 'time-work', parent: 'time', path: '/time-activities/work', label: 'บันทึกเวลาการทำงาน', title: 'บันทึกเวลาการทำงาน', icon: TimerIcon,
    render: (c) => <TimeActivitiesPage sub="work" goVehicle={() => c.go('veh')} /> },
  // stores today's vehicle must deliver to (admin imports the plan from SAP) — only when the storeDelivery switch is on
  // (hidden in version 1). The store-visit timer (TimeActivitiesPage sub="store") stays hidden for now.
  ...(FEATURES.storeDelivery ? [
    { key: 'time-store', parent: 'time', path: '/time-activities/stores', label: 'ร้านค้าที่ต้องส่ง', title: 'ร้านค้าที่ต้องส่ง', icon: StoreIcon,
      render: (c) => <Suspense fallback={<div className="empty">กำลังโหลด…</div>}><DeliveryList goVehicle={() => c.go('veh')} goWork={() => c.go('time-work')} /></Suspense> },
  ] satisfies TabDef[] : []),
];

function StaffShell({ me, onLogout, onboarding }: { me: Me | null; onLogout?: () => void; onboarding: boolean }) {
  const [lic, setLic] = useState<LicenseInfo | null | undefined>(undefined);
  // "ข้ามไปหน้าหลัก" counts for this account until it signs out (see lib/license.ts)
  const [skipped, setSkipped] = useState(() => !LICENSE_REQUIRED && readLicenseSkip(me?.id));
  const [loadError, setLoadError] = useState('');
  const loadLicense = useCallback(() => {
    setLoadError('');
    getMyLicense().then(setLic).catch((e) => { setLic(null); setLoadError(errMsg(e)); });
  }, []);
  useEffect(() => { loadLicense(); }, [loadLicense]);

  // approval status of my team's vehicle check today, next to the "ตรวจรถ" tab
  const checkBadge = useMyCheckBadge(me);
  const tabs = useMemo<TabDef[]>(() => [
    ...WORK_TABS.map((t) => (t.key === 'veh' && checkBadge ? { ...t, badge: <TabBadge b={checkBadge} /> } : t)),
    { key: 'license', path: '/license', label: 'ใบขับขี่', title: 'ใบขับขี่', icon: IdCardIcon, render: () => <LicensePage info={lic} onSaved={setLic} /> },
  ], [lic, checkBadge]);

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
      const skip = LICENSE_REQUIRED ? undefined : () => { writeLicenseSkip(me?.id); setSkipped(true); };
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
