-- AlterEnum
ALTER TYPE "HandoffType" ADD VALUE 'DISPATCH';

-- AlterEnum
ALTER TYPE "TrackingEventType" ADD VALUE 'RETURNED_TO_WAREHOUSE';

-- AlterTable
ALTER TABLE "pickup_delivery_records" ADD COLUMN     "courierName" TEXT,
ADD COLUMN     "courierPhone" TEXT,
ADD COLUMN     "courierReference" TEXT,
ADD COLUMN     "deliveryAddress" TEXT;

