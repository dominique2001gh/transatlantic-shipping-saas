import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { PlatformLeadStatus } from '@prisma/client';
import { UserRole } from '@transatlantic/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdatePlatformLeadStatusDto } from './dto/update-platform-lead-status.dto';
import { PlatformLeadsService } from './platform-leads.service';

@Controller('platform/leads')
@Roles(UserRole.PLATFORM_ADMIN)
export class PlatformLeadsController {
  constructor(private readonly platformLeadsService: PlatformLeadsService) {}

  @Get()
  findAll(@Query('status') status?: PlatformLeadStatus) {
    return this.platformLeadsService.findAll(status);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdatePlatformLeadStatusDto) {
    return this.platformLeadsService.updateStatus(id, dto.status);
  }
}
