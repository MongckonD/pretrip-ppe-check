/**
 * Staff web page (`/`): daily work for everyone — vehicle check, PPE, Time activities.
 * Role `user` only. Admins are sent to their own page (`/admin/`, see src/admin/AdminApp.tsx).
 */
import { AppShell, type TabDef } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { ClockIcon, TruckIcon, VestIcon } from './components/Icons';
import { isTestMode, type Me } from './lib/api';
import { PpePage } from './pages/PpePage';
import { TimeActivitiesPage } from './pages/TimeActivitiesPage';
import { VehiclePage } from './pages/VehiclePage';

const STAFF_TABS: TabDef[] = [
  { key: 'veh', path: '/vehicle', label: 'ตรวจรถ', title: 'ตรวจรถก่อนออกงาน', icon: TruckIcon, render: () => <VehiclePage /> },
  { key: 'ppe', path: '/ppe', label: 'PPE', title: 'ตรวจ PPE พนักงาน', icon: VestIcon, render: () => <PpePage /> },
  { key: 'time', path: '/time-activities', label: 'Time activities', short: 'Time', title: 'Time activities', icon: ClockIcon, render: () => <TimeActivitiesPage /> },
];

function StaffShell({ me, onLogout }: { me: Me | null; onLogout?: () => void }) {
  return <AppShell me={me} onLogout={onLogout} tabs={STAFF_TABS} brandSub="Delivery Team App" />;
}

export default function App() {
  // test mode: no login, data stays in this browser
  if (isTestMode) return <StaffShell me={null} />;
  return <AuthGate area="staff">{(me, signOut) => <StaffShell me={me} onLogout={signOut} />}</AuthGate>;
}
