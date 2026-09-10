/**
 * AnanseLogix's own production hostname — kept separate from
 * trans-atlantic-hostname.ts's suffix-matched list on purpose: that file
 * exists to *exclude* /ananselogix/* from every Trans Atlantic-branded
 * hostname; this one exists to *include* it (rewritten to the site root)
 * for AnanseLogix's own domain. The two must never be merged into one
 * "is this a marketing domain" concept, since a request can only ever be
 * on one brand's hostname, never both.
 *
 * `www.ananselogix.com` is intentionally excluded from this check — see
 * middleware.ts, which redirects it to the bare apex (canonical host)
 * before this function would ever need to answer for it.
 */
const ANANSELOGIX_HOSTNAME = 'ananselogix.com';
const ANANSELOGIX_WWW_HOSTNAME = 'www.ananselogix.com';

export function isAnanseLogixHostname(host: string | null | undefined): boolean {
  if (!host) return false;
  const bareHost = host.split(':')[0].toLowerCase();
  return bareHost === ANANSELOGIX_HOSTNAME;
}

export function isAnanseLogixWwwHostname(host: string | null | undefined): boolean {
  if (!host) return false;
  const bareHost = host.split(':')[0].toLowerCase();
  return bareHost === ANANSELOGIX_WWW_HOSTNAME;
}
