-- CreateEnum
CREATE TYPE "SaasPlanType" AS ENUM ('WEBSITE_ONLY', 'SOFTWARE_ONLY', 'WEBSITE_AND_SOFTWARE');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH');

-- CreateEnum
CREATE TYPE "SignupSessionStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'CANCELED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SetupFeeStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "EntitlementFeature" AS ENUM ('PUBLIC_WEBSITE', 'OPERATIONS_SOFTWARE', 'CUSTOMER_PORTAL', 'TRACKING', 'BILLING', 'ANALYTICS', 'AI_AGENT', 'ADVANCED_FEATURES');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('BRANDING', 'OPERATIONS', 'STAFF', 'TRACKING', 'NOTIFICATIONS', 'BILLING', 'DONE');

-- CreateEnum
CREATE TYPE "TenantInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PlatformLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'TRIAL', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "PlatformLeadSource" AS ENUM ('DIRECT', 'CAMPAIGN', 'REFERRAL', 'SALES_OUTREACH');

-- CreateTable
CREATE TABLE "saas_plans" (
    "id" TEXT NOT NULL,
    "key" "SaasPlanType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saas_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_plan_prices" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTH',
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "setupFeeCents" INTEGER NOT NULL DEFAULT 0,
    "monthlyAmountCents" INTEGER NOT NULL,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "promoLabel" TEXT,
    "promoMonthlyAmountCents" INTEGER,
    "promoStartsAt" TIMESTAMP(3),
    "promoEndsAt" TIMESTAMP(3),
    "isFoundingOffer" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "SignupSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "planId" TEXT,
    "ownerFirstName" TEXT,
    "ownerLastName" TEXT,
    "ownerEmail" TEXT,
    "ownerPhone" TEXT,
    "ownerPasswordHash" TEXT,
    "companyDetails" JSONB,
    "stripeCheckoutSessionId" TEXT,
    "resultingTenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signup_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "setupFeeStatus" "SetupFeeStatus" NOT NULL DEFAULT 'PENDING',
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "gracePeriodEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_entitlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feature" "EntitlementFeature" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_onboarding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currentStep" "OnboardingStep" NOT NULL DEFAULT 'BRANDING',
    "brandingCompletedAt" TIMESTAMP(3),
    "operationsCompletedAt" TIMESTAMP(3),
    "staffInvitedAt" TIMESTAMP(3),
    "trackingCompletedAt" TIMESTAMP(3),
    "notificationsCompletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_invitations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "token" TEXT NOT NULL,
    "status" "TenantInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "tenant_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_leads" (
    "id" TEXT NOT NULL,
    "status" "PlatformLeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "PlatformLeadSource" NOT NULL DEFAULT 'DIRECT',
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "country" TEXT,
    "currentWorkflow" TEXT,
    "monthlyShipmentVolume" TEXT,
    "currentSoftware" TEXT,
    "servicesOffered" TEXT[],
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" TEXT NOT NULL,
    "platformAdminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetTenantId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saas_plans_key_key" ON "saas_plans"("key");

-- CreateIndex
CREATE INDEX "saas_plan_prices_planId_idx" ON "saas_plan_prices"("planId");

-- CreateIndex
CREATE INDEX "saas_plan_prices_planId_interval_isActive_idx" ON "saas_plan_prices"("planId", "interval", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "signup_sessions_token_key" ON "signup_sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "signup_sessions_stripeCheckoutSessionId_key" ON "signup_sessions"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "signup_sessions_status_idx" ON "signup_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_subscriptions_tenantId_key" ON "tenant_subscriptions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_subscriptions_stripeSubscriptionId_key" ON "tenant_subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "tenant_entitlements_tenantId_idx" ON "tenant_entitlements"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_entitlements_tenantId_feature_key" ON "tenant_entitlements"("tenantId", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_onboarding_tenantId_key" ON "tenant_onboarding"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invitations_token_key" ON "tenant_invitations"("token");

-- CreateIndex
CREATE INDEX "tenant_invitations_tenantId_idx" ON "tenant_invitations"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_invitations_token_idx" ON "tenant_invitations"("token");

-- CreateIndex
CREATE INDEX "platform_leads_status_idx" ON "platform_leads"("status");

-- CreateIndex
CREATE INDEX "platform_leads_createdAt_idx" ON "platform_leads"("createdAt");

-- CreateIndex
CREATE INDEX "platform_audit_logs_platformAdminUserId_idx" ON "platform_audit_logs"("platformAdminUserId");

-- CreateIndex
CREATE INDEX "platform_audit_logs_targetTenantId_idx" ON "platform_audit_logs"("targetTenantId");

-- AddForeignKey
ALTER TABLE "saas_plan_prices" ADD CONSTRAINT "saas_plan_prices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "saas_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_sessions" ADD CONSTRAINT "signup_sessions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "saas_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signup_sessions" ADD CONSTRAINT "signup_sessions_resultingTenantId_fkey" FOREIGN KEY ("resultingTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "saas_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_onboarding" ADD CONSTRAINT "tenant_onboarding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_platformAdminUserId_fkey" FOREIGN KEY ("platformAdminUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_targetTenantId_fkey" FOREIGN KEY ("targetTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

