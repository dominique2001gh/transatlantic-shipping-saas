import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProviderSendResult, SmsProvider } from './provider.types';

/**
 * SMS/Twilio MVP: real SMS delivery via Twilio's REST API. Uses the
 * platform's native `fetch` rather than the `twilio` npm package — same
 * "one POST, one form body" reasoning ResendEmailProvider already
 * documents for email, and keeps this file dependency-free and
 * trivially readable end to end.
 *
 * Credentials (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`)
 * are read lazily, same pattern as ResendEmailProvider's `apiKey` getter —
 * NotificationProvidersModule constructs every provider eagerly regardless
 * of which one SMS_PROVIDER actually selects, so reading these at
 * construction time would break any environment that doesn't set them
 * (including local dev/test, where SMS_PROVIDER defaults to "console" and
 * this class is never invoked).
 *
 * `send()` deliberately never throws/rejects — a missing/misconfigured env
 * var or a Twilio API failure is caught inside this method and returned as
 * an ordinary `{success:false}` result, exactly like a real delivery
 * failure. This is what guarantees a Twilio outage or misconfiguration can
 * never propagate up through NotificationsService and interrupt the
 * shipment-lifecycle action that triggered the notification — the same
 * "never throw" contract every provider in this module already honors.
 *
 * Never logs the auth token, account SID, destination number, or message
 * body — only Twilio's own returned error code/message (which never
 * echoes credentials) is logged on failure.
 */
@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SmsProvider(twilio)');
  private cachedAccountSid: string | undefined;
  private cachedAuthToken: string | undefined;
  private cachedFromNumber: string | undefined;

  constructor(private readonly config: ConfigService) {}

  async send(params: { to: string; body: string }): Promise<ProviderSendResult> {
    try {
      const accountSid = this.getRequiredConfig('TWILIO_ACCOUNT_SID', this.cachedAccountSid, (v) => (this.cachedAccountSid = v));
      const authToken = this.getRequiredConfig('TWILIO_AUTH_TOKEN', this.cachedAuthToken, (v) => (this.cachedAuthToken = v));
      const from = this.getRequiredConfig('TWILIO_FROM_NUMBER', this.cachedFromNumber, (v) => (this.cachedFromNumber = v));

      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const body = new URLSearchParams({ To: params.to, From: from, Body: params.body });

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };

      if (!res.ok) {
        this.logger.error(`Twilio send failed (HTTP ${res.status}, Twilio error code ${data.code ?? 'n/a'}): ${data.message ?? 'unknown error'}`);
        return { success: false, errorMessage: data.message ?? `Twilio responded with ${res.status}` };
      }

      return { success: true, providerMessageId: data.sid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Twilio send failed: ${message}`);
      return { success: false, errorMessage: message };
    }
  }

  private getRequiredConfig(key: 'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_FROM_NUMBER', cached: string | undefined, setCache: (value: string) => void): string {
    if (cached) return cached;
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`Missing required env var "${key}" for SMS_PROVIDER=twilio`);
    }
    setCache(value);
    return value;
  }
}
