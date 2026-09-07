import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AiAgentModule } from './ai-agent/ai-agent.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { ContainersModule } from './containers/containers.module';
import { CustomerPortalModule } from './customer-portal/customer-portal.module';
import { CustomersModule } from './customers/customers.module';
import { DisruptionsModule } from './disruptions/disruptions.module';
import { DocumentsModule } from './documents/documents.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { EntitlementsGuard } from './common/guards/entitlements.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { SubscriptionStatusGuard } from './common/guards/subscription-status.guard';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { LeadsModule } from './leads/leads.module';
import { ManifestsModule } from './manifests/manifests.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PlatformLeadsModule } from './platform-leads/platform-leads.module';
import { PrismaModule } from './prisma/prisma.module';
import { PublicAiAgentModule } from './public-ai-agent/public-ai-agent.module';
import { SaasAnalyticsModule } from './saas-analytics/saas-analytics.module';
import { SaasPlansModule } from './saas-plans/saas-plans.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { SignupModule } from './signup/signup.module';
import { SiteConfigModule } from './site-config/site-config.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TenantProvisioningModule } from './tenant-provisioning/tenant-provisioning.module';
import { TenantsModule } from './tenants/tenants.module';
import { TrackingModule } from './tracking/tracking.module';
import { UsersModule } from './users/users.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // AnanseLogix Phase 2: enables @Cron(...) handlers app-wide — see
    // BillingSchedulerService's own doc comment for the one job that
    // currently uses it.
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    CustomersModule,
    ShipmentsModule,
    WarehouseModule,
    ContainersModule,
    ManifestsModule,
    HealthModule,
    TrackingModule,
    CustomerPortalModule,
    InvoicesModule,
    WebhooksModule,
    DocumentsModule,
    NotificationsModule,
    DisruptionsModule,
    AnalyticsModule,
    LeadsModule,
    // AnanseLogix SaaS platform layer (Phase 1) — see each module's own
    // doc comment; TenantProvisioningModule/SubscriptionsModule are also
    // imported transitively via WebhooksModule, listed here too since
    // AppModule is the canonical place to see every module in the app.
    SaasPlansModule,
    SignupModule,
    TenantProvisioningModule,
    SubscriptionsModule,
    OnboardingModule,
    PlatformLeadsModule,
    EntitlementsModule,
    AiAgentModule,
    PublicAiAgentModule,
    SiteConfigModule,
    SaasAnalyticsModule,
  ],
  providers: [
    // Every route requires authentication by default; opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Enforces @Roles(...) metadata once a user is authenticated.
    { provide: APP_GUARD, useClass: RolesGuard },
    // AnanseLogix Phase 1: billing-status access restriction (Section 9) —
    // see SubscriptionStatusGuard's own doc comment. Runs after the two
    // guards above, since it needs req.user already populated.
    { provide: APP_GUARD, useClass: SubscriptionStatusGuard },
    // AnanseLogix Phase 1: @RequireEntitlement(...) enforcement — see
    // EntitlementsGuard's own doc comment.
    { provide: APP_GUARD, useClass: EntitlementsGuard },
  ],
})
export class AppModule {}
