-- Stage 3B: optional staff-entered note on a manually-recorded payment.
-- Additive, nullable column on an empty table (payments has 0 rows as of
-- this migration) — verified via `prisma migrate diff` against the live
-- dev database before being written here.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "notes" TEXT;
