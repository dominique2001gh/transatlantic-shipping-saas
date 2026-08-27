import type { ReactNode } from 'react';
import { Container } from '@/components/ui/Container';

/** Compact hero used on interior pages (services, about, contact, etc.). */
export function PageHero({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="bg-gradient-to-b from-primary-950 via-primary-900 to-primary-800 text-white">
      <Container className="py-16 lg:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent-400">{kicker}</p>
        <h1 className="mt-4 max-w-3xl font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
          {title}
        </h1>
        {description && (
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-primary-100">{description}</p>
        )}
        {children}
      </Container>
    </section>
  );
}
