import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary-700 text-white hover:bg-primary-800 focus-visible:outline-primary-700',
  secondary:
    'bg-white text-primary-800 border border-primary-200 hover:bg-primary-50 focus-visible:outline-primary-700',
  ghost: 'text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-400',
  // For use on dark backgrounds (hero sections, footer CTAs).
  inverse: 'bg-white text-primary-900 hover:bg-primary-50 focus-visible:outline-white',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-2 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3.5 text-base',
};

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return `inline-flex items-center justify-center gap-2 rounded-lg font-semibold shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClasses({ variant, size, className })} {...props} />;
}

/** Same visual language as Button, but renders a Next.js Link for navigation CTAs. */
export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link href={href} className={buttonClasses({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
