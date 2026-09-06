-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "aboutContent" TEXT,
ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "heroHeadline" TEXT,
ADD COLUMN     "heroSubheadline" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "serviceTypes" TEXT[],
ADD COLUMN     "tagline" TEXT;

-- CreateTable
CREATE TABLE "tenant_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "country" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_locations_tenantId_idx" ON "tenant_locations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_customDomain_key" ON "tenants"("customDomain");

-- AddForeignKey
ALTER TABLE "tenant_locations" ADD CONSTRAINT "tenant_locations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

