import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
 */
const STAFF_HOSTNAME = 'app.talogisticssolutions.com';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';

  if (host === STAFF_HOSTNAME && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/',
};
