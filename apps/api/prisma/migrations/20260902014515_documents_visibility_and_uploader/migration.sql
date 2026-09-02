-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'MANIFEST';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "description" TEXT,
ADD COLUMN     "visibleToCustomer" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "documents_customerId_idx" ON "documents"("customerId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

