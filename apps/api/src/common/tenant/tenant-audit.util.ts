import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * RBAC tenant audit log (2026-10): the complete, closed set of actions
 * TenantAuditLog may record — see Phase A's approval of this as a small,
 * focused staff-activity log, not a general-purpose audit system. Never
 * written for a plain read (no GET-request noise).
 */
export type TenantAuditAction =
  | 'STAFF_INVITED'
  | 'STAFF_INVITATION_ACCEPTED'
  | 'ROLE_CHANGED'
  | 'STAFF_DEACTIVATED'
  | 'STAFF_REACTIVATED'
  | 'PERMISSIONS_CHANGED'
  | 'PERMISSIONS_MIGRATED_LEGACY'
  // Owner-managed staff administration (2026-10):
  | 'INVITATION_REVOKED'
  | 'STAFF_REMOVED'
  | 'STAFF_PASSWORD_RESET_TRIGGERED'
  // Warehouse Receiving Phase 1:
  | 'RECEIVING_RECORD_CREATED'
  | 'RECEIVING_RECORD_CORRECTED'
  | 'RECEIVING_RECORD_DUPLICATE_OVERRIDDEN'
  | 'RECEIVING_RECORD_CANCELLED'
  // Package Consolidation Phase 2:
  | 'CONSOLIDATION_CREATED'
  // Customer Management Phase 3:
  | 'CUSTOMER_UPDATED'
  | 'CUSTOMER_ARCHIVED'
  | 'CUSTOMER_RESTORED'
  | 'CUSTOMER_DELETED'
  // Shipment Editing Phase 4:
  | 'SHIPMENT_UPDATED';

export interface TenantAuditLogInput {
  tenantId: string;
  /** Null for a system-generated entry with no human actor (e.g. a self-service invitation acceptance, or the legacy backfill script). */
  actorUserId: string | null;
  /** Null when the action isn't about a specific other staff member. */
  targetUserId: string | null;
  action: TenantAuditAction;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Single call site for every TenantAuditLog write, so every caller writes
 * the same shape rather than re-typing `prisma.tenantAuditLog.create(...)`
 * (and its field names) at each of the half-dozen places Phase C adds one.
 * Accepts either the top-level PrismaService or a `$transaction` callback
 * client, since several call sites (permission/role changes) must write
 * their audit row in the same transaction as the mutation itself.
 */
export function writeTenantAuditLog(prisma: Pick<PrismaClient, 'tenantAuditLog'>, input: TenantAuditLogInput) {
  return prisma.tenantAuditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: input.action,
      metadata: input.metadata,
    },
  });
}
