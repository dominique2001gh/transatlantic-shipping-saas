import type { Metadata } from 'next';
import { PageHero } from '@/components/marketing/PageHero';
import { Container } from '@/components/ui/Container';

export const metadata: Metadata = {
  title: 'Photo Credits',
  description: 'Attribution for openly-licensed photography used on this site.',
};

interface PhotoCredit {
  page: string;
  title: string;
  author: string;
  source: string;
  sourceHref: string;
  license: string;
  licenseHref: string;
}

/**
 * Two of the site's photos are CC BY-SA (attribution required); the rest
 * are CC0 (no attribution required, but credited here anyway for
 * transparency). See MEMORY / launch notes: Website Completion photo pass.
 */
const credits: PhotoCredit[] = [
  {
    page: 'Homepage — "Track your shipment"',
    title: 'Modern warehouse with pallet rack storage system',
    author: 'Axisadman',
    source: 'Wikimedia Commons',
    sourceHref:
      'https://commons.wikimedia.org/wiki/File:Modern_warehouse_with_pallet_rack_storage_system.jpg',
    license: 'CC BY-SA 3.0',
    licenseHref: 'https://creativecommons.org/licenses/by-sa/3.0/',
  },
  {
    page: 'About — "What we do"',
    title: "Aerial view of Manila Port's International Container terminal",
    author: 'Patrick Roque',
    source: 'Wikimedia Commons',
    sourceHref:
      'https://commons.wikimedia.org/wiki/File:Aerial_view_of_Manila_Port%27s_International_Container_terminal.jpg',
    license: 'CC BY-SA 3.0',
    licenseHref: 'https://creativecommons.org/licenses/by-sa/3.0/',
  },
  {
    page: 'Ocean Freight service page',
    title: 'Quay cranes, port',
    author: 'rawpixel',
    source: 'rawpixel.com',
    sourceHref: 'https://www.rawpixel.com/',
    license: 'CC0 1.0 (public domain)',
    licenseHref: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  {
    page: 'LCL Shipping service page',
    title: 'Forklift operator shuttles palletized cargo',
    author: 'rawpixel',
    source: 'rawpixel.com',
    sourceHref: 'https://www.rawpixel.com/',
    license: 'CC0 1.0 (public domain)',
    licenseHref: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  {
    page: 'Warehousing service page',
    title: 'Forklift operator managing wrapped pallets',
    author: 'rawpixel',
    source: 'rawpixel.com',
    sourceHref: 'https://www.rawpixel.com/',
    license: 'CC0 1.0 (public domain)',
    licenseHref: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
];

export default function CreditsPage() {
  return (
    <>
      <PageHero
        kicker="Attribution"
        title="Photo credits"
        description="Photography on this site is sourced from openly-licensed collections. Credit for each image is listed below."
      />
      <section className="py-16 lg:py-20">
        <Container className="max-w-3xl">
          <ul className="flex flex-col divide-y divide-slate-200">
            {credits.map((credit) => (
              <li key={credit.title} className="py-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">
                  {credit.page}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">
                  &ldquo;{credit.title}&rdquo; by {credit.author}, via{' '}
                  <a
                    href={credit.sourceHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary-700 underline hover:text-primary-800"
                  >
                    {credit.source}
                  </a>
                  , licensed under{' '}
                  <a
                    href={credit.licenseHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary-700 underline hover:text-primary-800"
                  >
                    {credit.license}
                  </a>
                  .
                </p>
              </li>
            ))}
          </ul>
        </Container>
      </section>
    </>
  );
}
