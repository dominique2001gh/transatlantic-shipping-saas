-- AlterEnum
ALTER TYPE "EntitlementFeature" ADD VALUE 'PUBLIC_AI_AGENT';

-- CreateEnum
CREATE TYPE "TenantAgentKnowledgeKind" AS ENUM ('FACT', 'FAQ');

-- CreateTable
CREATE TABLE "tenant_agent_knowledge_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "TenantAgentKnowledgeKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_agent_knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_agent_knowledge_entries_tenantId_idx" ON "tenant_agent_knowledge_entries"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_agent_knowledge_entries_tenantId_isActive_idx" ON "tenant_agent_knowledge_entries"("tenantId", "isActive");

-- AddForeignKey
ALTER TABLE "tenant_agent_knowledge_entries" ADD CONSTRAINT "tenant_agent_knowledge_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
