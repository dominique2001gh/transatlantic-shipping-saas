import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AnanseLogix Phase 1: idempotency ledger for subscription-billing webhook
 * events — see StripeWebhookEvent's own schema doc comment for why this
 * exists alongside (not instead of) the existing domain-level unique
 * constraints. Checked first, before any business-row mutation;
 * `markProcessed` is called only *after* the corresponding handler
 * completes successfully — deliberately mark-after, not mark-before: if a
 * crash happens between the handler finishing and this call, the event
 * simply isn't marked yet, and Stripe's retry reprocesses it safely
 * (every downstream handler is independently idempotent). Marking
 * *before* processing would risk the opposite failure — a crash mid-
 * handler would falsely mark the event done, and Stripe's retry would be
 * silently dropped here forever.
 */
@Injectable()
export class StripeWebhookLedgerService {
  private readonly logger = new Logger(StripeWebhookLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async hasProcessed(eventId: string): Promise<boolean> {
    const existing = await this.prisma.stripeWebhookEvent.findUnique({ where: { id: eventId } });
    return !!existing;
  }

  async markProcessed(eventId: string, type: string): Promise<void> {
    try {
      await this.prisma.stripeWebhookEvent.create({ data: { id: eventId, type } });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        // Two concurrent deliveries of the same event both finished
        // processing before either could mark it — harmless, the
        // business-logic side was already idempotent for both.
        this.logger.log(`Webhook event ${eventId} was already marked processed by a concurrent delivery`);
        return;
      }
      throw err;
    }
  }
}
