import { Controller, Get, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { NOTIFICATION_MANAGE_ROLES } from '@transatlantic/shared';
import { NotificationChannel } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { NotificationsService } from './notifications.service';

const VIEW_ROLES = NOTIFICATION_MANAGE_ROLES;
const VALID_CHANNELS = new Set<string>(Object.values(NotificationChannel));

/** Stage 3H: tenant-wide notification/delivery history — "did the customer actually get notified, and how". */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('customerId') customerId?: string,
    @Query('channel') channel?: string,
  ) {
    const validChannel = channel && VALID_CHANNELS.has(channel) ? (channel as NotificationChannel) : undefined;
    return this.notificationsService.findAllForTenant(requireTenantId(user.tenantId), { customerId, channel: validChannel });
  }
}
