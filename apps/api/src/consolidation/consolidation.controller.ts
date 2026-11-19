import { Body, Controller, Post } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { OPERATIONS_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { ConsolidationService } from './consolidation.service';
import { ConsolidateDto } from './dto/consolidate.dto';

@Controller('consolidation')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
export class ConsolidationController {
  constructor(private readonly consolidationService: ConsolidationService) {}

  @Post()
  @Roles(...OPERATIONS_ROLES)
  @RequirePermission('consolidation.manage')
  consolidate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConsolidateDto) {
    return this.consolidationService.consolidate(requireTenantId(user.tenantId), user.id, dto);
  }
}
