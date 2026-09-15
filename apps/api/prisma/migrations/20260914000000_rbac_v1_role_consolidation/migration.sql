-- RBAC V1 (2026-09): collapse the 8-value granular tenant-staff taxonomy
-- (TENANT_OWNER/TENANT_ADMIN/WAREHOUSE_MANAGER/WAREHOUSE_STAFF/
-- CUSTOMER_SERVICE/ACCOUNTANT/DESTINATION_AGENT/DRIVER) into 4 tiers
-- (OWNER/MANAGER/STAFF/FINANCE). PLATFORM_ADMIN and CUSTOMER are unchanged.
--
-- Approved mapping (see packages/shared/src/enums.ts's UserRole doc comment
-- for the capability rationale behind each):
--   TENANT_OWNER, TENANT_ADMIN           -> OWNER
--   WAREHOUSE_MANAGER                    -> MANAGER
--   WAREHOUSE_STAFF, CUSTOMER_SERVICE,
--     DESTINATION_AGENT, DRIVER          -> STAFF
--   ACCOUNTANT                           -> FINANCE
--   PLATFORM_ADMIN, CUSTOMER             -> unchanged
--
-- Deliberately does NOT use `ALTER TYPE "UserRole" ADD VALUE` — Postgres
-- forbids using a newly-added enum value in the same transaction that adds
-- it, which would force this into 3 separate migrations. Instead this
-- creates a fresh enum type with only the final values, recasts both
-- columns through a `CASE` on the old value (text-cast, no ELSE branch —
-- an unmapped value fails the NOT NULL constraint loudly rather than
-- silently mismapping), then drops the old type and renames the new one
-- into place. Single migration, single transaction, safe for a live
-- `users`/`tenant_invitations` table.

CREATE TYPE "UserRole_new" AS ENUM ('PLATFORM_ADMIN', 'OWNER', 'MANAGER', 'STAFF', 'FINANCE', 'CUSTOMER');

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING (
    CASE "role"::text
      WHEN 'TENANT_OWNER' THEN 'OWNER'
      WHEN 'TENANT_ADMIN' THEN 'OWNER'
      WHEN 'WAREHOUSE_MANAGER' THEN 'MANAGER'
      WHEN 'WAREHOUSE_STAFF' THEN 'STAFF'
      WHEN 'CUSTOMER_SERVICE' THEN 'STAFF'
      WHEN 'DESTINATION_AGENT' THEN 'STAFF'
      WHEN 'DRIVER' THEN 'STAFF'
      WHEN 'ACCOUNTANT' THEN 'FINANCE'
      WHEN 'PLATFORM_ADMIN' THEN 'PLATFORM_ADMIN'
      WHEN 'CUSTOMER' THEN 'CUSTOMER'
    END
  )::"UserRole_new";

ALTER TABLE "tenant_invitations"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING (
    CASE "role"::text
      WHEN 'TENANT_OWNER' THEN 'OWNER'
      WHEN 'TENANT_ADMIN' THEN 'OWNER'
      WHEN 'WAREHOUSE_MANAGER' THEN 'MANAGER'
      WHEN 'WAREHOUSE_STAFF' THEN 'STAFF'
      WHEN 'CUSTOMER_SERVICE' THEN 'STAFF'
      WHEN 'DESTINATION_AGENT' THEN 'STAFF'
      WHEN 'DRIVER' THEN 'STAFF'
      WHEN 'ACCOUNTANT' THEN 'FINANCE'
      WHEN 'PLATFORM_ADMIN' THEN 'PLATFORM_ADMIN'
      WHEN 'CUSTOMER' THEN 'CUSTOMER'
    END
  )::"UserRole_new";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
