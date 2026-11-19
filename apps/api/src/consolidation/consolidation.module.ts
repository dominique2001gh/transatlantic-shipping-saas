import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { ConsolidationController } from './consolidation.controller';
import { ConsolidationService } from './consolidation.service';

@Module({
  imports: [ShipmentsModule],
  controllers: [ConsolidationController],
  providers: [ConsolidationService],
  exports: [ConsolidationService],
})
export class ConsolidationModule {}
