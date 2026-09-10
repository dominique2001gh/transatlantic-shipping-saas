import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { ananseLogixNavLinks } from '@/lib/ananselogix/site-nav';
import { platformConfig } from '@/lib/platform-config';

export function AnanseLogixFooter() {
  return (
    <footer className="border-t border-slate-200 bg-primary-950 text-primary-200">
      <Container className="py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="font-display text-base font-semibold text-white">{platformConfig.name}</span>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-primary-300">{platformConfig.tagline}</p>
            {platformConfig.contact.supportEmail && (
              <a href={`mailto:${platformConfig.contact.supportEmail}`} className="mt-3 block text-sm text-primary-300 hover:text-white">
                {platformConfig.contact.supportEmail}
              </a>
            )}
            {platformConfig.contact.supportPhoneHref && (
              <a href={`tel:${platformConfig.contact.supportPhoneHref}`} className="mt-1 block text-sm text-primary-300 hover:text-white">
                {platformConfig.contact.supportPhone}
              </a>
            )}
          </div>

          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Footer">
            {ananseLogixNavLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-primary-200 hover:text-white">
                {link.label}
              </Link>
            ))}
            <Link href="/ananselogix/demo" className="text-primary-200 hover:text-white">
              Request a Demo
            </Link>
            <Link href="/ananselogix/login" className="text-primary-200 hover:text-white">
              Log In
            </Link>
          </nav>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-xs text-primary-400">
          &copy; {new Date().getFullYear()} {platformConfig.companyName}. All rights reserved.
        </div>
      </Container>
    </footer>
  );
}
