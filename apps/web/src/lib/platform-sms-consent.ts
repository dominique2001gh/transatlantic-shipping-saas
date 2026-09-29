import { apiFetch } from './api';

export interface PlatformSmsConsentInput {
  name: string;
  phone: string;
  smsConsent: boolean;
}

/**
 * Twilio A2P Campaign compliance: submits ananselogix.com/sms-consent's
 * form — public, unauthenticated, same posture createWebsiteLead already
 * establishes for the Contact/Quote forms. POST /public/platform-sms-consent
 * is a standalone platform-level endpoint, unrelated to any tenant.
 */
export function submitPlatformSmsConsent(input: PlatformSmsConsentInput): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/public/platform-sms-consent', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
