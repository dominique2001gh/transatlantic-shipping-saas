import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SaasPlansService } from './saas-plans.service';

/**
 * AnanseLogix Phase 1: the pricing page and signup wizard's Step 1 both
 * read from here — no authentication, deliberately (a prospect has no
 * account yet), same posture as PublicLeadsController.
 */
@Controller('public/plans')
export class PublicPlansController {
  constructor(private readonly saasPlansService: SaasPlansService) {}

  @Get()
  @Public()
  findAll() {
    return this.saasPlansService.findAllPublic();
  }
}
