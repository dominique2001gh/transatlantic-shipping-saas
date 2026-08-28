'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/nav';

export function AppSidebar({
  items,
  title,
  eyebrow,
}: {
  items: NavItem[];
  title: string;
  eyebrow: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-primary-950 text-white lg:flex lg:flex-col print:hidden">
      <div className="px-6 py-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-300">
          {eyebrow}
        </p>
        <p className="mt-1 text-lg font-semibold">{title}</p>
      </div>
      <nav className="flex-1 space-y-1 px-3 pb-6">
        {items.map((item) => {
          const isActive =
            item.href === pathname || (item.href !== '/dashboard' && item.href !== '/portal' && item.href !== '/platform' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-800 text-white'
                  : 'text-primary-100 hover:bg-primary-900 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
