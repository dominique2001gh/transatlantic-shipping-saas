import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { NOTIFICATION_MANAGE_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { DisruptionsService } from './disruptions.service';
import { CreateDisruptionDto } from './dto/create-disruption.dto';

const MANAGE_ROLES = NOTIFICATION_MANAGE_ROLES;

/** Stage 3H: staff-composed bulk container/manifest disruption messaging — see DisruptionsService's own doc comment. */
@Controller('disruptions')
export class DisruptionsController {
  constructor(private readonly disruptionsService: DisruptionsService) {}

  @Get('preview')
  @Roles(...MANAGE_ROLES)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('containerId') containerId?: string,
    @Query('manifestId') manifestId?: string,
  ) {
    if (!containerId && !manifestId) {
      throw new BadRequestException('Provide a containerId or manifestId to preview.');
    }
    return this.disruptionsService.preview(requireTenantId(user.tenantId), { containerId, manifestId });
  }

  @Get()
  @Roles(...MANAGE_ROLES)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.disruptionsService.findAll(requireTenantId(user.tenantId));
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDisruptionDto) {
    return this.disruptionsService.create(requireTenantId(user.tenantId), user.id, dto);
  }

  @Patch(':id/resolve')
  @Roles(...MANAGE_ROLES)
  resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.disruptionsService.resolve(requireTenantId(user.tenantId), id);
  }
}
