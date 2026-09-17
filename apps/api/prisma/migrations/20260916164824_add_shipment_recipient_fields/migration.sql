-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "recipientAddressLine1" TEXT,
ADD COLUMN     "recipientAddressLine2" TEXT,
ADD COLUMN     "recipientCity" TEXT,
ADD COLUMN     "recipientCountry" TEXT,
ADD COLUMN     "recipientEmail" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "recipientPhone" TEXT,
ADD COLUMN     "recipientPostalCode" TEXT,
ADD COLUMN     "recipientState" TEXT;

