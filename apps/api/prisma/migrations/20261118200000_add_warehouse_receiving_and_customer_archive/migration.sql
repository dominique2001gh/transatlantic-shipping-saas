-- Warehouse Receiving Phase 1 / Package Consolidation Phase 2 / Customer Management Phase 3
-- Additive only: every new column is nullable or has a default; no existing
-- column is altered or dropped. Safe to run against a live database with
-- existing rows and zero backfill required.

-- CreateEnum
CREATE TYPE "ReceivingCarrier" AS ENUM ('UPS', 'USPS', 'FEDEX', 'DHL', 'OTHER');

-- CreateEnum
CREATE TYPE "ReceivingRecordStatus" AS ENUM ('AWAITING_CONSOLIDATION', 'PARTIALLY_CONSOLIDATED', 'FULLY_CONSOLIDATED', 'CANCELLED');

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "receivingRefPrefix" TEXT NOT NULL DEFAULT 'RCV',
ADD COLUMN     "receivingRefSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByUserId" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "receivingRecordId" TEXT;

-- CreateTable
CREATE TABLE "receiving_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "ReceivingRecordStatus" NOT NULL DEFAULT 'AWAITING_CONSOLIDATION',
    "carrier" "ReceivingCarrier" NOT NULL,
    "carrierOther" TEXT,
    "carrierTrackingNumber" TEXT,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "allocatedQuantity" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedByUserId" TEXT,
    "notes" TEXT,
    "internalReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receiving_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receivingRecordId" TEXT NOT NULL,
    "shipmentItemId" TEXT NOT NULL,
    "allocatedQuantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "consolidation_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receiving_records_tenantId_internalReference_key" ON "receiving_records"("tenantId", "internalReference");

-- CreateIndex
CREATE INDEX "receiving_records_tenantId_idx" ON "receiving_records"("tenantId");

-- CreateIndex
CREATE INDEX "receiving_records_tenantId_status_idx" ON "receiving_records"("tenantId", "status");

-- CreateIndex
CREATE INDEX "receiving_records_customerId_idx" ON "receiving_records"("customerId");

-- CreateIndex
CREATE INDEX "receiving_records_tenantId_carrier_carrierTrackingNumber_idx" ON "receiving_records"("tenantId", "carrier", "carrierTrackingNumber");

-- CreateIndex
CREATE INDEX "consolidation_allocations_tenantId_idx" ON "consolidation_allocations"("tenantId");

-- CreateIndex
CREATE INDEX "consolidation_allocations_receivingRecordId_idx" ON "consolidation_allocations"("receivingRecordId");

-- CreateIndex
CREATE INDEX "consolidation_allocations_shipmentItemId_idx" ON "consolidation_allocations"("shipmentItemId");

-- CreateIndex
CREATE INDEX "documents_receivingRecordId_idx" ON "documents"("receivingRecordId");

-- CreateIndex
CREATE INDEX "customers_tenantId_archivedAt_idx" ON "customers"("tenantId", "archivedAt");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_receivingRecordId_fkey" FOREIGN KEY ("receivingRecordId") REFERENCES "receiving_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_records" ADD CONSTRAINT "receiving_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_records" ADD CONSTRAINT "receiving_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_records" ADD CONSTRAINT "receiving_records_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_records" ADD CONSTRAINT "receiving_records_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_allocations" ADD CONSTRAINT "consolidation_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_allocations" ADD CONSTRAINT "consolidation_allocations_receivingRecordId_fkey" FOREIGN KEY ("receivingRecordId") REFERENCES "receiving_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_allocations" ADD CONSTRAINT "consolidation_allocations_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "shipment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_allocations" ADD CONSTRAINT "consolidation_allocations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
