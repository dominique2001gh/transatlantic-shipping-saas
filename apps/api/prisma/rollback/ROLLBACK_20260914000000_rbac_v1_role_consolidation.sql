-- ============================================================================
-- EMERGENCY ROLLBACK for migration 20260914000000_rbac_v1_role_consolidation
-- ============================================================================
--
-- DO NOT RUN THIS AS PART OF NORMAL DEPLOYMENT. This file is deliberately
-- kept OUTSIDE apps/api/prisma/migrations/ so `prisma migrate deploy` never
-- discovers or auto-applies it — it is a manual, emergency-only script.
--
-- When to run this: ONLY if the 20260914000000_rbac_v1_role_consolidation
-- migration has already been applied to production, AND the application
-- deployment that is supposed to run against the new role values has
-- failed (build failure, crash-loop, or is otherwise not serving traffic
-- correctly) — i.e. production is left with the OLD application code
-- running against the NEW enum values, which is the exact broken
-- compatibility window this rollback exists to close. Do not run this
-- rollback for any other reason, and do not run it just because a manual
-- test found an unrelated bug.
--
-- What this does: the exact inverse of the forward migration, restoring
-- the original 10-value UserRole enum and mapping every row's role value
-- back to its pre-migration equivalent, using the same "create new type,
-- recast via CASE, drop, rename" pattern (never `ALTER TYPE ... ADD VALUE`,
-- for the identical same-transaction restriction the forward migration's
-- own comment explains).
--
-- Mapping fidelity: TENANT_ADMIN, CUSTOMER_SERVICE, DESTINATION_AGENT, and
-- DRIVER are recreated as valid enum values (so the restored type exactly
-- matches what production had before, and the old application code's own
-- UserRole references remain valid) but nothing is ever cast back to them
-- specifically — the pre-migration production snapshot
-- (pre-migration-snapshot-*.json, captured immediately before this
-- migration ran) confirmed zero rows used any of those four values, so
-- reversing OWNER->TENANT_OWNER and STAFF->WAREHOUSE_STAFF (rather than
-- guessing which of the several collapsed source roles each row "really"
-- came from) is lossless for every row that actually existed at
-- migration time. Any row created *after* the forward migration ran
-- (e.g. a new MANAGER hire) is handled by the MANAGER->WAREHOUSE_MANAGER
-- and FINANCE->ACCOUNTANT branches below.
--
-- After running this SQL, you MUST also reconcile Prisma's own migration
-- history so a future `prisma migrate deploy` doesn't think
-- 20260914000000/20260915000000 are still applied:
--   DELETE FROM "_prisma_migrations" WHERE migration_name IN
--     ('20260914000000_rbac_v1_role_consolidation',
--      '20260915000000_tenant_invitation_pending_unique');
-- (The partial unique index from 20260915000000 is harmless to leave in
-- place even after this rollback — it only constrains PENDING invitation
-- rows and does not reference the enum at all — but removing its history
-- row too keeps `prisma migrate status` accurate if you decide to also
-- drop the index. Dropping the index itself, if desired:
--   DROP INDEX IF EXISTS "tenant_invitations_tenant_email_pending_key";
-- )
--
-- Then redeploy the OLD (pre-RBAC-milestone) application code to match.

CREATE TYPE "UserRole_rollback" AS ENUM (
  'PLATFORM_ADMIN',
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'WAREHOUSE_MANAGER',
  'WAREHOUSE_STAFF',
  'CUSTOMER_SERVICE',
  'ACCOUNTANT',
  'DESTINATION_AGENT',
  'DRIVER',
  'CUSTOMER'
);

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole_rollback"
  USING (
    CASE "role"::text
      WHEN 'OWNER' THEN 'TENANT_OWNER'
      WHEN 'MANAGER' THEN 'WAREHOUSE_MANAGER'
      WHEN 'STAFF' THEN 'WAREHOUSE_STAFF'
      WHEN 'FINANCE' THEN 'ACCOUNTANT'
      WHEN 'PLATFORM_ADMIN' THEN 'PLATFORM_ADMIN'
      WHEN 'CUSTOMER' THEN 'CUSTOMER'
    END
  )::"UserRole_rollback";

ALTER TABLE "tenant_invitations"
  ALTER COLUMN "role" TYPE "UserRole_rollback"
  USING (
    CASE "role"::text
      WHEN 'OWNER' THEN 'TENANT_OWNER'
      WHEN 'MANAGER' THEN 'WAREHOUSE_MANAGER'
      WHEN 'STAFF' THEN 'WAREHOUSE_STAFF'
      WHEN 'FINANCE' THEN 'ACCOUNTANT'
      WHEN 'PLATFORM_ADMIN' THEN 'PLATFORM_ADMIN'
      WHEN 'CUSTOMER' THEN 'CUSTOMER'
    END
  )::"UserRole_rollback";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_rollback" RENAME TO "UserRole";
