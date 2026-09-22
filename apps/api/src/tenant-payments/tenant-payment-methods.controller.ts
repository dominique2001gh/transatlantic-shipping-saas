import { Body, Controller, Get, Put } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser, EnabledPaymentMethod, TenantPaymentMethodConfigItem } from '@transatlantic/shared';
import { INVOICE_MANAGE_ROLES, OWNER_ONLY_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { UpsertPaymentMethodsDto } from './dto/upsert-payment-methods.dto';
import { TenantPaymentMethodsService } from './tenant-payment-methods.service';

/**
 * Tenant Payment Configuration Phase C/D: the manual-payment-method
 * configuration HTTP surface. Read/write of the full config (GET/PUT
 * `/tenant-payments/methods`) is OWNER-only — matching the same
 * fraud-risk reasoning TenantPaymentsController's Stripe Connect
 * onboarding already applies (whoever can redirect where customers are
 * told to send money must be the most trusted tenant role, not any
 * broader staff tier). The narrower `/tenant-payments/methods/enabled`
 * read is open to INVOICE_MANAGE_ROLES (OWNER/MANAGER/FINANCE) — the same
 * roles who can already record a payment at all — purely so the Record
 * Payment dropdown can populate itself; it exposes nothing an
 * invoice-managing staff member couldn't already infer from the payment
 * methods they're allowed to select.
 *
 * Every route reads tenantId exclusively from the verified JWT, never
 * from a request param/body — there is no way for this controller to act
 * on any tenant other than the caller's own, the same structural
 * isolation every other tenant-scoped controller in this codebase already
 * follows.
 */
@Controller('tenant-payments/methods')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
export class TenantPaymentMethodsController {
  constructor(private readonly tenantPaymentMethodsService: TenantPaymentMethodsService) {}

  @Get()
  @Roles(...OWNER_ONLY_ROLES)
  getConfig(@CurrentUser() user: AuthenticatedUser): Promise<TenantPaymentMethodConfigItem[]> {
    return this.tenantPaymentMethodsService.getConfigForTenant(requireTenantId(user.tenantId));
  }

  @Put()
  @Roles(...OWNER_ONLY_ROLES)
  upsertConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertPaymentMethodsDto,
  ): Promise<TenantPaymentMethodConfigItem[]> {
    return this.tenantPaymentMethodsService.upsertConfigForTenant(requireTenantId(user.tenantId), dto.methods);
  }

  /** Record Payment dropdown (staff) — see TenantPaymentMethodsService.getEnabledForStaff's own doc comment for the legacy-fallback rule. */
  @Get('enabled')
  @Roles(...INVOICE_MANAGE_ROLES)
  getEnabled(@CurrentUser() user: AuthenticatedUser): Promise<EnabledPaymentMethod[]> {
    return this.tenantPaymentMethodsService.getEnabledForStaff(requireTenantId(user.tenantId));
  }
}
