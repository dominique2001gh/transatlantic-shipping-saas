import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { ContainersController } from './containers.controller';
import { ContainersService } from './containers.service';

@Module({
  imports: [ShipmentsModule, WarehouseModule],
  controllers: [ContainersController],
  providers: [ContainersService],
})
export class ContainersModule {}
