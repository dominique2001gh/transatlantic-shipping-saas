import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProviderSendResult, WhatsAppProvider } from './provider.types';

const GRAPH_API_DEFAULT_VERSION = 'v21.0';

/**
 * WhatsApp Integration (Stage 4C) Phase 1: real delivery via Meta's
 * WhatsApp Cloud API (Graph API `POST /{PHONE_NUMBER_ID}/messages`), using
 * the platform's native `fetch` — same "no SDK for one HTTP call"
 * reasoning as ResendEmailProvider/AnthropicPublicAgentProvider.
 *
 * Template-only, deliberately: a shipment status update is always a
 * business-initiated message outside any customer-started conversation
 * window, which Meta will only deliver via a pre-approved Message
 * Template (see whatsapp-template.util.ts). `send()` treats a missing
 * `template` as a configuration error rather than attempting a freeform
 * text send Meta would reject anyway — callers (NotificationsService)
 * are structured to only ever call this with a template already built
 * for a supported milestone; reaching this branch means something
 * upstream skipped that check, not that a freeform fallback is safe.
 *
 * Credentials are read lazily (see ResendEmailProvider/R2StorageProvider's
 * own doc comments for why: NotificationProvidersModule-style factories
 * construct every provider eagerly regardless of which one is actually
 * selected by env var, so reading these in the constructor would break
 * any environment that doesn't set them, including local dev/test where
 * WHATSAPP_PROVIDER stays "console").
 *
 * `tenantId` is accepted on every send but not yet used to select
 * different credentials — Trans Atlantic's pilot deliberately stays on
 * one platform-level Meta WhatsApp Business Account (env vars below).
 * The seam for a future per-tenant-account phase is exactly this
 * parameter plus this class's own `credentials` getter: that phase would
 * look up a TenantWhatsAppConfig row by `tenantId` here and fall back to
 * these same platform env vars when a tenant hasn't connected their own
 * account yet — no interface change, no caller change, no rebuild.
 */
@Injectable()
export class MetaWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger('WhatsAppProvider(meta)');
  private cachedCredentials: { accessToken: string; phoneNumberId: string } | undefined;

  constructor(private readonly config: ConfigService) {}

  async send(params: {
    to: string;
    body: string;
    template?: { name: string; language: string; params: string[] };
    tenantId: string;
  }): Promise<ProviderSendResult> {
    if (!params.template) {
      this.logger.error(
        `Refusing to send a freeform WhatsApp message to ${params.to} — Meta only accepts approved templates ` +
          `for business-initiated messages. This indicates a caller bug upstream (NotificationsService should ` +
          `never call MetaWhatsAppProvider without a template).`,
      );
      return { success: false, errorMessage: 'No approved WhatsApp template supplied for this message.' };
    }

    const credentials = this.credentials;
    if (!credentials) {
      const message = 'WhatsApp is not configured yet (missing META_WHATSAPP_ACCESS_TOKEN/META_WHATSAPP_PHONE_NUMBER_ID).';
      this.logger.error(message);
      return { success: false, errorMessage: message };
    }
    const { accessToken, phoneNumberId } = credentials;
    const apiVersion = this.config.get<string>('META_WHATSAPP_API_VERSION', GRAPH_API_DEFAULT_VERSION);

    try {
      const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: params.to,
          type: 'template',
          template: {
            name: params.template.name,
            language: { code: params.template.language },
            components: [
              {
                type: 'body',
                parameters: params.template.params.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number };
      };

      if (!res.ok) {
        const message = data.error?.message ?? `Meta WhatsApp API responded with ${res.status}`;
        this.logger.error(`Meta WhatsApp send failed (${res.status}): ${message}`);
        return { success: false, errorMessage: message };
      }

      return { success: true, providerMessageId: data.messages?.[0]?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Meta WhatsApp send threw: ${message}`);
      return { success: false, errorMessage: message };
    }
  }

  /**
   * Returns `null` rather than throwing when unset — a missing/incomplete
   * config is ordinary data for `send()` to turn into a graceful
   * `{ success: false }` result (and, upstream, a FAILED Notification row
   * with a clear reason), never an uncaught rejection. Matches
   * ResendEmailProvider's non-throwing contract exactly, unlike that
   * provider's own `apiKey` getter (which does throw) — the difference is
   * deliberate: a missing Resend key is a genuine misconfiguration of an
   * already-in-production channel, while WhatsApp is expected to run
   * without real credentials configured for a while yet (this exact
   * phase), and every attempted send should still show up cleanly in
   * notification history rather than only in application logs.
   */
  private get credentials(): { accessToken: string; phoneNumberId: string } | null {
    if (!this.cachedCredentials) {
      const accessToken = this.config.get<string>('META_WHATSAPP_ACCESS_TOKEN');
      const phoneNumberId = this.config.get<string>('META_WHATSAPP_PHONE_NUMBER_ID');
      if (!accessToken || !phoneNumberId) {
        return null;
      }
      this.cachedCredentials = { accessToken, phoneNumberId };
    }
    return this.cachedCredentials;
  }
}
