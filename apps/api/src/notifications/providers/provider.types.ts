/**
 * Stage 3H: the result every channel provider returns, whatever the
 * underlying transport — NotificationsService uses this uniformly to
 * update a Notification row's status/providerMessageId/errorMessage,
 * never branching on which concrete provider produced it.
 */
export interface ProviderSendResult {
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
}

/**
 * Stage 3H: one interface per channel — email/SMS/WhatsApp payloads are
 * different enough (subject vs. no subject, template-vs-freeform for
 * WhatsApp) that a single unified "send anything" interface would either
 * leak channel-specific concerns into NotificationsService or force an
 * awkward least-common-denominator shape. Each is selected via its own DI
 * token (see notification-providers.module.ts) so a real provider can
 * replace the console default later with zero changes anywhere else.
 */
export interface EmailProvider {
  send(params: { to: string; subject: string; body: string }): Promise<ProviderSendResult>;
}

export interface SmsProvider {
  send(params: { to: string; body: string }): Promise<ProviderSendResult>;
}

export interface WhatsAppProvider {
  send(params: { to: string; body: string }): Promise<ProviderSendResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
