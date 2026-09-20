import { Module } from '@nestjs/common';
import { PreRegistrationsController } from './pre-registrations.controller';
import { PreRegistrationsStaffController } from './pre-registrations-staff.controller';
import { PreRegistrationsService } from './pre-registrations.service';

@Module({
  controllers: [PreRegistrationsController, PreRegistrationsStaffController],
  providers: [PreRegistrationsService],
})
export class PreRegistrationsModule {}
