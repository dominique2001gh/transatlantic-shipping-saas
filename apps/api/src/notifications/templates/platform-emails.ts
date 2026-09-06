/**
 * AnanseLogix Phase 1: centralized plain-text templates for platform/
 * SaaS-lifecycle email — the counterpart to the inline template-literal
 * bodies NotificationsService builds per fire* method for tenant-to-
 * customer notifications. These are deliberately separate: every function
 * here is about the *tenant's own account* with AnanseLogix (or a
 * prospect's relationship with it), never a tenant's shipping customer, so
 * none of it belongs in NotificationsService's customer-fan-out shape.
 * Sent via the raw EmailProvider (EMAIL_PROVIDER token) directly — the
 * same "notify a tenant, not a customer" pattern LeadsService.
 * formatLeadEmail already establishes — never through NotificationsService.
 *
 * Plain text only, matching ResendEmailProvider's text-only contract (see
 * that file's own doc comment). Each function returns { subject, body }.
 */

export interface PlatformEmail {
  subject: string;
  body: string;
}

export function signupCompleteEmail(params: { ownerFirstName: string; tenantName: string; loginUrl: string }): PlatformEmail {
  return {
    subject: `Welcome to AnanseLogix, ${params.ownerFirstName} — your company is set up`,
    body: [
      `Hi ${params.ownerFirstName},`,
      '',
      `${params.tenantName} is now live on AnanseLogix. Your subscription is active and your owner account is ready.`,
      '',
      `Next: sign in and complete the short onboarding wizard to set up your branding, operations, and staff.`,
      `Sign in: ${params.loginUrl}`,
      '',
      '— The AnanseLogix Team',
    ].join('\n'),
  };
}

export function tenantActivatedEmail(params: { ownerFirstName: string; tenantName: string }): PlatformEmail {
  return {
    subject: `${params.tenantName} is active on AnanseLogix`,
    body: [
      `Hi ${params.ownerFirstName},`,
      '',
      `Good news — ${params.tenantName}'s subscription is active and full access has been restored (or confirmed).`,
      '',
      '— The AnanseLogix Team',
    ].join('\n'),
  };
}

export function paymentFailureEmail(params: { ownerFirstName: string; tenantName: string; gracePeriodEndsAt: Date; billingUrl: string }): PlatformEmail {
  return {
    subject: `Action needed: a payment for ${params.tenantName} failed`,
    body: [
      `Hi ${params.ownerFirstName},`,
      '',
      `We were unable to process your latest subscription payment for ${params.tenantName}.`,
      `Please update your payment method by ${params.gracePeriodEndsAt.toDateString()} to avoid restricted access.`,
      '',
      `Manage billing: ${params.billingUrl}`,
      '',
      '— The AnanseLogix Team',
    ].join('\n'),
  };
}

export function subscriptionPastDueEmail(params: { ownerFirstName: string; tenantName: string; gracePeriodEndsAt: Date; billingUrl: string }): PlatformEmail {
  return paymentFailureEmail(params);
}

export function staffInvitationEmail(params: {
  inviteeEmail: string;
  tenantName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
}): PlatformEmail {
  return {
    subject: `${params.inviterName} invited you to join ${params.tenantName} on AnanseLogix`,
    body: [
      `Hi,`,
      '',
      `${params.inviterName} has invited you to join ${params.tenantName}'s team on AnanseLogix.`,
      '',
      `Accept your invitation: ${params.acceptUrl}`,
      `This invitation expires on ${params.expiresAt.toDateString()}.`,
      '',
      '— The AnanseLogix Team',
    ].join('\n'),
  };
}

export function demoRequestConfirmationEmail(params: { contactName: string; companyName: string }): PlatformEmail {
  return {
    subject: `We received your AnanseLogix demo request`,
    body: [
      `Hi ${params.contactName},`,
      '',
      `Thanks for your interest in AnanseLogix for ${params.companyName}. Our team will reach out shortly to schedule a demo.`,
      '',
      '— The AnanseLogix Team',
    ].join('\n'),
  };
}

/**
 * Defined for completeness (Section 16 of the build brief lists it) but
 * not yet wired to a real endpoint — Phase 1 does not add a forgot-
 * password request/consume flow (out of scope for the approved plan).
 * Kept here so that future work has one place to read from instead of a
 * new hardcoded string.
 */
export function passwordResetEmail(params: { firstName: string; resetUrl: string; expiresInMinutes: number }): PlatformEmail {
  return {
    subject: `Reset your AnanseLogix password`,
    body: [
      `Hi ${params.firstName},`,
      '',
      `We received a request to reset your password. This link expires in ${params.expiresInMinutes} minutes.`,
      `Reset your password: ${params.resetUrl}`,
      '',
      `If you didn't request this, you can safely ignore this email.`,
      '',
      '— The AnanseLogix Team',
    ].join('\n'),
  };
}
