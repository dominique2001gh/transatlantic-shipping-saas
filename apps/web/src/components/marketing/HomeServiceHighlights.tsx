import type { ComponentType } from 'react';
import Link from 'next/link';
import {
  IconArrowRight,
  IconCar,
  IconCheckCircle,
  IconClock,
  IconGlobe,
  IconHeadset,
  IconLayers,
  IconPlane,
  IconShieldCheck,
  IconShip,
  IconWarehouse,
} from '@/components/icons';
import type { IconProps } from '@/components/icons';
import { Container } from '@/components/ui/Container';

/**
 * Approved homepage redesign — the 6-card service strip + trust strip
 * that sit directly beneath the hero. Deliberately separate from the
 * canonical `services` catalog in lib/services-data.ts (still the source
 * of truth for the header dropdown, /services, and every service detail
 * page) — this is display-only copy matching the approved design's exact
 * card names, each still linking to the real existing route behind it.
 * "Cargo Consolidation" -> /services/lcl and "Vehicle Shipping" ->
 * /services/roro reuse existing service pages under a different display
 * label; "Global Reach" has no dedicated service page, so it links to
 * /about instead of inventing a new route.
 */
interface HighlightCard {
  name: string;
  description: string;
  href: string;
  icon: ComponentType<IconProps>;
}

const highlightCards: HighlightCard[] = [
  {
    name: 'Ocean Freight',
    description: 'LCL and FCL ocean freight for cargo of every size, from single pallets to full containers.',
    href: '/services/ocean-freight',
    icon: IconShip,
  },
  {
    name: 'Air Freight',
    description: 'Faster transit for time-sensitive cargo and smaller high-priority shipments.',
    href: '/services/air-freight',
    icon: IconPlane,
  },
  {
    name: 'Cargo Consolidation',
    description: 'Ship only the space you need — your cargo consolidated with others heading the same way.',
    href: '/services/lcl',
    icon: IconLayers,
  },
  {
    name: 'Vehicle Shipping',
    description: 'Roll-on/roll-off shipping for cars, trucks, and other wheeled vehicles.',
    href: '/services/roro',
    icon: IconCar,
  },
  {
    name: 'Warehousing',
    description: 'Receiving, storage, and consolidation to keep your cargo moving on schedule.',
    href: '/services/warehousing',
    icon: IconWarehouse,
  },
  {
    name: 'Global Reach',
    description: 'A freight network connecting the United States with Ghana and destinations worldwide.',
    href: '/about',
    icon: IconGlobe,
  },
];

interface TrustItem {
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
}

const trustItems: TrustItem[] = [
  {
    title: 'Trusted & Reliable',
    description: 'A freight partner businesses and individuals count on, shipment after shipment.',
    icon: IconShieldCheck,
  },
  {
    title: 'Customer Focused',
    description: 'A team that stays involved from booking through final delivery.',
    icon: IconHeadset,
  },
  {
    title: 'On-Time Delivery',
    description: 'Shipments handled on schedule, with visibility at every step.',
    icon: IconClock,
  },
  {
    title: 'Competitive Rates',
    description: 'Freight pricing built to keep your shipping costs predictable.',
    icon: IconCheckCircle,
  },
];

export function HomeServiceHighlights() {
  return (
    <div className="relative">
      {/* Overlapping card row — pulled up over the hero's bottom edge.
          Forced to exactly one row of 6 at desktop (lg:grid-cols-6); wraps
          responsively below that. */}
      <div className="relative z-10 -mt-12 sm:-mt-16 lg:-mt-20">
        <Container>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-3">
            {highlightCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.name}
                  href={card.href}
                  className="group flex h-full flex-col rounded-xl border border-slate-100 bg-white p-3.5 shadow-xl transition-all hover:-translate-y-1 hover:shadow-2xl lg:p-4"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700 transition-colors group-hover:bg-primary-700 group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-3 font-display text-sm font-semibold leading-snug text-slate-900">{card.name}</h3>
                  <p className="mt-1.5 flex-1 text-xs leading-relaxed text-slate-600">{card.description}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-700">
                    Learn More
                    <IconArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              );
            })}
          </div>
        </Container>
      </div>

      {/* Trust strip */}
      <Container className="pb-20 pt-16 lg:pb-24 lg:pt-20">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {trustItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                  <Icon className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Container>
    </div>
  );
}
