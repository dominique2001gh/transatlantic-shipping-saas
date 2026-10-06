/**
 * RBAC permissions legacy backfill (2026-10) — ONE-TIME, idempotent.
 *
 * Every User row created BEFORE the `add_rbac_permissions_and_audit_log`
 * migration applied predates fine-grained permissions entirely; its
 * *real* current access has only ever been determined by `role` via the
 * existing `*_ROLES` tier constants. This script makes that implicit
 * access explicit by writing a concrete `permissions` array matching
 * exactly what that role already grants today (see
 * `legacyRolePermissions` in packages/shared/src/permissions.ts) — so
 * no existing staff member's access changes by one bit when permission
 * enforcement (Phase C) goes live.
 *
 * Scope is deliberately bounded to rows that predate the migration
 * itself (`createdAt < <this migration's finished_at>`, read from
 * `_prisma_migrations` directly, not a hand-maintained date constant) —
 * a staff member invited *after* RBAC shipped, through the new
 * invite-with-permissions flow, may legitimately have been granted an
 * intentionally empty `permissions: []` ("no optional permissions"),
 * and this script must never "fix" that into something broader. This is
 * also why the script only ever touches a row whose `permissions` is
 * still exactly `[]` — once a row has been touched by anything (this
 * script, or real permission customization), it's left alone, making
 * every run after the first a safe no-op.
 *
 * OWNER rows are included too, for display/audit completeness only —
 * OWNER is never actually limited by `permissions` (PermissionsGuard
 * always allows OWNER), so this never changes real OWNER access either.
 *
 * Run locally or against production:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-rbac-permissions.ts
 * (from apps/api). Add --dry-run to only print what would change.
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { legacyRolePermissions } from '@transatlantic/shared';
import type { UserRole as SharedUserRole } from '@transatlantic/shared';

const prisma = new PrismaClient();

const MIGRATION_NAME = '20261005174405_add_rbac_permissions_and_audit_log';
const BACKFILLABLE_ROLES: UserRole[] = [UserRole.OWNER, UserRole.MANAGER, UserRole.STAFF, UserRole.FINANCE];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const migration = await prisma.$queryRaw<{ finished_at: Date | null }[]>`
    SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = ${MIGRATION_NAME} LIMIT 1
  `;
  const cutoff = migration[0]?.finished_at;
  if (!cutoff) {
    throw new Error(
      `Could not find an applied "${MIGRATION_NAME}" migration row — refusing to guess a cutoff. Run "prisma migrate deploy" first.`,
    );
  }
  console.log(`Legacy cutoff (migration applied at): ${cutoff.toISOString()}`);

  const candidates = await prisma.user.findMany({
    where: {
      role: { in: BACKFILLABLE_ROLES },
      createdAt: { lt: cutoff },
      permissions: { isEmpty: true },
    },
    select: { id: true, tenantId: true, role: true, email: true, createdAt: true },
  });

  console.log(`Found ${candidates.length} pre-RBAC staff row(s) with empty permissions to backfill.`);

  let updated = 0;
  for (const user of candidates) {
    // Prisma's generated UserRole and @transatlantic/shared's hand-written
    // one are structurally identical string unions but nominally distinct
    // TS types — same cross-package friction RolesGuard's own doc comment
    // describes; a cast is the established fix elsewhere in this codebase.
    const permissions = legacyRolePermissions(user.role as unknown as SharedUserRole);
    console.log(`${dryRun ? '[dry-run] would set' : 'setting'} ${user.email} (${user.role}) -> [${permissions.join(', ')}]`);

    if (dryRun) continue;

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { permissions } }),
      prisma.tenantAuditLog.create({
        data: {
          tenantId: user.tenantId!,
          actorUserId: null, // system-generated — no human actor for a rollout backfill
          targetUserId: user.id,
          action: 'PERMISSIONS_MIGRATED_LEGACY',
          metadata: { role: user.role, permissionsGranted: permissions },
        },
      }),
    ]);
    updated++;
  }

  console.log(dryRun ? `[dry-run] would update ${candidates.length} row(s).` : `Updated ${updated} row(s).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
