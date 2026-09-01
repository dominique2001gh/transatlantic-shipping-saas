-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'ONLINE');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerReference" TEXT,
ADD COLUMN     "source" "PaymentSource" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerReference_key" ON "payments"("providerReference");

