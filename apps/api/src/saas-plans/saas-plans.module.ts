import { Module } from '@nestjs/common';
import { PublicPlansController } from './public-plans.controller';
import { SaasPlansController } from './saas-plans.controller';
import { SaasPlansService } from './saas-plans.service';

@Module({
  controllers: [PublicPlansController, SaasPlansController],
  providers: [SaasPlansService],
  exports: [SaasPlansService],
})
export class SaasPlansModule {}
