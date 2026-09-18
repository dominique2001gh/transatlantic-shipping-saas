import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { ManifestsController } from './manifests.controller';
import { ManifestsService } from './manifests.service';

@Module({
  imports: [ShipmentsModule, WarehouseModule],
  controllers: [ManifestsController],
  providers: [ManifestsService],
})
export class ManifestsModule {}
