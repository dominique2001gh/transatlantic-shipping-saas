-- AlterEnum
ALTER TYPE "ManifestStatus" ADD VALUE 'ARRIVED';

-- AlterTable
ALTER TABLE "manifests" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "arrivedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_arrivedByUserId_fkey" FOREIGN KEY ("arrivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

