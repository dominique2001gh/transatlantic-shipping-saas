import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EntitlementFeature, PrismaClient, TenantAgentKnowledgeKind, UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PUBLIC_AGENT_PROVIDER, type PublicAgentMessage } from '../src/public-ai-agent/providers/public-agent-provider.interface';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';

/**
 * Public Website AI Agent, Phase 1 — the guardrail/tenant-isolation
 * verification the approved plan calls for. Mocks PUBLIC_AGENT_PROVIDER
 * (no real Anthropic call, no tokens spent, no network dependency) so
 * these assertions are about THIS app's own tenant-resolution and
 * prompt-assembly logic, not about model output quality:
 *
 *   - a tenant's system prompt contains ONLY that tenant's own knowledge,
 *     never another tenant's (the core tenant-isolation guarantee);
 *   - an unentitled tenant and a nonexistent tenant get the identical
 *     generic 404 (anti-enumeration — no way to tell them apart);
 *   - server-held conversation history is actually passed to the provider
 *     on a follow-up turn using the returned conversationId;
 *   - the per-IP rate limit actually rejects excess requests.
 */
describe('Public AI Agent (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const receivedCalls: { systemPrompt: string; messages: PublicAgentMessage[] }[] = [];

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PUBLIC_AGENT_PROVIDER)
      .useValue({
        complete: async (systemPrompt: string, messages: PublicAgentMessage[]) => {
          receivedCalls.push({ systemPrompt, messages });
          return { text: 'mocked assistant reply' };
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    tenantA = await createTestTenant(prisma, 'PubAgentA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'PubAgentB', UserRole.MANAGER);

    await prisma.tenantAgentKnowledgeEntry.create({
      data: {
        tenantId: tenantA.tenantId,
        kind: TenantAgentKnowledgeKind.FACT,
        title: 'Tenant A Marker',
        body: 'UNIQUE_MARKER_TENANT_A_ONLY',
      },
    });
    await prisma.tenantAgentKnowledgeEntry.create({
      data: {
        tenantId: tenantB.tenantId,
        kind: TenantAgentKnowledgeKind.FACT,
        title: 'Tenant B Marker',
        body: 'UNIQUE_MARKER_TENANT_B_ONLY',
      },
    });

    // Tenant A is explicitly entitled. Tenant B has knowledge rows but is
    // EXPLICITLY disabled — both tenants have no TenantSubscription row
    // (same as any tenant created before the SaaS layer existed), so with
    // no entitlement row at all a tenant is grandfathered-entitled by
    // default (see PublicAiAgentService's own doc comment); tenant B's
    // explicit `enabled: false` row is what proves a grandfathered tenant
    // can still be individually turned off, and that having knowledge
    // configured is not by itself enough to be served.
    await prisma.tenantEntitlement.create({
      data: { tenantId: tenantA.tenantId, feature: EntitlementFeature.PUBLIC_AI_AGENT, enabled: true },
    });
    await prisma.tenantEntitlement.create({
      data: { tenantId: tenantB.tenantId, feature: EntitlementFeature.PUBLIC_AI_AGENT, enabled: false },
    });
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    receivedCalls.length = 0;
  });

  it("includes only the resolved tenant's own knowledge in the assembled system prompt, never another tenant's", async () => {
    const res = await request(app.getHttpServer())
      .post('/public/ai-agent/ask')
      .send({ tenantSlug: tenantA.slug, question: 'What can you tell me?' })
      .expect(201);

    expect(res.body.answer).toBe('mocked assistant reply');
    expect(res.body.conversationId).toEqual(expect.any(String));

    expect(receivedCalls).toHaveLength(1);
    expect(receivedCalls[0].systemPrompt).toContain('UNIQUE_MARKER_TENANT_A_ONLY');
    expect(receivedCalls[0].systemPrompt).not.toContain('UNIQUE_MARKER_TENANT_B_ONLY');
  });

  it('rejects a real tenant that is not entitled with the same generic 404 as an unknown tenant (anti-enumeration)', async () => {
    const resUnentitled = await request(app.getHttpServer())
      .post('/public/ai-agent/ask')
      .send({ tenantSlug: tenantB.slug, question: 'Hello?' })
      .expect(404);

    const resUnknown = await request(app.getHttpServer())
      .post('/public/ai-agent/ask')
      .send({ tenantSlug: 'this-tenant-does-not-exist', question: 'Hello?' })
      .expect(404);

    expect(resUnentitled.body.message).toEqual(resUnknown.body.message);
    expect(receivedCalls).toHaveLength(0);
  });

  it('rejects an empty or over-length question with 400, never reaching the provider', async () => {
    await request(app.getHttpServer())
      .post('/public/ai-agent/ask')
      .send({ tenantSlug: tenantA.slug, question: '' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/public/ai-agent/ask')
      .send({ tenantSlug: tenantA.slug, question: 'a'.repeat(501) })
      .expect(400);

    expect(receivedCalls).toHaveLength(0);
  });

  it('passes bounded, server-held conversation history back to the provider on a follow-up turn using the returned conversationId', async () => {
    const first = await request(app.getHttpServer())
      .post('/public/ai-agent/ask')
      .send({ tenantSlug: tenantA.slug, question: 'first question' })
      .expect(201);

    const conversationId = first.body.conversationId;

    await request(app.getHttpServer())
      .post('/public/ai-agent/ask')
      .send({ tenantSlug: tenantA.slug, question: 'second question', conversationId })
      .expect(201);

    expect(receivedCalls).toHaveLength(2);
    // Second call must include the first exchange (user + assistant) plus the new question — never just the new question alone.
    const secondCallMessages = receivedCalls[1].messages;
    expect(secondCallMessages).toHaveLength(3);
    expect(secondCallMessages[0]).toEqual({ role: 'user', content: 'first question' });
    expect(secondCallMessages[1]).toEqual({ role: 'assistant', content: 'mocked assistant reply' });
    expect(secondCallMessages[2]).toEqual({ role: 'user', content: 'second question' });
  });

  it('never trusts a client-supplied conversationId it never issued — silently starts a fresh conversation instead of erroring', async () => {
    const res = await request(app.getHttpServer())
      .post('/public/ai-agent/ask')
      .send({ tenantSlug: tenantA.slug, question: 'hello', conversationId: 'forged-id-never-issued-by-server' })
      .expect(201);

    expect(res.body.conversationId).not.toBe('forged-id-never-issued-by-server');
    expect(receivedCalls[0].messages).toHaveLength(1);
  });

  it('rate-limits excess requests from the same caller', async () => {
    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await request(app.getHttpServer())
        .post('/public/ai-agent/ask')
        .send({ tenantSlug: tenantA.slug, question: `throttle test ${i}` });
      results.push(res.status);
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
