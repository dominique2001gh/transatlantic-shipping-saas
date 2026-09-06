/**
 * AnanseLogix Phase 1: turns a prospect-supplied company name into a
 * URL/subdomain-safe slug candidate for the new Tenant.slug column.
 * Lowercase, ASCII letters/digits/hyphens only, no leading/trailing or
 * repeated hyphens — the same shape CreateTenantDto.slug already validates
 * for the platform-admin-only tenant creation path (see its `@Matches`
 * decorator), so a self-service-generated slug can never violate a
 * constraint the manual path doesn't also enforce.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (e.g. "é" -> "e")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
