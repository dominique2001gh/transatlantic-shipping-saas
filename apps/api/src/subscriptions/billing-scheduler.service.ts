import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AnanseLogix Phase 2: the real scheduled counterpart to
 * SubscriptionStatusGuard's lazy per-request PAST_DUE -> SUSPENDED check
 * (see that guard's own doc comment for why Phase 1 shipped the lazy-only
 * version — no scheduler infra existed yet in this codebase). Both exist
 * deliberately: this sweep means a tenant whose grace period lapses gets
 * suspended even if nobody at that tenant happens to make a request right
 * afterward (e.g. correct behavior for a platform admin's billing
 * dashboard, which shouldn't show a stale ACTIVE-looking status
 * indefinitely just because no one logged in); the guard's own check stays
 * as an immediate, always-correct backstop between sweeps (worst case, up
 * to one sweep interval of staleness — see EVERY_HOUR below) and — since
 * it re-checks unconditionally rather than trusting the read model — as
 * defense-in-depth if this job is ever delayed or fails to run.
 *
 * A single `updateMany` rather than a per-row loop: this only ever writes
 * a status enum + no other derived state (no cascading side effects like
 * TenantProvisioningService's transaction), so there is nothing here that
 * needs per-row application logic — the same "bulk operation with no
 * business logic per row" case a raw SQL-shaped update is meant for.
 */
@Injectable()
export class BillingSchedulerService {
  private readonly logger = new Logger(BillingSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpiredGracePeriods(): Promise<void> {
    const result = await this.prisma.tenantSubscription.updateMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        gracePeriodEndsAt: { lt: new Date() },
      },
      data: { status: SubscriptionStatus.SUSPENDED },
    });
    if (result.count > 0) {
      this.logger.log(`Suspended ${result.count} subscription(s) whose grace period expired.`);
    }
  }
}
