import { Controller, Get, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { INVOICE_MANAGE_ROLES, PaymentStatus } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { PaymentsService } from './payments.service';

const VIEW_ROLES = INVOICE_MANAGE_ROLES;
const VALID_STATUSES = new Set<string>(Object.values(PaymentStatus));

/**
 * Stage 3D: tenant-wide payment list, for the staff /dashboard/payments
 * page. Per-invoice recording/listing (POST/GET /invoices/:id/payments)
 * stays on InvoicesController, unchanged from Stage 3B — this is
 * additive, read-only, and uses the exact same role list.
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('invoiceId') invoiceId?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
  ) {
    const tenantId = requireTenantId(user.tenantId);
    const validStatus = status && VALID_STATUSES.has(status) ? (status as PaymentStatus) : undefined;
    return this.paymentsService.findAllForTenant(tenantId, { invoiceId, customerId, status: validStatus });
  }
}
