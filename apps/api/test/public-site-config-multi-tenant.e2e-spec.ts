import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Multi-tenant public-route branding fix (2026-09): proves the already-live
 * GET /public/site-config/:slug — what apps/web/(public)/dropoff/[tenantSlug]
 * reads to show a tenant's own name instead of falling through to Trans
 * Atlantic's hardcoded branding (see that page's own doc comment) — returns
 * each tenant's own, distinct data, and never leaks one tenant's name/data
 * under another tenant's slug.
 */
describe('Public site-config: multi-tenant branding isolation (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let goldCoast: TestTenantFixture;
  let titanic: TestTenantFixture;

  beforeAll(async () => {
    app = await createTestApp();
    goldCoast = await createTestTenant(prisma, 'BrandGoldCoast', UserRole.MANAGER);
    titanic = await createTestTenant(prisma, 'BrandTitanic', UserRole.MANAGER);
    // createTestTenant's Tenant.name is "E2E Test Tenant <label> <runId>" —
    // distinct per fixture already, exactly what this suite needs to prove
    // isolation without hardcoding "Gold Coast"/"Titanic" as literal names.
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, goldCoast.tenantId);
    await deleteTestTenant(prisma, titanic.tenantId);
    await prisma.$disconnect();
  });

  function getSiteConfig(slug: string) {
    return request(app.getHttpServer()).get(`/public/site-config/${encodeURIComponent(slug)}`);
  }

  it("Gold Coast's own slug returns Gold Coast's own name — never Trans Atlantic's or a generic default", async () => {
    const res = await getSiteConfig(goldCoast.slug);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe(goldCoast.slug);
    const goldCoastTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: goldCoast.tenantId } });
    expect(res.body.companyName).toBe(goldCoastTenant.name);
    expect(res.body.companyName).not.toBe('Trans Atlantic Logistics Solutions');
    expect(res.body.companyName).not.toContain('Trans Atlantic');
  });

  it("Titanic's own slug returns Titanic's own name — distinct from Gold Coast's and never Trans Atlantic's", async () => {
    const res = await getSiteConfig(titanic.slug);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe(titanic.slug);
    const titanicTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: titanic.tenantId } });
    expect(res.body.companyName).toBe(titanicTenant.name);
    expect(res.body.companyName).not.toBe('Trans Atlantic Logistics Solutions');
  });

  it('Gold Coast and Titanic resolve to two different companyName values — no cross-tenant leak between them', async () => {
    const goldCoastRes = await getSiteConfig(goldCoast.slug);
    const titanicRes = await getSiteConfig(titanic.slug);
    expect(goldCoastRes.body.companyName).not.toBe(titanicRes.body.companyName);
    expect(goldCoastRes.body.slug).not.toBe(titanicRes.body.slug);
  });

  it('the real Trans Atlantic tenant resolves its own real name — sanity check that the legacy tenant is unaffected by this endpoint', async () => {
    const transAtlantic = await prisma.tenant.findFirstOrThrow({ where: { slug: 'transatlantic' } });
    const res = await getSiteConfig('transatlantic');
    expect(res.status).toBe(200);
    expect(res.body.companyName).toBe(transAtlantic.name);
  });

  it('an unrecognized slug 404s — never falls back to any real tenant\'s data', async () => {
    const res = await getSiteConfig('this-tenant-does-not-exist-98765');
    expect(res.status).toBe(404);
  });

  it('is a public, unauthenticated endpoint — no Authorization header required', async () => {
    const res = await request(app.getHttpServer()).get(`/public/site-config/${goldCoast.slug}`);
    expect(res.status).toBe(200);
  });
});
