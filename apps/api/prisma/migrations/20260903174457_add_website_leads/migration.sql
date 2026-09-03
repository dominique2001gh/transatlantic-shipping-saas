-- CreateEnum
CREATE TYPE "WebsiteLeadType" AS ENUM ('QUOTE_REQUEST', 'CONTACT');

-- CreateEnum
CREATE TYPE "WebsiteLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- CreateTable
CREATE TABLE "website_leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "WebsiteLeadType" NOT NULL,
    "status" "WebsiteLeadStatus" NOT NULL DEFAULT 'NEW',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT,
    "quoteDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "website_leads_tenantId_idx" ON "website_leads"("tenantId");

-- CreateIndex
CREATE INDEX "website_leads_tenantId_status_idx" ON "website_leads"("tenantId", "status");

-- CreateIndex
CREATE INDEX "website_leads_tenantId_createdAt_idx" ON "website_leads"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "website_leads" ADD CONSTRAINT "website_leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

