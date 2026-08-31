-- Stage 2C: allow the same email to hold independent User accounts at
-- different tenants (e.g. a CUSTOMER-role portal account). Email was
-- globally unique; it becomes unique per tenant instead. Verified via
-- `prisma migrate diff` against the live dev database before being written
-- here, and confirmed there are zero existing (tenantId, email) duplicates.

-- DropIndex
DROP INDEX "users_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");
