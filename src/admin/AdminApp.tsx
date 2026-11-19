/**
 * Admin web page (`/admin/`): หน้าหลัก, สถานะรถ, PPE, สรุป, ภาพรวม, ข้อมูล, ใบขับขี่, ตั้งค่า.
 * Role `admin` only. The Worker only serves this page to signed-in admins; AuthGate double-checks in the browser.
 */
import { AppShell, type TabDef } from '../components/AppShell';
import { AuthGate } from '../components/AuthGate';
import { ChartIcon, GearIcon, HomeIcon, IdCardIcon, ReportIcon, TableIcon, TruckIcon, VestIcon } from '../components/Icons';
import { isTestMode, type Me } from '../lib/api';
import { DashboardPage } from '../pages/DashboardPage';
import { DataPage } from '../pages/DataPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AdminHomePage } from './AdminHomePage';
import { LicensesPage } from './LicensesPanel';
import { SummaryPage } from './SummaryPage';
import { VehicleStatusPage } from './VehicleStatusPage';
import { PpeReportPage } from './PpeReportPage';

const ADMIN_TABS: TabDef[] = [
  { key: 'home', path: '/admin/home', label: 'หน้าหลัก', title: 'หน้าหลัก', icon: HomeIcon, render: (c) => <AdminHomePage go={c.go} /> },
  { key: 'vs', path: '/admin/vehicle-status', label: 'สถานะรถ', short: 'สถานะ', title: 'สถานะรถ / อนุมัติการตรวจรถ', icon: TruckIcon, render: () => <VehicleStatusPage /> },
  { key: 'ppe', path: '/admin/ppe', label: 'PPE', title: 'ผลการตรวจ PPE', icon: VestIcon, render: () => <PpeReportPage /> },
  { key: 'sum', path: '/admin/summary', label: 'สรุป', title: 'สรุปผลการทำงาน', icon: ReportIcon, render: () => <SummaryPage /> },
  { key: 'dash', path: '/admin/overview', label: 'ภาพรวม', title: 'ภาพรวมประจำเดือน', icon: ChartIcon, render: (c) => <DashboardPage month={c.month} setMonth={c.setMonth} go={c.go} /> },
  { key: 'data', path: '/admin/data', label: 'ข้อมูล', title: 'ข้อมูลการตรวจ', icon: TableIcon, render: (c) => <DataPage month={c.month} setMonth={c.setMonth} /> },
  { key: 'lic', path: '/admin/licenses', label: 'ใบขับขี่', title: 'ใบขับขี่พนักงาน', icon: IdCardIcon, render: () => <LicensesPage /> },
  { key: 'cfg', path: '/admin/settings', label: 'ตั้งค่า', title: 'ตั้งค่าระบบ', icon: GearIcon, render: () => <SettingsPage /> },
];

function AdminShell({ me, onLogout }: { me: Me | null; onLogout?: () => void }) {
  return <AppShell me={me} onLogout={onLogout} tabs={ADMIN_TABS} brandSub="ผู้ดูแลระบบ" />;
}

export default function AdminApp() {
  if (isTestMode) return <AdminShell me={null} />;
  return <AuthGate area="admin">{(me, signOut) => <AdminShell me={me} onLogout={signOut} />}</AuthGate>;
}
