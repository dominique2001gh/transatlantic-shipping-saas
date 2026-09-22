-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'CASH_APP';
ALTER TYPE "PaymentMethod" ADD VALUE 'ZELLE';

-- CreateTable
CREATE TABLE "tenant_payment_method_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_payment_method_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_payment_method_configs_tenantId_idx" ON "tenant_payment_method_configs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_payment_method_configs_tenantId_method_key" ON "tenant_payment_method_configs"("tenantId", "method");

-- AddForeignKey
ALTER TABLE "tenant_payment_method_configs" ADD CONSTRAINT "tenant_payment_method_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
