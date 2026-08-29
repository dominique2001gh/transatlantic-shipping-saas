-- AlterEnum
ALTER TYPE "ManifestStatus" ADD VALUE 'DEPARTED';

-- AlterEnum
ALTER TYPE "ShipmentItemStatus" ADD VALUE 'ASSIGNED_TO_MANIFEST';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TrackingEventType" ADD VALUE 'ASSIGNED_TO_MANIFEST';
ALTER TYPE "TrackingEventType" ADD VALUE 'REMOVED_FROM_MANIFEST';

-- DropForeignKey
ALTER TABLE "manifests" DROP CONSTRAINT "manifests_containerId_fkey";

-- AlterTable
ALTER TABLE "containers" ADD COLUMN     "manifestId" TEXT;

-- AlterTable
ALTER TABLE "manifests" DROP COLUMN "containerId",
ADD COLUMN     "carrierName" TEXT,
ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "departedByUserId" TEXT,
ADD COLUMN     "destinationLocation" TEXT,
ADD COLUMN     "estimatedArrivalAt" TIMESTAMP(3),
ADD COLUMN     "flightNumber" TEXT,
ADD COLUMN     "originLocation" TEXT,
ADD COLUMN     "originWarehouseId" TEXT,
ADD COLUMN     "plannedDepartureAt" TIMESTAMP(3),
ADD COLUMN     "shipmentMode" "ShipmentMode" NOT NULL,
ADD COLUMN     "vesselName" TEXT,
ADD COLUMN     "voyageNumber" TEXT;

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "manifestNumberPrefix" TEXT NOT NULL DEFAULT 'MAN',
ADD COLUMN     "manifestNumberSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "manifest_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "shipmentItemId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByUserId" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedByUserId" TEXT,
    "removalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manifest_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manifest_items_tenantId_idx" ON "manifest_items"("tenantId");

-- CreateIndex
CREATE INDEX "manifest_items_manifestId_idx" ON "manifest_items"("manifestId");

-- CreateIndex
CREATE INDEX "manifest_items_shipmentId_idx" ON "manifest_items"("shipmentId");

-- CreateIndex
CREATE INDEX "manifest_items_shipmentItemId_idx" ON "manifest_items"("shipmentItemId");

-- CreateIndex
CREATE INDEX "containers_manifestId_idx" ON "containers"("manifestId");

-- CreateIndex
CREATE INDEX "manifests_originWarehouseId_idx" ON "manifests"("originWarehouseId");

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "manifests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_originWarehouseId_fkey" FOREIGN KEY ("originWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_departedByUserId_fkey" FOREIGN KEY ("departedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_items" ADD CONSTRAINT "manifest_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_items" ADD CONSTRAINT "manifest_items_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "manifests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_items" ADD CONSTRAINT "manifest_items_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_items" ADD CONSTRAINT "manifest_items_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "shipment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_items" ADD CONSTRAINT "manifest_items_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_items" ADD CONSTRAINT "manifest_items_removedByUserId_fkey" FOREIGN KEY ("removedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

