import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireCustomerId, requireTenantId } from '../common/tenant/tenant.util';
import { sendDownload } from '../documents/documents.controller';
import { CustomerPortalService } from './customer-portal.service';

/**
 * Stage 2C: the authenticated customer-portal surface. `@Roles(CUSTOMER)`
 * at the class level covers every route in this file — no exceptions, no
 * per-method allow-lists to keep in sync. Nothing here is reachable by a
 * staff token (RolesGuard rejects it), and — see CustomersController's and
 * ShipmentsController's own @Roles() allow-lists, neither of which
 * includes CUSTOMER — no staff route anywhere else in the API is reachable
 * by a CUSTOMER token either. Kept as its own controller/module rather
 * than folded into CustomersController/ShipmentsController specifically so
 * this isolation is auditable at a glance: every handler in this file is
 * customer-only, full stop.
 */
@Controller('portal')
@Roles(UserRole.CUSTOMER)
export class CustomerPortalController {
  constructor(private readonly customerPortalService: CustomerPortalService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.customerPortalService.getProfile(requireTenantId(user.tenantId), requireCustomerId(user.customerId));
  }

  @Get('shipments')
  shipments(@CurrentUser() user: AuthenticatedUser) {
    return this.customerPortalService.listShipments(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
    );
  }

  @Get('shipments/:id')
  shipmentDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customerPortalService.getShipment(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
      id,
    );
  }

  /** Stage 3E: only ever the caller's own issued invoices — see InvoicesService.findAllForCustomer/findByIdForCustomer for the DRAFT-exclusion + ownership rules. */
  @Get('invoices')
  invoices(@CurrentUser() user: AuthenticatedUser) {
    return this.customerPortalService.listInvoices(requireTenantId(user.tenantId), requireCustomerId(user.customerId));
  }

  @Get('invoices/:id')
  invoiceDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customerPortalService.getInvoice(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
      id,
    );
  }

  /**
   * Stage 3F: starts a Stripe-hosted Checkout for this invoice's current
   * balance. Ownership/DRAFT-exclusion is enforced by
   * InvoicesService.findByIdForCustomer exactly as it is for every other
   * portal invoice route — see CustomerPortalService.createCheckoutSession.
   */
  @Post('invoices/:id/checkout-session')
  checkoutSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customerPortalService.createCheckoutSession(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
      id,
    );
  }

  /** Stage 3G: only ever the caller's own customer-visible documents — see DocumentsService.findAllForCustomer/findByIdForCustomer for the visibility + ownership rules. */
  @Get('documents')
  documents(@CurrentUser() user: AuthenticatedUser) {
    return this.customerPortalService.listDocuments(requireTenantId(user.tenantId), requireCustomerId(user.customerId));
  }

  @Get('documents/:id')
  documentDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customerPortalService.getDocument(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
      id,
    );
  }

  /** Ownership/visibility is enforced by DocumentsService.getDownloadTargetForCustomer before any file bytes are resolved — see its own doc comment for why that ordering is the actual security boundary. */
  @Get('documents/:id/download')
  async documentDownload(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const { fileName, mimeType, target } = await this.customerPortalService.downloadDocument(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
      id,
    );
    sendDownload(res, fileName, mimeType, target);
  }
}
