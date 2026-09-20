import { resolveTenantPublicSiteUrl, resolveTenantWebAppUrl, type ConfigLike, type TenantForWebAppUrl } from '../src/common/tenant/tenant-web-app-url.util';

jest.setTimeout(30_000);

/**
 * Multi-tenant branding/routing fix (2026-09) — covers exactly the pure
 * resolveTenantWebAppUrl function, the same "no real HTTP call, no Nest
 * app, no database" scope resend-email-header.e2e-spec.ts and
 * platform-email-sender.e2e-spec.ts already establish for their own pure
 * functions. Named .e2e-spec.ts only because that's this suite's only
 * Jest entry point (testRegex in jest-e2e.json).
 */
describe('resolveTenantWebAppUrl — tenant-facing links never default to a specific tenant\'s own domain (e2e)', () => {
  function fakeConfig(values: Record<string, string>): ConfigLike {
    return {
      get: <T = string>(key: string, defaultValue?: T): T | undefined =>
        (key in values ? (values[key] as unknown as T) : defaultValue),
    };
  }

  const tatanicLike: TenantForWebAppUrl = { slug: 'tatanic', customDomain: null };
  const transAtlantic: TenantForWebAppUrl = { slug: 'transatlantic', customDomain: null };

  it('1. a tenant with no customDomain and not the legacy slug uses ANANSELOGIX_BASE_URL — the reported bug: Tatanic must never resolve to a different tenant\'s domain', () => {
    const url = resolveTenantWebAppUrl(tatanicLike, fakeConfig({ ANANSELOGIX_BASE_URL: 'https://ananselogix.com', WEB_APP_URL: 'https://app.talogisticssolutions.com' }));
    expect(url).toBe('https://ananselogix.com');
  });

  it('2. the legacy-slugged tenant (Trans Atlantic) keeps using WEB_APP_URL — its own real production domain, unchanged', () => {
    const url = resolveTenantWebAppUrl(
      transAtlantic,
      fakeConfig({
        LEGACY_CUSTOM_DOMAIN_TENANT_SLUG: 'transatlantic',
        WEB_APP_URL: 'https://app.talogisticssolutions.com',
        ANANSELOGIX_BASE_URL: 'https://ananselogix.com',
      }),
    );
    expect(url).toBe('https://app.talogisticssolutions.com');
  });

  it('3. without LEGACY_CUSTOM_DOMAIN_TENANT_SLUG configured, even a tenant slugged "transatlantic" falls through to ANANSELOGIX_BASE_URL — the mapping is config-driven, never an implicit slug check', () => {
    const url = resolveTenantWebAppUrl(transAtlantic, fakeConfig({ ANANSELOGIX_BASE_URL: 'https://ananselogix.com' }));
    expect(url).toBe('https://ananselogix.com');
  });

  it('4. a tenant with its own configured customDomain always wins, regardless of slug — the extension point a future tenant\'s own branded activation experience needs, with zero further code change', () => {
    const url = resolveTenantWebAppUrl(
      { slug: 'some-future-tenant', customDomain: 'app.somefuturetenant.com' },
      fakeConfig({ ANANSELOGIX_BASE_URL: 'https://ananselogix.com', LEGACY_CUSTOM_DOMAIN_TENANT_SLUG: 'transatlantic' }),
    );
    expect(url).toBe('https://app.somefuturetenant.com');
  });

  it('5. customDomain wins even for the legacy-slugged tenant, once it has one — the legacy branch is only a bridge until this field is populated', () => {
    const url = resolveTenantWebAppUrl(
      { slug: 'transatlantic', customDomain: 'app.talogisticssolutions.com' },
      fakeConfig({ LEGACY_CUSTOM_DOMAIN_TENANT_SLUG: 'transatlantic', WEB_APP_URL: 'https://should-not-be-used.example' }),
    );
    expect(url).toBe('https://app.talogisticssolutions.com');
  });

  it('6. defaults to http://localhost:3000 for local dev when nothing is configured — unchanged prior behavior', () => {
    expect(resolveTenantWebAppUrl(tatanicLike, fakeConfig({}))).toBe('http://localhost:3000');
    expect(resolveTenantWebAppUrl(transAtlantic, fakeConfig({}))).toBe('http://localhost:3000');
  });
});

/**
 * Send Drop-Off Link production-config fix (2026-09): resolveTenantWebAppUrl
 * is correct for staff-invitation-style links, but a *customer*-facing link
 * must never point at app.talogisticssolutions.com (the staff hostname) —
 * exactly the bug found verifying production config before this feature's
 * deploy (Trans Atlantic's real customDomain is null, so it was hitting the
 * legacy branch and resolving to the staff subdomain). Same precedence and
 * same fake-config test style as the suite above; only the legacy branch's
 * result differs.
 */
describe('resolveTenantPublicSiteUrl — a customer-facing link must never point at the staff subdomain', () => {
  function fakeConfig(values: Record<string, string>): ConfigLike {
    return {
      get: <T = string>(key: string, defaultValue?: T): T | undefined =>
        (key in values ? (values[key] as unknown as T) : defaultValue),
    };
  }

  const tatanicLike: TenantForWebAppUrl = { slug: 'tatanic', customDomain: null };
  const transAtlantic: TenantForWebAppUrl = { slug: 'transatlantic', customDomain: null };

  it("1. the legacy-slugged tenant (Trans Atlantic) resolves to the bare public domain, NOT app.talogisticssolutions.com — the actual production bug this fixes", () => {
    const url = resolveTenantPublicSiteUrl(
      transAtlantic,
      fakeConfig({
        LEGACY_CUSTOM_DOMAIN_TENANT_SLUG: 'transatlantic',
        WEB_APP_URL: 'https://app.talogisticssolutions.com',
        ANANSELOGIX_BASE_URL: 'https://ananselogix.com',
      }),
    );
    expect(url).toBe('https://talogisticssolutions.com');
  });

  it('2. a tenant with no customDomain and not the legacy slug still uses ANANSELOGIX_BASE_URL, same as resolveTenantWebAppUrl', () => {
    const url = resolveTenantPublicSiteUrl(tatanicLike, fakeConfig({ ANANSELOGIX_BASE_URL: 'https://ananselogix.com', WEB_APP_URL: 'https://app.talogisticssolutions.com' }));
    expect(url).toBe('https://ananselogix.com');
  });

  it('3. a tenant with its own configured customDomain always wins, regardless of slug — same extension point as resolveTenantWebAppUrl', () => {
    const url = resolveTenantPublicSiteUrl(
      { slug: 'some-future-tenant', customDomain: 'somefuturetenant.com' },
      fakeConfig({ ANANSELOGIX_BASE_URL: 'https://ananselogix.com', LEGACY_CUSTOM_DOMAIN_TENANT_SLUG: 'transatlantic' }),
    );
    expect(url).toBe('https://somefuturetenant.com');
  });

  it('4. customDomain wins even for the legacy-slugged tenant, once it has one', () => {
    const url = resolveTenantPublicSiteUrl(
      { slug: 'transatlantic', customDomain: 'talogisticssolutions.com' },
      fakeConfig({ LEGACY_CUSTOM_DOMAIN_TENANT_SLUG: 'transatlantic', WEB_APP_URL: 'https://should-not-be-used.example' }),
    );
    expect(url).toBe('https://talogisticssolutions.com');
  });

  it('5. a legacy WEB_APP_URL with no "app." prefix is left unchanged — no double-stripping, no crash', () => {
    const url = resolveTenantPublicSiteUrl(
      transAtlantic,
      fakeConfig({ LEGACY_CUSTOM_DOMAIN_TENANT_SLUG: 'transatlantic', WEB_APP_URL: 'https://talogisticssolutions.com' }),
    );
    expect(url).toBe('https://talogisticssolutions.com');
  });

  it('6. defaults to http://localhost:3000 for local dev when nothing is configured — identical to resolveTenantWebAppUrl, since localhost has no "app." prefix to strip', () => {
    expect(resolveTenantPublicSiteUrl(tatanicLike, fakeConfig({}))).toBe('http://localhost:3000');
    expect(resolveTenantPublicSiteUrl(transAtlantic, fakeConfig({}))).toBe('http://localhost:3000');
  });

  it('7. an unparseable WEB_APP_URL is returned unchanged rather than throwing', () => {
    const url = resolveTenantPublicSiteUrl(
      transAtlantic,
      fakeConfig({ LEGACY_CUSTOM_DOMAIN_TENANT_SLUG: 'transatlantic', WEB_APP_URL: 'not-a-valid-url' }),
    );
    expect(url).toBe('not-a-valid-url');
  });
});
