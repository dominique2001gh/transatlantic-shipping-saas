-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('SHIPMENT_STATUS_CHANGED', 'DOCUMENT_VISIBLE', 'INVOICE_ISSUED', 'PAYMENT_RECEIVED', 'CONTAINER_DISRUPTED', 'STAFF_ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "DisruptionType" AS ENUM ('DELAYED', 'HELD', 'INSPECTED', 'IMPOUNDED', 'OTHER');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "notifyByEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyBySms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyByWhatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappPhone" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "providerMessageId" TEXT;

-- CreateTable
CREATE TABLE "operational_exceptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "containerId" TEXT,
    "manifestId" TEXT,
    "type" "DisruptionType" NOT NULL,
    "message" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "shipmentId" TEXT,
    "documentId" TEXT,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "operationalExceptionId" TEXT,
    "dedupeKey" TEXT,
    "title" TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operational_exceptions_tenantId_idx" ON "operational_exceptions"("tenantId");

-- CreateIndex
CREATE INDEX "operational_exceptions_containerId_idx" ON "operational_exceptions"("containerId");

-- CreateIndex
CREATE INDEX "operational_exceptions_manifestId_idx" ON "operational_exceptions"("manifestId");

-- CreateIndex
CREATE INDEX "notification_events_tenantId_idx" ON "notification_events"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_tenantId_dedupeKey_key" ON "notification_events"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_customerId_idx" ON "notifications"("customerId");

-- CreateIndex
CREATE INDEX "notifications_eventId_idx" ON "notifications"("eventId");

-- AddForeignKey
ALTER TABLE "operational_exceptions" ADD CONSTRAINT "operational_exceptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_exceptions" ADD CONSTRAINT "operational_exceptions_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_exceptions" ADD CONSTRAINT "operational_exceptions_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "manifests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_exceptions" ADD CONSTRAINT "operational_exceptions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_operationalExceptionId_fkey" FOREIGN KEY ("operationalExceptionId") REFERENCES "operational_exceptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "notification_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

