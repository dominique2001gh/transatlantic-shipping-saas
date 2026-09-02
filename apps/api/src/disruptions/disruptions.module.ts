import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DisruptionsController } from './disruptions.controller';
import { DisruptionsService } from './disruptions.service';

@Module({
  imports: [NotificationsModule],
  controllers: [DisruptionsController],
  providers: [DisruptionsService],
  exports: [DisruptionsService],
})
export class DisruptionsModule {}
