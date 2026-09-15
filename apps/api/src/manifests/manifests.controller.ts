import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { MANAGER_UP_ROLES, ManifestStatus, OPERATIONS_ROLES, ShipmentMode } from '@transatlantic/shared';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { AssignContainerDto } from './dto/assign-container.dto';
import { AssignItemDto } from './dto/assign-item.dto';
import { CreateManifestDto } from './dto/create-manifest.dto';
import { UnassignDto } from './dto/unassign.dto';
import { renderManifestPdf } from './manifest-pdf.util';
import { ManifestsService } from './manifests.service';

/**
 * RBAC V1: view/print, create/assign-unassign (both planning and direct-item
 * scan-based assignment), and arrive are all OPERATIONS_ROLES (OWNER/
 * MANAGER/STAFF) — the old OPERATIONS_ROLES/VIEW_ROLES vs. WAREHOUSE_ROLES
 * split existed only because CUSTOMER_SERVICE/ACCOUNTANT/DESTINATION_AGENT
 * were once separate roles with different scopes; all of that collapses to
 * the single STAFF tier now. Finalize and depart remain the two
 * supervisor-level, harder-to-reverse actions — MANAGER_UP_ROLES (OWNER/
 * MANAGER), STAFF excluded, matching prior behavior exactly (departing in
 * particular is real physical movement, the most consequential action in
 * the manifest lifecycle). FINANCE has no manifest access at all, not even
 * view.
 */
const VALID_STATUSES = new Set<string>(Object.values(ManifestStatus));
const VALID_MODES = new Set<string>(Object.values(ShipmentMode));

/**
 * Milestone 3E-A: create/list/detail. Milestone 3E-B: assignment/
 * unassignment of containers (Ocean/RoRo) and direct items (Air).
 * Milestone 3E-C: finalize (DRAFT -> FINALIZED) and depart
 * (FINALIZED -> DEPARTED).
 */
@Controller('manifests')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
export class ManifestsController {
  constructor(private readonly manifestsService: ManifestsService) {}

  @Get()
  @Roles(...OPERATIONS_ROLES)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('shipmentMode') shipmentMode?: string,
  ) {
    const validStatus = status && VALID_STATUSES.has(status) ? (status as ManifestStatus) : undefined;
    const validMode = shipmentMode && VALID_MODES.has(shipmentMode) ? (shipmentMode as ShipmentMode) : undefined;
    return this.manifestsService.findAll(requireTenantId(user.tenantId), {
      status: validStatus,
      shipmentMode: validMode,
    });
  }

  @Get(':id')
  @Roles(...OPERATIONS_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.manifestsService.findById(requireTenantId(user.tenantId), id);
  }

  /**
   * Print Manifest / Download PDF — read-only, same OPERATIONS_ROLES and same
   * tenant-scoped lookup as findOne above (getPrintDocument uses the
   * identical `findFirst({ where: { id, tenantId } })` pattern), so a
   * user can no more retrieve another tenant's manifest document by
   * guessing/changing an id than they can retrieve their manifest record
   * itself — 404, not a leak. JSON data for the printable HTML view; the
   * PDF endpoint below renders the exact same document.
   */
  @Get(':id/print')
  @Roles(...OPERATIONS_ROLES)
  getPrintDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.manifestsService.getPrintDocument(requireTenantId(user.tenantId), id);
  }

  @Get(':id/pdf')
  @Roles(...OPERATIONS_ROLES)
  async getPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.manifestsService.getPrintDocument(requireTenantId(user.tenantId), id);
    const pdf = renderManifestPdf(doc);
    const fileName = `Manifest-${doc.manifest.manifestNumber}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    pdf.pipe(res);
    pdf.end();
  }

  @Post()
  @Roles(...OPERATIONS_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateManifestDto) {
    return this.manifestsService.create(requireTenantId(user.tenantId), dto);
  }

  @Post(':id/containers/:containerId')
  @Roles(...OPERATIONS_ROLES)
  assignContainer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') manifestId: string,
    @Param('containerId') containerId: string,
    @Body() dto: AssignContainerDto,
  ) {
    return this.manifestsService.assignContainer(requireTenantId(user.tenantId), user.id, manifestId, containerId, dto);
  }

  @Delete(':id/containers/:containerId')
  @Roles(...OPERATIONS_ROLES)
  unassignContainer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') manifestId: string,
    @Param('containerId') containerId: string,
    @Body() dto: UnassignDto,
  ) {
    return this.manifestsService.unassignContainer(requireTenantId(user.tenantId), user.id, manifestId, containerId, dto);
  }

  @Post(':id/items/:itemId')
  @Roles(...OPERATIONS_ROLES)
  assignItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') manifestId: string,
    @Param('itemId') itemId: string,
    @Body() dto: AssignItemDto,
  ) {
    return this.manifestsService.assignItem(requireTenantId(user.tenantId), user.id, manifestId, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @Roles(...OPERATIONS_ROLES)
  unassignItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') manifestId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UnassignDto,
  ) {
    return this.manifestsService.unassignItem(requireTenantId(user.tenantId), user.id, manifestId, itemId, dto);
  }

  @Post(':id/finalize')
  @Roles(...MANAGER_UP_ROLES)
  finalize(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.manifestsService.finalize(requireTenantId(user.tenantId), user.id, id);
  }

  @Post(':id/depart')
  @Roles(...MANAGER_UP_ROLES)
  depart(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.manifestsService.depart(requireTenantId(user.tenantId), user.id, id);
  }

  @Post(':id/arrive')
  @Roles(...OPERATIONS_ROLES)
  arrive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.manifestsService.arrive(requireTenantId(user.tenantId), user.id, id);
  }
}
