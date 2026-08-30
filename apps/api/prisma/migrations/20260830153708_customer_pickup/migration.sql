-- CreateEnum
CREATE TYPE "HandoffType" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateTable
CREATE TABLE "pickup_delivery_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "shipmentItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "type" "HandoffType" NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT,
    "recipientIdReference" TEXT,
    "notes" TEXT,
    "driverUserId" TEXT,
    "handledByUserId" TEXT,
    "handledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trackingEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickup_delivery_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pickup_delivery_records_trackingEventId_key" ON "pickup_delivery_records"("trackingEventId");

-- CreateIndex
CREATE INDEX "pickup_delivery_records_tenantId_idx" ON "pickup_delivery_records"("tenantId");

-- CreateIndex
CREATE INDEX "pickup_delivery_records_shipmentId_idx" ON "pickup_delivery_records"("shipmentId");

-- CreateIndex
CREATE INDEX "pickup_delivery_records_shipmentItemId_idx" ON "pickup_delivery_records"("shipmentItemId");

-- CreateIndex
CREATE INDEX "pickup_delivery_records_warehouseId_idx" ON "pickup_delivery_records"("warehouseId");

-- AddForeignKey
ALTER TABLE "pickup_delivery_records" ADD CONSTRAINT "pickup_delivery_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_delivery_records" ADD CONSTRAINT "pickup_delivery_records_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_delivery_records" ADD CONSTRAINT "pickup_delivery_records_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "shipment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_delivery_records" ADD CONSTRAINT "pickup_delivery_records_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_delivery_records" ADD CONSTRAINT "pickup_delivery_records_handledByUserId_fkey" FOREIGN KEY ("handledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_delivery_records" ADD CONSTRAINT "pickup_delivery_records_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_delivery_records" ADD CONSTRAINT "pickup_delivery_records_trackingEventId_fkey" FOREIGN KEY ("trackingEventId") REFERENCES "tracking_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

