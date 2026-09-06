import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@transatlantic/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateSaasPlanPriceDto } from './dto/create-saas-plan-price.dto';
import { CreateSaasPlanDto } from './dto/create-saas-plan.dto';
import { UpdateSaasPlanDto } from './dto/update-saas-plan.dto';
import { SaasPlansService } from './saas-plans.service';

/** AnanseLogix Phase 1: PLATFORM_ADMIN-only plan/price management — see SaasPlansService's own doc comment. */
@Controller('platform/plans')
@Roles(UserRole.PLATFORM_ADMIN)
export class SaasPlansController {
  constructor(private readonly saasPlansService: SaasPlansService) {}

  @Get()
  findAll() {
    return this.saasPlansService.findAllForAdmin();
  }

  @Post()
  create(@Body() dto: CreateSaasPlanDto) {
    return this.saasPlansService.createPlan(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSaasPlanDto) {
    return this.saasPlansService.updatePlan(id, dto);
  }

  @Post(':id/prices')
  addPrice(@Param('id') id: string, @Body() dto: CreateSaasPlanPriceDto) {
    return this.saasPlansService.createPrice(id, dto);
  }

  @Delete(':id/prices/:priceId')
  deactivatePrice(@Param('id') id: string, @Param('priceId') priceId: string) {
    return this.saasPlansService.deactivatePrice(id, priceId);
  }
}
