import { Controller, Get, Logger, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { NotificationsService } from './notifications.service';
import { verifyMetaWebhookSignature } from './whatsapp-webhook-signature.util';

interface MetaStatusEntry {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { title?: string; message?: string }[];
}

interface MetaWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        statuses?: MetaStatusEntry[];
      };
    }[];
  }[];
}

const HANDLED_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

/**
 * WhatsApp Integration (Stage 4C) Phase 2: Meta's own required webhook
 * shape for the WhatsApp Cloud API — both routes live at exactly
 * `/webhooks/whatsapp`, matching Meta's convention of one callback URL
 * handling both the GET verification handshake and every POST event
 * delivery. Deliberately its own controller/file rather than added to
 * the existing WebhooksController (Stripe) — that file currently carries
 * unrelated in-progress AnanseLogix/Stripe changes; a new file keeps this
 * work cleanly isolated from that, with nothing to untangle later.
 *
 * @Public() on both routes is correct and deliberate (not an oversight —
 * see roles-guard-contract.e2e-spec.ts, which requires every route to
 * declare one of @Roles()/@Public()/@AnyAuthenticatedRole() explicitly):
 * Meta calls these completely unauthenticated. GET is protected by the
 * shared verify-token handshake; POST is protected by the HMAC signature
 * below.
 */
@Controller('webhooks')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Meta's standard hub.mode/hub.verify_token/hub.challenge handshake,
   * run once when a webhook is first configured (or re-verified) in the
   * Meta App Dashboard. `WHATSAPP_WEBHOOK_VERIFY_TOKEN` is a value WE
   * choose (not issued by Meta) and enter in both places — Railway and
   * the Meta dashboard's Callback URL field — so Meta can prove it's
   * calling the URL we actually configured. Never logs the token itself,
   * received or expected, only whether they matched.
   *
   * Uses raw query-string keys (`hub.mode`, not nested `hub: { mode }`)
   * because Express's default `qs` parser does not treat a literal dot in
   * a query key as nesting syntax (`allowDots` defaults to false) — this
   * is Meta's own documented, unmodifiable request shape, not something
   * this endpoint controls.
   */
  @Get('whatsapp')
  @Public()
  verifyWebhook(@Req() req: Request, @Res() res: Response): void {
    const mode = req.query['hub.mode'];
    const verifyToken = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expectedToken = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');

    if (expectedToken && mode === 'subscribe' && verifyToken === expectedToken) {
      res.status(200).send(challenge);
      return;
    }

    this.logger.warn('Rejected WhatsApp webhook verification attempt (mode/token mismatch or WHATSAPP_WEBHOOK_VERIFY_TOKEN not configured).');
    res.status(403).send('Forbidden');
  }

  /**
   * Every WhatsApp message-status change Meta delivers. Signature
   * verification uses `req.rawBody` (main.ts's global `rawBody: true`) —
   * the exact bytes Meta signed, never a JSON-parsed-then-reserialized
   * body, for the same reason StripeService.constructWebhookEvent
   * requires Stripe's raw body.
   *
   * If META_APP_SECRET isn't configured yet, this deliberately still
   * processes the callback (loudly logged as unverified) rather than
   * rejecting outright — Meta's own webhook setup/test screens require a
   * 200 response to complete configuration, and the worst case of
   * accepting an unsigned callback is low-impact (it can only move an
   * existing Notification row to READ/FAILED for a message id an
   * attacker would already have to know; it can never touch shipment,
   * customer, or payment data). Once META_APP_SECRET is set, an invalid
   * signature is a hard reject.
   *
   * Always returns 200 once past signature verification, even for a
   * payload with nothing this app recognizes — Meta retries indefinitely
   * on a non-2xx, which is the wrong behavior for "we don't act on this,"
   * exactly the same posture WebhooksController's Stripe handler
   * documents for its own unhandled event types.
   */
  @Post('whatsapp')
  @Public()
  async handleWebhook(@Req() req: RawBodyRequest<Request>, @Res() res: Response): Promise<void> {
    const appSecret = this.config.get<string>('META_APP_SECRET');
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (appSecret) {
      if (!req.rawBody || !verifyMetaWebhookSignature(req.rawBody, signature, appSecret)) {
        this.logger.warn('Rejected WhatsApp webhook with invalid or missing signature.');
        res.status(401).send({ received: false });
        return;
      }
    } else {
      this.logger.warn('META_APP_SECRET not configured — processing WhatsApp webhook WITHOUT signature verification.');
    }

    const payload = req.body as MetaWebhookPayload;
    await this.processPayload(payload);

    res.status(200).send({ received: true });
  }

  private async processPayload(payload: MetaWebhookPayload): Promise<void> {
    const configuredPhoneNumberId = this.config.get<string>('META_WHATSAPP_PHONE_NUMBER_ID');

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        // Defense in depth, not the primary safety mechanism (that's the
        // providerMessageId lookup in NotificationsService itself) — if
        // we know which phone number id we're configured to send from,
        // a callback for a different one is unexpected and worth a log,
        // but still safely ignored rather than treated as an error.
        if (configuredPhoneNumberId && value.metadata?.phone_number_id && value.metadata.phone_number_id !== configuredPhoneNumberId) {
          this.logger.warn(`WhatsApp webhook for an unrecognized phone_number_id — ignoring.`);
          continue;
        }

        for (const statusEntry of value.statuses ?? []) {
          await this.processStatusEntry(statusEntry);
        }
      }
    }
  }

  private async processStatusEntry(entry: MetaStatusEntry): Promise<void> {
    if (!entry.id || !entry.status || !HANDLED_STATUSES.has(entry.status)) {
      return;
    }
    const timestampSeconds = Number(entry.timestamp);
    if (!Number.isFinite(timestampSeconds)) {
      return;
    }
    const errorMessage = entry.errors?.[0]?.title ?? entry.errors?.[0]?.message;

    await this.notificationsService.updateWhatsAppStatusFromWebhook(
      entry.id,
      entry.status as 'sent' | 'delivered' | 'read' | 'failed',
      timestampSeconds,
      errorMessage,
    );
  }
}
