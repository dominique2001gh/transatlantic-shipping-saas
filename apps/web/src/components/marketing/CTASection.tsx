import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';

export function CTASection({
  eyebrow,
  title,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <section className="bg-primary-900">
      <Container className="flex flex-col items-center gap-6 py-16 text-center lg:py-20">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent-400">{eyebrow}</p>
        )}
        <h2 className="max-w-2xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {title}
        </h2>
        <p className="max-w-xl text-base leading-relaxed text-primary-100">{description}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-4">
          <LinkButton href={primaryHref} variant="inverse" size="lg">
            {primaryLabel}
          </LinkButton>
          {secondaryHref && secondaryLabel && (
            <LinkButton
              href={secondaryHref}
              variant="ghost"
              size="lg"
              className="border border-white/30 text-white hover:bg-white/10"
            >
              {secondaryLabel}
            </LinkButton>
          )}
        </div>
      </Container>
    </section>
  );
}
