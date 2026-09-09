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
/**
 * Customer Email Redesign: `html` is optional and additive — every
 * existing caller (platform-emails.ts, LeadsService, the original
 * shipment-status plain title/body path) keeps sending plain text
 * unchanged by simply omitting it. Only NotificationsService's new
 * shipment-customer-email templates pass both `body` (the plain-text
 * fallback) and `html` together. `subject`/`body` remain required so no
 * existing call site needs to change.
 */
export interface EmailProvider {
  send(params: { to: string; subject: string; body: string; html?: string }): Promise<ProviderSendResult>;
}

export interface SmsProvider {
  send(params: { to: string; body: string }): Promise<ProviderSendResult>;
}

/**
 * WhatsApp Integration (Stage 4C): `template` carries an approved-
 * template send (see whatsapp-template.util.ts) — WhatsApp Business
 * Platform (Meta's own Cloud API and Twilio's WhatsApp product alike)
 * requires a pre-approved template for any business-initiated message
 * sent outside a customer-started 24-hour conversation window, which a
 * shipment status update always is. `body` is kept as a plain-text
 * fallback/log line for the console provider and for any future
 * freeform use (e.g. replying inside an active customer-initiated
 * session) — a real provider implementation should require `template`
 * for the shipment-notification use case and treat its absence as a
 * configuration error, not silently fall back to freeform text Meta
 * would reject.
 *
 * `tenantId` is accepted (and currently unused beyond logging) purely so
 * a future per-tenant-credentials phase can resolve which WhatsApp
 * Business Account to send through without widening this interface
 * again — see MetaWhatsAppProvider's own doc comment.
 */
export interface WhatsAppProvider {
  send(params: {
    to: string;
    body: string;
    template?: { name: string; language: string; params: string[] };
    tenantId: string;
  }): Promise<ProviderSendResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
