/**
 * Every hostname that serves Trans Atlantic's own production site: the
 * apex, www, and the staff-app subdomain. AnanseLogix's marketing/signup/
 * central-login/platform-admin pages (/ananselogix/*) must never resolve,
 * be advertised in sitemap.xml, or be crawlable on any of these — see
 * middleware.ts's own doc comment for the full reasoning (this is the
 * interim safeguard while AnanseLogix still shares this deployment;
 * extracting it into its own app/service is the real long-term fix).
 *
 * Suffix-matched (endsWith) rather than an exact list so any future
 * *.talogisticssolutions.com subdomain is covered automatically without
 * a code change. Deliberately does NOT match this deployment's raw
 * Railway-assigned hostname — that address isn't publicly linked/branded
 * as anything and is a reasonable place to reach /ananselogix before a
 * dedicated domain exists.
 *
 * Shared by middleware.ts (Edge runtime) and sitemap.ts/robots.ts (via
 * next/headers) so "block the page" and "don't advertise the URL" can
 * never drift apart into two different definitions of the same rule.
 */
const TRANS_ATLANTIC_HOSTNAME_SUFFIX = 'talogisticssolutions.com';

export function isTransAtlanticHostname(host: string | null | undefined): boolean {
  if (!host) return false;
  const bareHost = host.split(':')[0].toLowerCase();
  return bareHost === TRANS_ATLANTIC_HOSTNAME_SUFFIX || bareHost.endsWith(`.${TRANS_ATLANTIC_HOSTNAME_SUFFIX}`);
}
