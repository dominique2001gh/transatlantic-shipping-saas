-- AlterTable
ALTER TABLE "tenant_subscriptions" ALTER COLUMN "stripeCustomerId" DROP NOT NULL,
ALTER COLUMN "stripeSubscriptionId" DROP NOT NULL;

