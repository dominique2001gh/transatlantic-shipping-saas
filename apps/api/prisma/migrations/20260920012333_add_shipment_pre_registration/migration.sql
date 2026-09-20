-- CreateEnum
CREATE TYPE "PreRegistrationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CONVERTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "preRegistrationNumberPrefix" TEXT NOT NULL DEFAULT 'PRE',
ADD COLUMN     "preRegistrationNumberSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "shipment_pre_registrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "PreRegistrationStatus" NOT NULL DEFAULT 'DRAFT',
    "referenceNumber" TEXT,
    "shipmentMode" "ShipmentMode",
    "destinationCountry" TEXT,
    "destinationLocation" TEXT,
    "itemType" "ShipmentItemType",
    "description" TEXT,
    "packageCount" INTEGER,
    "notes" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "recipientEmail" TEXT,
    "recipientAddressLine1" TEXT,
    "recipientAddressLine2" TEXT,
    "recipientCity" TEXT,
    "recipientState" TEXT,
    "recipientCountry" TEXT,
    "recipientPostalCode" TEXT,
    "convertedShipmentId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_pre_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_pre_registrations_convertedShipmentId_key" ON "shipment_pre_registrations"("convertedShipmentId");

-- CreateIndex
CREATE INDEX "shipment_pre_registrations_tenantId_idx" ON "shipment_pre_registrations"("tenantId");

-- CreateIndex
CREATE INDEX "shipment_pre_registrations_tenantId_status_idx" ON "shipment_pre_registrations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "shipment_pre_registrations_customerId_idx" ON "shipment_pre_registrations"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_pre_registrations_tenantId_referenceNumber_key" ON "shipment_pre_registrations"("tenantId", "referenceNumber");

-- AddForeignKey
ALTER TABLE "shipment_pre_registrations" ADD CONSTRAINT "shipment_pre_registrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_pre_registrations" ADD CONSTRAINT "shipment_pre_registrations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

