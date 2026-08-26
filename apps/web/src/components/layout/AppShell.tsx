import type { ReactNode } from 'react';
import type { NavItem } from '@/lib/nav';
import { AppSidebar } from './AppSidebar';
import { AppTopbar } from './AppTopbar';

export function AppShell({
  children,
  items,
  sidebarTitle,
  sidebarEyebrow,
  tenantLabel,
  userLabel,
}: {
  children: ReactNode;
  items: NavItem[];
  sidebarTitle: string;
  sidebarEyebrow: string;
  tenantLabel: string;
  userLabel: string;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <AppSidebar items={items} title={sidebarTitle} eyebrow={sidebarEyebrow} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar items={items} tenantLabel={tenantLabel} userLabel={userLabel} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
