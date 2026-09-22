import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { TenantPaymentMethodsController } from './tenant-payment-methods.controller';
import { TenantPaymentMethodsService } from './tenant-payment-methods.service';
import { TenantPaymentsController } from './tenant-payments.controller';
import { TenantPaymentsStripeService } from './tenant-payments-stripe.service';

/**
 * Platform-billing vs. tenant-customer-payments separation — see
 * TenantPaymentsStripeService's own doc comment. Imports StripeModule for
 * its underlying client (StripeService.client), but exposes only this
 * tenant-aware wrapper to the rest of the app; PaymentsModule and
 * WebhooksModule depend on this module, never on StripeModule directly,
 * for anything to do with a tenant's own customer payments.
 *
 * Tenant Payments Phase 2: TenantPaymentsController (the OWNER-only
 * onboarding/status HTTP surface) lives in this same module — it's the
 * only consumer of getOrCreateConnectedAccount/createOnboardingLink/
 * getConnectionStatus, so there's no reason to expose those any wider
 * than this module already does for the rest of the service.
 *
 * Tenant Payment Configuration Phase C/D: TenantPaymentMethodsService/
 * Controller (manual methods — Cash App, Zelle, Cash, Bank Transfer,
 * Mobile Money, Check, Other) live here too, exported so
 * CustomerPortalModule can inject the service directly for its own,
 * separate need (Phase E's portal-facing read) — the same "import this
 * module directly for one unrelated concern" pattern WebhooksModule
 * already uses for TenantPaymentsStripeService's webhook-signature
 * verification.
 */
@Module({
  imports: [StripeModule],
  controllers: [TenantPaymentsController, TenantPaymentMethodsController],
  providers: [TenantPaymentsStripeService, TenantPaymentMethodsService],
  exports: [TenantPaymentsStripeService, TenantPaymentMethodsService],
})
export class TenantPaymentsModule {}
