import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { ContainersController } from './containers.controller';
import { ContainersService } from './containers.service';

@Module({
  imports: [ShipmentsModule],
  controllers: [ContainersController],
  providers: [ContainersService],
})
export class ContainersModule {}
