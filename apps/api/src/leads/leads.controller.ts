import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { LEAD_MANAGE_ROLES } from '@transatlantic/shared';
import type { WebsiteLeadStatus, WebsiteLeadType } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadsService } from './leads.service';

/**
 * Website Launch: staff-facing view of leads captured by
 * PublicLeadsController — so a submitted Contact/Quote-request form is
 * actually seen and actioned by a person, not just an email that can get
 * lost. `@Roles(...LEAD_MANAGE_ROLES)` at the class level covers every
 * route here — no per-method allow-lists to keep in sync, same reasoning
 * CustomerPortalController's own doc comment gives for its class-level
 * @Roles().
 */
@Controller('leads')
@Roles(...LEAD_MANAGE_ROLES)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: WebsiteLeadStatus,
    @Query('type') type?: WebsiteLeadType,
  ) {
    return this.leadsService.findAll(requireTenantId(user.tenantId), { status, type });
  }

  @Patch(':id/status')
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateLeadStatusDto) {
    return this.leadsService.updateStatus(requireTenantId(user.tenantId), id, dto.status);
  }
}
