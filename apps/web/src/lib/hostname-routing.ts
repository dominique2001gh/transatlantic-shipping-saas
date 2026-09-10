import { isAnanseLogixHostname, isAnanseLogixWwwHostname } from './ananselogix-hostname';
import { isTransAtlanticHostname } from './trans-atlantic-hostname';

/**
 * AnanseLogix hostname routing (Step 2): the middleware's actual routing
 * *decision*, factored out as a plain function of (host, pathname) with
 * no dependency on next/server — so it can be unit-tested directly
 * (see hostname-routing.test.ts) without needing a Next.js edge runtime,
 * a running dev server, or any mocking of NextRequest/NextResponse.
 * middleware.ts itself stays a thin adapter: call this, then translate
 * the result into the real Next.js response type.
 */
export type HostnameRoutingAction =
  | { type: 'redirectToAnanseLogixApex' }
  | { type: 'rewrite'; pathname: string }
  | { type: 'notFound' }
  | { type: 'next' };

const STAFF_HOSTNAME = 'app.talogisticssolutions.com';

export function resolveHostnameRouting(host: string | null | undefined, pathname: string): HostnameRoutingAction {
  if (isAnanseLogixWwwHostname(host)) {
    return { type: 'redirectToAnanseLogixApex' };
  }

  if (isAnanseLogixHostname(host) && !pathname.startsWith('/ananselogix')) {
    return { type: 'rewrite', pathname: pathname === '/' ? '/ananselogix' : `/ananselogix${pathname}` };
  }

  if (isTransAtlanticHostname(host) && pathname.startsWith('/ananselogix')) {
    return { type: 'notFound' };
  }

  if (host === STAFF_HOSTNAME && pathname === '/') {
    return { type: 'rewrite', pathname: '/dashboard' };
  }

  return { type: 'next' };
}
