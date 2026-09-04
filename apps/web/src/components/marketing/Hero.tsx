import Image from 'next/image';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';

// Minimal text-shadow, not a background panel — just enough to keep the
// overlay copy readable against a bright, varied photograph. Tailwind 3
// has no text-shadow utility, hence the inline style; kept deliberately
// subtle per the approved direction (no large dark gradient over the photo).
const TEXT_SHADOW = { textShadow: '0 1px 3px rgba(0,0,0,0.45), 0 2px 10px rgba(0,0,0,0.35)' };

/**
 * Approved homepage redesign — full-bleed photographic hero.
 * /hero-container-ship.png is the real photo supplied for this
 * composition; it stays fully bright and visible across the whole hero,
 * including behind the headline — no dark gradient/panel over the photo,
 * per the approved direction. Legibility comes from the text-shadow
 * above instead.
 */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-primary-950 text-white">
      <div className="absolute inset-0">
        <Image
          src="/hero-container-ship.png"
          alt="Container ship loaded with cargo at sea, representing Trans Atlantic's international freight network"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
      </div>

      <Container className="relative py-20 lg:py-28">
        <div className="max-w-xl animate-fade-up">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent-400" style={TEXT_SHADOW}>
            Ocean · Air · RoRo Freight Forwarding
          </p>
          <h1
            className="mt-5 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl"
            style={TEXT_SHADOW}
          >
            <span className="block">Connecting Continents.</span>
            <span className="block text-accent-400">Delivering Possibilities.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-white" style={TEXT_SHADOW}>
            Your trusted partner for shipping to Ghana and beyond. Fast. Secure. Affordable.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <LinkButton href="/quote" variant="inverse" size="lg">
              Get a Quote
            </LinkButton>
            <LinkButton
              href="/track"
              variant="ghost"
              size="lg"
              className="border border-white/60 text-white hover:bg-white/10"
              style={TEXT_SHADOW}
            >
              Track Your Shipment
            </LinkButton>
          </div>
        </div>
      </Container>
    </section>
  );
}
