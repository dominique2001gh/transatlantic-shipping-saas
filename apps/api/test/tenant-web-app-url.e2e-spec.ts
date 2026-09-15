import { resolveTenantWebAppUrl, type ConfigLike, type TenantForWebAppUrl } from '../src/common/tenant/tenant-web-app-url.util';

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
