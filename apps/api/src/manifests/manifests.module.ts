import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { ManifestsController } from './manifests.controller';
import { ManifestsService } from './manifests.service';

@Module({
  imports: [ShipmentsModule],
  controllers: [ManifestsController],
  providers: [ManifestsService],
})
export class ManifestsModule {}
