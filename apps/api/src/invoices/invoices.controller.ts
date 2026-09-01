import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { INVOICE_MANAGE_ROLES, InvoiceStatus } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { CreatePaymentDto } from '../payments/dto/create-payment.dto';
import { PaymentsService } from '../payments/payments.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoicesService } from './invoices.service';

/**
 * Invoices are a financial/customer-account document, not warehouse-floor
 * work — unlike ShipmentsController's OPERATIONS_ROLES (which deliberately
 * includes WAREHOUSE_MANAGER/WAREHOUSE_STAFF), warehouse-only operational
 * roles get no access here at all. This is a deliberate product decision,
 * not an oversight: staff status alone must never imply invoice access.
 * Sourced from the shared INVOICE_MANAGE_ROLES constant (Stage 3D) since
 * the frontend now needs the identical list for nav visibility — kept as
 * local aliases here so the rest of this file reads exactly as it did
 * before. No broader read-only tier exists.
 */
const MANAGE_ROLES = INVOICE_MANAGE_ROLES;
const VIEW_ROLES = MANAGE_ROLES;

const VALID_STATUSES = new Set<string>(Object.values(InvoiceStatus));

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get()
  @Roles(...VIEW_ROLES)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('customerId') customerId?: string,
    @Query('shipmentId') shipmentId?: string,
    @Query('status') status?: string,
  ) {
    const tenantId = requireTenantId(user.tenantId);
    const validStatus = status && VALID_STATUSES.has(status) ? (status as InvoiceStatus) : undefined;
    return this.invoicesService.findAll(tenantId, { customerId, shipmentId, status: validStatus });
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoicesService.findById(requireTenantId(user.tenantId), id);
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(requireTenantId(user.tenantId), dto);
  }

  @Post(':id/issue')
  @Roles(...MANAGE_ROLES)
  issue(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoicesService.issue(requireTenantId(user.tenantId), id);
  }

  /**
   * Stage 3B: manual payment recording, nested under its parent invoice —
   * same convention as :id/items and :id/tracking-events on
   * ShipmentsController. Same MANAGE_ROLES as invoices themselves; no
   * separate role tier for payments.
   */
  @Get(':id/payments')
  @Roles(...VIEW_ROLES)
  listPayments(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.paymentsService.listForInvoice(requireTenantId(user.tenantId), id);
  }

  @Post(':id/payments')
  @Roles(...MANAGE_ROLES)
  recordPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.recordPayment(requireTenantId(user.tenantId), id, dto);
  }
}
