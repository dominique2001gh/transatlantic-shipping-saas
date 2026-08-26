import type { ReactNode } from 'react';

const VARIANT_CLASSES = {
  neutral: 'bg-slate-100 text-slate-700',
  primary: 'bg-primary-100 text-primary-800',
  accent: 'bg-accent-500/10 text-accent-600',
  warning: 'bg-amber-100 text-amber-800',
  success: 'bg-emerald-100 text-emerald-800',
} as const;

export function Badge({
  children,
  variant = 'neutral',
}: {
  children: ReactNode;
  variant?: keyof typeof VARIANT_CLASSES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  );
}
