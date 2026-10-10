-- Owner-managed staff administration (2026-10): "Remove" is a tenant-
-- reversible-via-reinvite alternative to deleting a User row outright —
-- it preserves every historical shipment/warehouse/audit record that FKs
-- to this exact user id (those FKs are onDelete: SetNull, which would
-- otherwise silently erase "who did this" on a hard delete).
ALTER TABLE "users" ADD COLUMN "removedAt" TIMESTAMP(3);

-- The previous unconditional unique index blocked ever re-inviting
-- someone at the same email once their row existed, even fully
-- deactivated — a removed row must free its email for a brand new
-- invitation while the old row (and its history) stays exactly where it
-- is. Mirrors the TenantInvitation PENDING-only partial unique index
-- precedent exactly (migration 20260915000000): schema.prisma cannot
-- declare a WHERE-clause unique constraint, so this migration is this
-- index's sole source of truth — schema.prisma intentionally does not
-- (and cannot) redeclare it.
DROP INDEX "users_tenantId_email_key";
CREATE UNIQUE INDEX "users_tenantId_email_active_key" ON "users" ("tenantId", "email") WHERE "removedAt" IS NULL;

-- CreateIndex (plain, non-unique — findFirst/findMany by tenantId+email
-- still needs an index now that the unique one is conditional)
CREATE INDEX "users_tenantId_email_idx" ON "users"("tenantId", "email");
