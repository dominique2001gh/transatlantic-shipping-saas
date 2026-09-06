-- AlterTable
ALTER TABLE "saas_plan_prices" ADD COLUMN     "promoIsActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promoMaxRedemptions" INTEGER,
ADD COLUMN     "promoRedemptionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promoSetupFeeCents" INTEGER;

-- AlterTable
ALTER TABLE "tenant_subscriptions" ADD COLUMN     "priceId" TEXT;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "saas_plan_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

