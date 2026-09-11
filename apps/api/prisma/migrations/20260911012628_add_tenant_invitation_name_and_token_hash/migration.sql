-- DropIndex
DROP INDEX "tenant_invitations_token_idx";

-- DropIndex
DROP INDEX "tenant_invitations_token_key";

-- AlterTable
ALTER TABLE "tenant_invitations" DROP COLUMN "token",
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invitations_tokenHash_key" ON "tenant_invitations"("tokenHash");

