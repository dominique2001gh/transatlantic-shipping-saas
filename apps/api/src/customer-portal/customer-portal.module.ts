import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { TrackingModule } from '../tracking/tracking.module';
import { CustomerPortalController } from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';

@Module({
  imports: [TrackingModule, InvoicesModule, PaymentsModule, DocumentsModule],
  controllers: [CustomerPortalController],
  providers: [CustomerPortalService],
})
export class CustomerPortalModule {}
