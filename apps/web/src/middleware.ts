import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveHostnameRouting } from '@/lib/hostname-routing';

/**
 * Website Launch Step 9 prep: this single Next.js deployment serves every
 * surface (public site, staff dashboard, customer portal, platform admin)
 * by *path* — /dashboard, /portal, /platform. The approved production
 * domain architecture instead wants Trans Atlantic's staff console to
 * live at its own hostname, app.talogisticssolutions.com, with the bare
 * domain reserved for the public site + customer portal/login. Rather
 * than restructure the app into separate deployments (a real redesign,
 * out of scope here), this middleware makes the *root* of the staff
 * hostname resolve to /dashboard — visiting https://app.talogisticssolutions.com/
 * lands staff exactly where "staff operational software" implies, while
 * every other path (including /platform, deep dashboard links, and the
 * public site itself) is untouched and reachable from any hostname
 * exactly as it is today. Auth guards, not this middleware, are what
 * actually gate access to /dashboard and /platform — this is a routing
 * convenience only, never a security boundary.
 *
 * Deliberately hostname-based (via the request's own Host header, which
 * Railway/any proxy passes through unchanged), not env-var based, so
 * local dev (localhost) and the temporary Railway domains are completely
 * unaffected — this only ever activates for a request that actually
 * arrives on app.talogisticssolutions.com, which won't happen until DNS
 * cutover.
 *
 * AnanseLogix hostname routing (Step 2): this same deployment also hosts
 * AnanseLogix's own marketing/signup/central-login pages at
 * /ananselogix/* (see AnanseLogixLayout's own doc comment on why — no
 * separate domain/service is deployed yet, though a dedicated Railway
 * service is the intended eventual home). Those must never be reachable
 * on any Trans Atlantic hostname (unchanged 404 rule below), and — new —
 * on AnanseLogix's own hostname they must appear at the site root rather
 * than under /ananselogix, without duplicating a single page: any request
 * to ananselogix.com whose path doesn't already start with /ananselogix
 * is rewritten (browser URL unchanged) to the /ananselogix-prefixed
 * equivalent. `/` becomes `/ananselogix`, `/features` becomes
 * `/ananselogix/features`, `/signup/success` becomes
 * `/ananselogix/signup/success`, and so on for every path this matcher
 * lists — extend the matcher, not this logic, whenever a new AnanseLogix
 * page is added.
 *
 * Canonical host: the bare apex (ananselogix.com), matching this app's
 * existing convention for Trans Atlantic (see main.ts's own www ->
 * apex redirect). www.ananselogix.com 301s to the apex, preserving the
 * exact path/query, before any rewrite logic below ever runs — so
 * everything past that point only ever has to reason about one hostname
 * for this brand, same as isTransAtlanticHostname's own suffix-matched
 * list only ever needing to reason about one brand at a time.
 *
 * The actual routing decision is a plain function of (host, pathname) —
 * see lib/hostname-routing.ts's own doc comment for why that's factored
 * out separately (unit-testable without a Next.js runtime). This
 * function is just the thin adapter translating that decision into a
 * real NextResponse.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const { pathname } = request.nextUrl;

  const action = resolveHostnameRouting(host, pathname);

  switch (action.type) {
    case 'redirectToAnanseLogixApex': {
      const url = request.nextUrl.clone();
      url.protocol = 'https:';
      url.hostname = 'ananselogix.com';
      url.port = '';
      return NextResponse.redirect(url, 301);
    }
    case 'rewrite': {
      const url = request.nextUrl.clone();
      url.pathname = action.pathname;
      return NextResponse.rewrite(url);
    }
    case 'notFound':
      return new NextResponse(null, { status: 404 });
    case 'next':
      return NextResponse.next();
  }
}

export const config = {
  matcher: [
    '/',
    '/ananselogix/:path*',
    '/features',
    '/how-it-works',
    '/pricing',
    '/solutions',
    '/demo',
    '/login',
    '/signup/:path*',
  ],
};
