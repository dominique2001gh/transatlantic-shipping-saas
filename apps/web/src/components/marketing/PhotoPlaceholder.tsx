import type { ComponentType } from 'react';
import type { IconProps } from '@/components/icons';

const TONE_CLASSES = {
  navy: 'from-primary-900 via-primary-800 to-primary-700 text-primary-100',
  teal: 'from-accent-600 via-accent-500 to-accent-400 text-white',
  slate: 'from-slate-800 via-slate-700 to-slate-600 text-slate-100',
} as const;

/**
 * Stands in for real photography we don't have yet. Deliberately looks
 * like an intentional design choice (gradient + icon + labeled caption)
 * rather than a broken image, so the site reads as finished while making
 * it obvious exactly which photo needs to be supplied later.
 */
export function PhotoPlaceholder({
  icon: Icon,
  label,
  tone = 'navy',
  className = '',
  aspect = 'aspect-[4/3]',
}: {
  icon: ComponentType<IconProps>;
  label: string;
  tone?: keyof typeof TONE_CLASSES;
  className?: string;
  aspect?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br shadow-xl ${TONE_CLASSES[tone]} ${aspect} ${className}`}
      role="img"
      aria-label={`Photography placeholder: ${label}`}
    >
      <div
        className="absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon className="h-16 w-16 opacity-40 sm:h-20 sm:w-20" strokeWidth={1.25} />
      </div>
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 rounded-lg bg-black/25 px-3 py-1.5 backdrop-blur-sm">
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-white/90">
          Photography needed: {label}
        </span>
      </div>
    </div>
  );
}
