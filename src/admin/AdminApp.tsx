/**
 * Admin web page (`/admin/`): หน้าหลัก, ภาพรวม, ข้อมูล, ตั้งค่า.
 * Role `admin` only. The Worker only serves this page to signed-in admins; AuthGate double-checks in the browser.
 */
import { AppShell, type TabDef } from '../components/AppShell';
import { AuthGate } from '../components/AuthGate';
import { ChartIcon, GearIcon, HomeIcon, TableIcon } from '../components/Icons';
import { isTestMode, type Me } from '../lib/api';
import { DashboardPage } from '../pages/DashboardPage';
import { DataPage } from '../pages/DataPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AdminHomePage } from './AdminHomePage';

const ADMIN_TABS: TabDef[] = [
  { key: 'home', path: '/admin/home', label: 'หน้าหลัก', title: 'หน้าหลัก', icon: HomeIcon, render: (c) => <AdminHomePage go={c.go} /> },
  { key: 'dash', path: '/admin/overview', label: 'ภาพรวม', title: 'ภาพรวมประจำเดือน', icon: ChartIcon, render: (c) => <DashboardPage month={c.month} setMonth={c.setMonth} /> },
  { key: 'data', path: '/admin/data', label: 'ข้อมูล', title: 'ข้อมูลการตรวจ', icon: TableIcon, render: (c) => <DataPage month={c.month} setMonth={c.setMonth} /> },
  { key: 'cfg', path: '/admin/settings', label: 'ตั้งค่า', title: 'ตั้งค่าระบบ', icon: GearIcon, render: () => <SettingsPage /> },
];

function AdminShell({ me, onLogout }: { me: Me | null; onLogout?: () => void }) {
  return <AppShell me={me} onLogout={onLogout} tabs={ADMIN_TABS} brandSub="ผู้ดูแลระบบ" />;
}

export default function AdminApp() {
  if (isTestMode) return <AdminShell me={null} />;
  return <AuthGate area="admin">{(me, signOut) => <AdminShell me={me} onLogout={signOut} />}</AuthGate>;
}
