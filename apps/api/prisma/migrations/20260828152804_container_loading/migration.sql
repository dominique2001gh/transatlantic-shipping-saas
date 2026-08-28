-- AlterTable
ALTER TABLE "containers" ADD COLUMN     "loadingFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "loadingFinalizedByUserId" TEXT,
ADD COLUMN     "routeId" TEXT,
ADD COLUMN     "warehouseId" TEXT;

-- CreateIndex
CREATE INDEX "containers_warehouseId_idx" ON "containers"("warehouseId");

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_loadingFinalizedByUserId_fkey" FOREIGN KEY ("loadingFinalizedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

