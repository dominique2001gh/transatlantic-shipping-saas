import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

@Module({
  imports: [ShipmentsModule],
  controllers: [WarehouseController],
  providers: [WarehouseService],
})
export class WarehouseModule {}
