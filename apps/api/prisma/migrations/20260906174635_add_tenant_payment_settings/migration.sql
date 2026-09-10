-- CreateTable
CREATE TABLE "tenant_payment_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stripeConnectedAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_payment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_payment_settings_tenantId_key" ON "tenant_payment_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_payment_settings_stripeConnectedAccountId_key" ON "tenant_payment_settings"("stripeConnectedAccountId");

-- AddForeignKey
ALTER TABLE "tenant_payment_settings" ADD CONSTRAINT "tenant_payment_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
