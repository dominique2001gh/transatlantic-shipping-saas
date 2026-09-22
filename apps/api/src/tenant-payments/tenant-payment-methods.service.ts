import { Injectable } from '@nestjs/common';
import { LEGACY_MANUAL_PAYMENT_METHODS, MANUAL_PAYMENT_METHODS } from '@transatlantic/shared';
import type { EnabledPaymentMethod, TenantPaymentMethodConfigItem } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentMethodConfigItemDto } from './dto/upsert-payment-methods.dto';

/**
 * Tenant Payment Configuration Phase C/D: CRUD for a tenant's manual
 * payment methods (Cash App, Zelle, Cash, Bank Transfer, Mobile Money,
 * Check, Other) — deliberately a separate service from
 * TenantPaymentsStripeService, the same "logically distinct concerns"
 * split that service's own doc comment already establishes for platform-
 * billing vs. tenant-customer-payments. This service never touches Stripe
 * or TenantPaymentSettings at all; card/online payments stay entirely
 * governed by that service and PAYABLE_INVOICE_STATUSES, unaffected by
 * anything here.
 *
 * Three different reads exist because three different callers need three
 * different fallback/visibility rules, all built on the same
 * TenantPaymentMethodConfig rows:
 *   - getConfigForTenant (OWNER, Settings → Payments): every configurable
 *     method, always all of MANUAL_PAYMENT_METHODS, synthesizing a default
 *     for any method with no row yet — see its own doc comment for why the
 *     synthesized default matters.
 *   - getEnabledForStaff (INVOICE_MANAGE_ROLES, Record Payment dropdown):
 *     falls back to the exact 5 methods that dropdown has always hard-
 *     coded when a tenant has configured nothing at all, so existing staff
 *     workflows never regress from this feature shipping.
 *   - getEnabledForPortal (CUSTOMER, invoice detail): never falls back — an
 *     unconfigured tenant's customers see no manual methods, only "Pay
 *     Now" when Stripe is payable, because there is no tenant-authored
 *     instructions text to show them.
 */
@Injectable()
export class TenantPaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Full configurable set for the Settings → Payments form. A method with
   * no TenantPaymentMethodConfig row yet is synthesized with `enabled`
   * defaulting to whatever the pre-Phase-C behavior already was for that
   * method (true for LEGACY_MANUAL_PAYMENT_METHODS, false for the new
   * CASH_APP/ZELLE) — so the very first time an OWNER opens this page,
   * what they see already accurately reflects today's real behavior
   * (existing manual methods shown as already-accepted, the two new ones
   * off by default), and saving the form unchanged is a true no-op rather
   * than an accidental regression. This method never writes anything —
   * synthesized rows are not persisted until an explicit upsert.
   */
  async getConfigForTenant(tenantId: string): Promise<TenantPaymentMethodConfigItem[]> {
    const rows = await this.prisma.tenantPaymentMethodConfig.findMany({ where: { tenantId } });
    const byMethod = new Map(rows.map((row) => [row.method, row]));

    return MANUAL_PAYMENT_METHODS.map((method) => {
      const row = byMethod.get(method);
      if (row) {
        return { method, enabled: row.enabled, instructions: row.instructions };
      }
      return { method, enabled: LEGACY_MANUAL_PAYMENT_METHODS.includes(method), instructions: null };
    });
  }

  /**
   * Atomically upserts the full set the Settings → Payments form submits
   * (one row per method in MANUAL_PAYMENT_METHODS — the DTO's own
   * `@IsIn(MANUAL_PAYMENT_METHODS)` already rejects CARD or any other
   * value before this ever runs). `$transaction` here is the
   * array-of-independent-operations form (not a callback) — every upsert
   * targets a different `(tenantId, method)` unique key, so there is no
   * ordering/read-then-write dependency between them, only the
   * all-or-nothing atomicity guarantee.
   */
  async upsertConfigForTenant(tenantId: string, methods: PaymentMethodConfigItemDto[]): Promise<TenantPaymentMethodConfigItem[]> {
    await this.prisma.$transaction(
      methods.map((item) =>
        this.prisma.tenantPaymentMethodConfig.upsert({
          where: { tenantId_method: { tenantId, method: item.method } },
          create: { tenantId, method: item.method, enabled: item.enabled, instructions: item.instructions ?? null },
          update: { enabled: item.enabled, instructions: item.instructions ?? null },
        }),
      ),
    );
    return this.getConfigForTenant(tenantId);
  }

  /**
   * Record Payment dropdown (staff). Zero rows at all for this tenant
   * (every tenant before this feature, and every tenant who has never
   * opened Settings → Payments) means "still on the old hard-coded
   * behavior" — returns LEGACY_MANUAL_PAYMENT_METHODS unchanged, with no
   * instructions (staff never needed tenant-authored customer-facing text
   * to select a method). Once a tenant has configured anything at all,
   * this switches fully to their explicit choices — only methods they
   * marked enabled, nothing else, even if that means fewer options than
   * the legacy default set. That's intentional: touching Settings →
   * Payments is the tenant explicitly taking control, not an accident.
   */
  async getEnabledForStaff(tenantId: string): Promise<EnabledPaymentMethod[]> {
    const rows = await this.prisma.tenantPaymentMethodConfig.findMany({ where: { tenantId } });
    if (rows.length === 0) {
      return LEGACY_MANUAL_PAYMENT_METHODS.map((method) => ({ method, instructions: null }));
    }
    return rows
      .filter((row) => row.enabled)
      .map((row) => ({ method: row.method as unknown as EnabledPaymentMethod['method'], instructions: row.instructions }));
  }

  /**
   * Customer portal invoice detail. Deliberately no legacy fallback,
   * unlike getEnabledForStaff above — an unconfigured tenant has no
   * tenant-authored customer-facing instructions to show at all, so its
   * customers see nothing manual here (only "Pay Now" when the invoice is
   * online-payable). Only ever returns rows this tenant explicitly
   * enabled; never exposes `id`/`createdAt`/disabled rows/any other
   * internal config detail beyond `method` + the instructions text the
   * tenant itself authored as customer-facing.
   */
  async getEnabledForPortal(tenantId: string): Promise<EnabledPaymentMethod[]> {
    const rows = await this.prisma.tenantPaymentMethodConfig.findMany({ where: { tenantId, enabled: true } });
    return rows.map((row) => ({ method: row.method as unknown as EnabledPaymentMethod['method'], instructions: row.instructions }));
  }
}
