-- Staff invitation UI fix (2026-09): StaffInvitationsService.invite() does
-- an application-level check-then-create (existingLiveInvitation lookup,
-- then a separate create) with a real TOCTOU race window — two concurrent
-- requests for the same tenant+email (a double form submission, or two
-- genuinely simultaneous API calls) could both pass the check before
-- either commits, producing two live PENDING invitation rows for the same
-- person.
--
-- A plain `@@unique([tenantId, email])` would be wrong: a tenant may
-- legitimately accumulate multiple invitation rows for the same email
-- over time (one revoked, one expired, a new one now pending), so this is
-- a PARTIAL unique index scoped to PENDING rows only. Prisma's
-- schema.prisma has no declarative syntax for a WHERE-clause unique
-- constraint, so this migration is the sole source of truth for it —
-- schema.prisma intentionally does not (and cannot) redeclare it.
--
-- StaffInvitationsService.invite() catches this index's violation
-- (Prisma error code P2002) and translates it into the same
-- "already pending" BadRequestException the existing pre-check already
-- returns in the common (non-racing) case — this index is the authoritative
-- guarantee, the pre-check is just a fast, friendly-message shortcut.
CREATE UNIQUE INDEX "tenant_invitations_tenant_email_pending_key"
  ON "tenant_invitations" ("tenantId", "email")
  WHERE "status" = 'PENDING';
