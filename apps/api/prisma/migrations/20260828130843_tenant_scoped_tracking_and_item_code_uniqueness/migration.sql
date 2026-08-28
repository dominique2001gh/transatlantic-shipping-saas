-- DropIndex
DROP INDEX "shipment_items_itemCode_key";

-- DropIndex
DROP INDEX "shipments_trackingNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "shipment_items_tenantId_itemCode_key" ON "shipment_items"("tenantId", "itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_tenantId_trackingNumber_key" ON "shipments"("tenantId", "trackingNumber");

