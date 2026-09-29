import { Controller, Logger, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeToE164 } from './phone-normalization.util';
import { verifyTwilioWebhookSignature } from './twilio-webhook-signature.util';

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);
const HELP_KEYWORDS = new Set(['HELP', 'INFO']);

const STOP_REPLY = 'You have been unsubscribed from shipment SMS updates and will not receive further texts from this number. Reply START to resubscribe.';
const START_REPLY = 'You are resubscribed to shipment SMS updates from this number.';
const HELP_REPLY = 'This number sends shipment tracking updates on behalf of your shipping company. Reply STOP to unsubscribe. Msg & data rates may apply.';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function twiml(message?: string): string {
  return message ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>` : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

/**
 * Reconstructs the exact URL Twilio was configured to call, for signature
 * verification (see twilio-webhook-signature.util.ts's own doc comment on
 * why this must match byte-for-byte). Prefers the `X-Forwarded-*` headers
 * Railway's edge proxy sets (this API has no `app.set('trust proxy', ...)`
 * configured, so `req.protocol` alone would report "http" even though the
 * real inbound request was https) — falls back to `req.protocol`/
 * `req.headers.host` for any environment that isn't behind that proxy.
 */
function reconstructRequestUrl(req: Request): string {
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || (req.headers.host as string | undefined) || '';
  return `${protocol}://${host}${req.originalUrl}`;
}

/**
 * SMS/Twilio A2P Phase 1: inbound STOP/START/HELP handling — the compliance
 * counterpart to TwilioSmsProvider's outbound send. Deliberately its own
 * controller/file, mirroring WhatsAppWebhookController's own precedent
 * (same "unrelated in-progress work stays untouched" reasoning that file's
 * doc comment already gives for not extending the Stripe WebhooksController).
 *
 * Not wired to any outbound send path yet — Phase 1 is compliance
 * infrastructure only (see this phase's own scope notes). What this
 * controller guarantees today: an inbound STOP is durably recorded in
 * SmsOptOut (global, cross-tenant — see that model's own doc comment for
 * why) and mirrored onto every tenant's own Customer.notifyBySms for UI
 * accuracy. A future Phase 2 send path is responsible for actually
 * consulting SmsOptOut before every send; this controller only guarantees
 * the record exists.
 *
 * @Public() is correct and deliberate (see roles-guard-contract.e2e-
 * spec.ts) — Twilio calls this completely unauthenticated; the signature
 * check below is the actual authentication.
 */
@Controller('webhooks')
export class TwilioWebhookController {
  private readonly logger = new Logger(TwilioWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Always returns a 200 with well-formed (possibly empty) TwiML, even on
   * an internal error — Twilio retries indefinitely on a non-2xx, which is
   * the wrong behavior here, same posture WhatsAppWebhookController and
   * WebhooksController's own unhandled-event paths already document. A
   * failure in this handler can only ever affect SmsOptOut/Customer rows;
   * it has no code path that touches shipment/warehouse operations at all,
   * so a webhook failure can never affect shipment scanning by
   * construction, not just by convention.
   */
  @Post('twilio-sms')
  @Public()
  async handleInboundSms(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.set('Content-Type', 'text/xml');

    try {
      const body = (req.body ?? {}) as Record<string, string>;
      const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
      const signature = req.headers['x-twilio-signature'] as string | undefined;

      if (authToken) {
        const url = reconstructRequestUrl(req);
        if (!verifyTwilioWebhookSignature(authToken, url, body, signature)) {
          this.logger.warn('Rejected inbound Twilio SMS webhook with invalid or missing signature.');
          res.status(403).send(twiml());
          return;
        }
      } else {
        this.logger.warn('TWILIO_AUTH_TOKEN not configured — processing inbound Twilio SMS webhook WITHOUT signature verification.');
      }

      const from = body.From;
      const rawKeyword = (body.Body ?? '').trim().toUpperCase();

      if (!from) {
        res.status(200).send(twiml());
        return;
      }

      const phoneE164 = normalizeToE164(from) ?? from;

      if (STOP_KEYWORDS.has(rawKeyword)) {
        await this.recordOptOut(phoneE164);
        res.status(200).send(twiml(STOP_REPLY));
        return;
      }

      if (START_KEYWORDS.has(rawKeyword)) {
        await this.clearOptOut(phoneE164);
        res.status(200).send(twiml(START_REPLY));
        return;
      }

      if (HELP_KEYWORDS.has(rawKeyword)) {
        res.status(200).send(twiml(HELP_REPLY));
        return;
      }

      // Any other inbound message: no state change, no auto-reply required.
      res.status(200).send(twiml());
    } catch (err) {
      this.logger.error(`Inbound Twilio SMS webhook failed: ${err instanceof Error ? err.message : String(err)}`);
      res.status(200).send(twiml());
    }
  }

  /**
   * The global enforcement record (see SmsOptOut's own doc comment — never
   * tenant-scoped, since every tenant shares one Twilio sending number),
   * plus a best-effort mirror onto every tenant's own Customer row sharing
   * this phone number, purely so that tenant's own staff/portal views
   * accurately reflect "this customer cannot receive SMS" rather than
   * showing a stale `notifyBySms: true` that can never actually be
   * honored. The mirror step is wrapped separately so a failure there
   * (e.g. an unexpected phone format on some legacy row) can never
   * prevent the actual opt-out record from being written.
   */
  private async recordOptOut(phoneE164: string): Promise<void> {
    await this.prisma.smsOptOut.upsert({
      where: { phoneE164 },
      create: { phoneE164, source: 'twilio_stop_webhook' },
      update: { optedOutAt: new Date(), source: 'twilio_stop_webhook' },
    });

    try {
      const matchingCustomerIds = await this.findCustomerIdsByPhone(phoneE164);
      if (matchingCustomerIds.length > 0) {
        await this.prisma.customer.updateMany({
          where: { id: { in: matchingCustomerIds } },
          data: { notifyBySms: false, smsOptOutAt: new Date() },
        });
      }
    } catch (err) {
      this.logger.warn(`STOP recorded in SmsOptOut, but mirroring onto Customer rows failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Removes the global block only. Deliberately does NOT restore
   * `Customer.notifyBySms` on any tenant's row — resuming real shipment
   * SMS should go back through an explicit, disclosure-shown consent
   * action (the registration form or a future portal flow), not be
   * silently re-enabled by a text message alone. See this phase's own
   * report for the reasoning.
   */
  private async clearOptOut(phoneE164: string): Promise<void> {
    await this.prisma.smsOptOut.deleteMany({ where: { phoneE164 } });
  }

  /**
   * Cross-tenant by design (see SmsOptOut's own doc comment) — fetches
   * every Customer row with a phone number at all, normalizes each to
   * E.164 in-memory, and returns the ids that match. A full-table
   * normalize-and-compare (rather than a SQL-level match) is deliberate:
   * `Customer.phone` is stored in whatever raw format staff/customers
   * entered it in, so an exact-string WHERE clause would miss equivalent
   * numbers in different formats. Acceptable at this platform's current
   * customer-table scale; would need revisiting (e.g. a normalized column)
   * if that scale changes materially.
   */
  private async findCustomerIdsByPhone(phoneE164: string): Promise<string[]> {
    const candidates = await this.prisma.customer.findMany({
      where: { phone: { not: null } },
      select: { id: true, phone: true },
    });
    return candidates.filter((c) => normalizeToE164(c.phone) === phoneE164).map((c) => c.id);
  }
}
