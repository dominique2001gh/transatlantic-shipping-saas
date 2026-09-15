/**
 * Sender-identity fix (2026-09, platform-branding): the single place every
 * platform-lifecycle email (staff invitations, password resets, billing/
 * signup emails — anything from packages/shared's own platform-emails.ts,
 * which already signs off "— The AnanseLogix Team" in its body) reads its
 * sender identity from. Deliberately separate from EMAIL_FROM_NAME/
 * EMAIL_FROM_ADDRESS, which stay scoped to tenant-to-customer mail (a
 * tenant's own shipment-status notifications, which must keep showing
 * *that tenant's* name, e.g. Trans Atlantic's own customers seeing "Trans
 * Atlantic Logistics Solutions" as the sender — see
 * NotificationsService/shipment-customer-emails.ts).
 *
 * Before this fix, every email in this codebase — platform-lifecycle and
 * tenant-to-customer alike — shared the one EMAIL_FROM_NAME/
 * EMAIL_FROM_ADDRESS pair, so a value configured for Trans Atlantic's own
 * customer notifications (its historically-first tenant, from before
 * AnanseLogix became a multi-tenant SaaS) leaked onto every *other*
 * tenant's platform-lifecycle mail too, including this one (staff
 * invitations). This function is that split's one source of truth: never
 * hardcode "AnanseLogix" (or any tenant's name) at a call site — read it
 * from here.
 *
 * PLATFORM_EMAIL_FROM_NAME defaults to "AnanseLogix" (the actual platform's
 * own name, not a tenant's — safe to default in code, unlike a tenant
 * name). PLATFORM_EMAIL_FROM_ADDRESS is intentionally undefined by default
 * (falls through to ResendEmailProvider's own EMAIL_FROM_ADDRESS default):
 * changing the sending *address* requires a dedicated AnanseLogix domain
 * verified with the email provider (SPF/DKIM) first — see this repo's RBAC
 * milestone follow-up notes for what that DNS/provider work involves. Until
 * that domain exists, platform mail keeps using whatever address is
 * already verified (today, Trans Atlantic's own domain) — only the
 * human-visible display name changes to AnanseLogix. Setting
 * PLATFORM_EMAIL_FROM_ADDRESS once that domain is verified requires no
 * code change, only the new env var.
 */
export interface PlatformEmailSender {
  fromName: string;
  fromAddress?: string;
}

/** Minimal shape actually used — accepts a real NestJS ConfigService or a plain test double, whichever is easiest at the call site. */
export interface ConfigLike {
  get<T = string>(key: string, defaultValue?: T): T | undefined;
}

export function resolvePlatformEmailSender(config: ConfigLike): PlatformEmailSender {
  return {
    fromName: config.get<string>('PLATFORM_EMAIL_FROM_NAME', 'AnanseLogix')!,
    fromAddress: config.get<string>('PLATFORM_EMAIL_FROM_ADDRESS'),
  };
}
