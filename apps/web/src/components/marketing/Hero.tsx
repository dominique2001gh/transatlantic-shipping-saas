import Image from 'next/image';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-primary-950 via-primary-900 to-primary-800 text-white">
      {/* Decorative container-stack pattern, purely visual */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
          backgroundSize: '3rem 3rem',
        }}
      />
      <Container className="relative py-20 lg:py-28">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="animate-fade-up">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent-400">
              Ocean · Air · RoRo Freight Forwarding
            </p>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              International Shipping. Simplified.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-primary-100">
              Trans Atlantic Logistics Solutions moves cargo by ocean, air, and RoRo freight,
              with warehousing and consolidation to match — for businesses and individuals
              shipping between the United States and destinations worldwide.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <LinkButton href="/quote" variant="inverse" size="lg">
                Request a Quote
              </LinkButton>
              <LinkButton
                href="/track"
                variant="ghost"
                size="lg"
                className="border border-white/30 text-white hover:bg-white/10"
              >
                Track Shipment
              </LinkButton>
            </div>
          </div>

          <div className="hidden animate-fade-in lg:block" style={{ animationDelay: '150ms' }}>
            <div className="relative aspect-[5/4] overflow-hidden rounded-2xl shadow-xl ring-1 ring-white/10">
              <Image
                src="/hero-container-ship.png"
                alt="Container ship loaded with cargo at sea"
                fill
                priority
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover object-center"
              />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
