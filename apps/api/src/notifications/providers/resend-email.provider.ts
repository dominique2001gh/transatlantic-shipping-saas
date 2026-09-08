import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailProvider, ProviderSendResult } from './provider.types';

/**
 * Formats an RFC 5322 "From" header — `"Display Name" <address>` when a
 * display name is given, or just the bare address when it isn't (today's
 * exact prior behavior, unchanged). The display name is always wrapped in
 * a quoted-string (safe even for a simple one-word name) with internal
 * `"`/`\` escaped, so a future tenant's name can never produce a malformed
 * or header-injected From value. Exported and side-effect-free
 * specifically so sender-formatting can be unit-tested without a real
 * Resend call — see resend-email-header.e2e-spec.ts.
 */
export function formatFromHeader(address: string, displayName?: string | null): string {
  const trimmed = displayName?.trim();
  if (!trimmed) return address;
  const escaped = trimmed.replace(/(["\\])/g, '\\$1');
  return `"${escaped}" <${address}>`;
}

/**
 * Website Launch Step 6: real email delivery via Resend's HTTP API.
 * Uses the platform's native `fetch` rather than the `resend` npm
 * package — the API surface needed here (one POST, one JSON body) is
 * small enough that adding a dependency for it isn't worth it, and it
 * keeps this file trivially readable end to end.
 *
 * EMAIL_FROM_ADDRESS defaults to Resend's own shared sandbox sender
 * (onboarding@resend.dev), which works with zero DNS setup — but Resend's
 * sandbox mode only delivers to the email address the Resend account
 * itself was created with, not arbitrary recipients. Sending real mail
 * to any address (e.g. lead notifications actually reaching
 * info@talogisticssolutions.com) requires verifying talogisticssolutions.com
 * as a sending domain in the Resend dashboard (SPF/DKIM DNS records) and
 * setting EMAIL_FROM_ADDRESS to an address on that domain — deliberately
 * deferred to the DNS cutover step, not done here.
 *
 * EMAIL_FROM_NAME (optional, new) pairs with EMAIL_FROM_ADDRESS to set the
 * human-readable sender name shown by the recipient's mail client (e.g.
 * "Trans Atlantic Logistics Solutions" instead of a bare address, which
 * otherwise falls back to Resend's own default and shows as
 * "onboarding@resend.dev" — see the production-readiness audit that
 * flagged this). Deliberately a platform-wide env var, exactly like
 * EMAIL_FROM_ADDRESS itself, not a value hardcoded anywhere in this
 * class — this is shared SaaS notification infrastructure every tenant's
 * email flows through, so it must stay tenant-agnostic in code. A future
 * phase giving each tenant its own sender name/address (a schema change,
 * explicitly out of scope here) would only need to pass a per-tenant name
 * into this same env-var-shaped parameter, not touch this file's logic.
 *
 * Credentials are read lazily (see R2StorageProvider's own doc comment
 * for why: StorageModule/NotificationProvidersModule-style factories
 * construct every provider eagerly regardless of which one is actually
 * selected by env var, so reading RESEND_API_KEY in the constructor would
 * break any environment that doesn't set it, including local dev).
 */
@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger('EmailProvider(resend)');
  private cachedApiKey: string | undefined;

  constructor(private readonly config: ConfigService) {}

  async send(params: { to: string; subject: string; body: string }): Promise<ProviderSendResult> {
    const fromAddress = this.config.get<string>('EMAIL_FROM_ADDRESS', 'onboarding@resend.dev');
    const fromName = this.config.get<string>('EMAIL_FROM_NAME');
    const from = formatFromHeader(fromAddress, fromName);

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: params.to,
          subject: params.subject,
          text: params.body,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };

      if (!res.ok) {
        this.logger.error(`Resend send failed (${res.status}): ${data.message ?? 'unknown error'}`);
        return { success: false, errorMessage: data.message ?? `Resend responded with ${res.status}` };
      }

      return { success: true, providerMessageId: data.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Resend send threw: ${message}`);
      return { success: false, errorMessage: message };
    }
  }

  private get apiKey(): string {
    if (!this.cachedApiKey) {
      const key = this.config.get<string>('RESEND_API_KEY');
      if (!key) {
        throw new InternalServerErrorException('Missing required env var "RESEND_API_KEY" for EMAIL_PROVIDER=resend');
      }
      this.cachedApiKey = key;
    }
    return this.cachedApiKey;
  }
}
