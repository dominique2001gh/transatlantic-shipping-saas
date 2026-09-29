-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "smsConsentAt" TIMESTAMP(3),
ADD COLUMN     "smsConsentGiven" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsConsentSource" TEXT,
ADD COLUMN     "smsConsentVersion" TEXT,
ADD COLUMN     "smsOptOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sms_opt_outs" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "optedOutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_opt_outs_phoneE164_key" ON "sms_opt_outs"("phoneE164");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

