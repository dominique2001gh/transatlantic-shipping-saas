-- CreateEnum
CREATE TYPE "ShipmentItemCondition" AS ENUM ('GOOD', 'MINOR_DAMAGE', 'DAMAGED', 'REPACKAGED', 'OTHER');

-- CreateEnum
CREATE TYPE "ItemProcessingResult" AS ENUM ('READY', 'HOLD');

-- AlterTable
ALTER TABLE "shipment_items" ADD COLUMN     "lastInspectedAt" TIMESTAMP(3),
ADD COLUMN     "lastInspectedByUserId" TEXT,
DROP COLUMN "condition",
ADD COLUMN     "condition" "ShipmentItemCondition";

-- CreateTable
CREATE TABLE "item_inspections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "shipmentItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "weight" DECIMAL(10,2),
    "weightUnit" "WeightUnit",
    "length" DECIMAL(10,2),
    "width" DECIMAL(10,2),
    "height" DECIMAL(10,2),
    "dimensionUnit" "DimensionUnit",
    "condition" "ShipmentItemCondition" NOT NULL,
    "result" "ItemProcessingResult" NOT NULL,
    "hasException" BOOLEAN NOT NULL DEFAULT false,
    "exceptionDescription" TEXT,
    "notes" TEXT,
    "inspectedByUserId" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trackingEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_inspections_trackingEventId_key" ON "item_inspections"("trackingEventId");

-- CreateIndex
CREATE INDEX "item_inspections_tenantId_idx" ON "item_inspections"("tenantId");

-- CreateIndex
CREATE INDEX "item_inspections_shipmentId_idx" ON "item_inspections"("shipmentId");

-- CreateIndex
CREATE INDEX "item_inspections_shipmentItemId_idx" ON "item_inspections"("shipmentItemId");

-- CreateIndex
CREATE INDEX "item_inspections_warehouseId_idx" ON "item_inspections"("warehouseId");

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_lastInspectedByUserId_fkey" FOREIGN KEY ("lastInspectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_inspections" ADD CONSTRAINT "item_inspections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_inspections" ADD CONSTRAINT "item_inspections_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_inspections" ADD CONSTRAINT "item_inspections_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "shipment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_inspections" ADD CONSTRAINT "item_inspections_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_inspections" ADD CONSTRAINT "item_inspections_inspectedByUserId_fkey" FOREIGN KEY ("inspectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_inspections" ADD CONSTRAINT "item_inspections_trackingEventId_fkey" FOREIGN KEY ("trackingEventId") REFERENCES "tracking_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

