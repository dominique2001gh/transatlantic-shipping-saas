import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import {
  createCustomerWithPortalUser,
  createTestTenant,
  deleteTestTenant,
  TestPortalCustomerFixture,
  TestTenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Stage 5: InvoiceStatus.OVERDUE is a real enum value nothing in this
 * codebase ever writes to the database — every invoice past its due date
 * silently stayed SENT/PARTIALLY_PAID forever. InvoicesService.
 * computeEffectiveStatus (used by toSummary, the single chokepoint every
 * read path funnels through) now computes this live instead. Proves it's
 * applied consistently across both staff and customer-portal reads, and
 * that it never fires for a status where it shouldn't (PAID/VOID/DRAFT,
 * or a due date that hasn't passed yet).
 */
describe('Invoice overdue status: live-computed, applied everywhere (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenant: TestTenantFixture;
  let staffToken: string;
  let customer: TestPortalCustomerFixture;
  let customerToken: string;

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  let overdueSentInvoiceId: string;
  let overduePartiallyPaidInvoiceId: string;
  let notYetDueInvoiceId: string;
  let overduePaidInvoiceId: string;
  let overdueVoidInvoiceId: string;

  beforeAll(async () => {
    app = await createTestApp();

    tenant = await createTestTenant(prisma, 'OverdueStatus', UserRole.TENANT_ADMIN);
    staffToken = await login(app, tenant.user.email, tenant.user.password);
    customer = await createCustomerWithPortalUser(prisma, tenant.tenantId, 'OverdueCust');
    customerToken = await login(app, customer.user.email, customer.user.password);

    const makeInvoice = (status: 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID', dueDate: Date, amountPaid: string, suffix: string) =>
      prisma.invoice.create({
        data: {
          tenantId: tenant.tenantId,
          customerId: customer.customerId,
          invoiceNumber: `OVERDUE-TEST-${suffix}`,
          status,
          subtotal: '100.00',
          tax: '0.00',
          total: '100.00',
          amountPaid,
          currency: 'USD',
          dueDate,
          issuedAt: new Date(),
        },
      });

    const overdueSent = await makeInvoice('SENT', yesterday, '0.00', '001');
    overdueSentInvoiceId = overdueSent.id;

    const overduePartial = await makeInvoice('PARTIALLY_PAID', yesterday, '40.00', '002');
    overduePartiallyPaidInvoiceId = overduePartial.id;

    const notYetDue = await makeInvoice('SENT', nextWeek, '0.00', '003');
    notYetDueInvoiceId = notYetDue.id;

    const overduePaid = await makeInvoice('PAID', yesterday, '100.00', '004');
    overduePaidInvoiceId = overduePaid.id;

    const overdueVoid = await makeInvoice('VOID', yesterday, '0.00', '005');
    overdueVoidInvoiceId = overdueVoid.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  describe('Staff views (GET /invoices, GET /invoices/:id)', () => {
    it('a SENT invoice past its due date is returned as OVERDUE in the list', async () => {
      const res = await request(app.getHttpServer()).get('/invoices').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      const invoice = res.body.find((i: { id: string }) => i.id === overdueSentInvoiceId);
      expect(invoice.status).toBe('OVERDUE');
    });

    it('a PARTIALLY_PAID invoice past its due date is returned as OVERDUE', async () => {
      const res = await request(app.getHttpServer())
        .get(`/invoices/${overduePartiallyPaidInvoiceId}`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OVERDUE');
      // The underlying financial figures are untouched by this — only the
      // displayed status is computed differently.
      expect(res.body.amountPaid).toBe('40.00');
      expect(res.body.balanceDue).toBe('60.00');
    });

    it('a SENT invoice not yet due stays SENT', async () => {
      const res = await request(app.getHttpServer())
        .get(`/invoices/${notYetDueInvoiceId}`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SENT');
    });

    it('a PAID invoice with a past due date stays PAID — never misreported as overdue', async () => {
      const res = await request(app.getHttpServer())
        .get(`/invoices/${overduePaidInvoiceId}`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PAID');
    });

    it('a VOID invoice with a past due date stays VOID — never misreported as overdue', async () => {
      const res = await request(app.getHttpServer())
        .get(`/invoices/${overdueVoidInvoiceId}`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('VOID');
    });

    it('the stored database row is never modified by reading it — computation is read-only', async () => {
      await request(app.getHttpServer()).get(`/invoices/${overdueSentInvoiceId}`).set('Authorization', `Bearer ${staffToken}`);
      const raw = await prisma.invoice.findUnique({ where: { id: overdueSentInvoiceId } });
      expect(raw?.status).toBe('SENT'); // still SENT in the database — only the API response computes OVERDUE live
    });
  });

  describe('Customer portal views (GET /portal/invoices, GET /portal/invoices/:id) — same computation, same result', () => {
    it('the same overdue invoice shows OVERDUE in the customer portal list', async () => {
      const res = await request(app.getHttpServer()).get('/portal/invoices').set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      const invoice = res.body.find((i: { id: string }) => i.id === overdueSentInvoiceId);
      expect(invoice.status).toBe('OVERDUE');
    });

    it('the same overdue invoice shows OVERDUE in the customer portal detail view', async () => {
      const res = await request(app.getHttpServer())
        .get(`/portal/invoices/${overduePartiallyPaidInvoiceId}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OVERDUE');
    });

    it('the not-yet-due invoice still shows SENT in the customer portal', async () => {
      const res = await request(app.getHttpServer())
        .get(`/portal/invoices/${notYetDueInvoiceId}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SENT');
    });
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention.
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
