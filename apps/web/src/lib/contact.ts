import { WebsiteLeadType } from '@transatlantic/shared';
import { createWebsiteLead } from './leads';
import { siteConfig } from './site-config';

export interface ContactRequestInput {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

/**
 * Website Launch: submits the public Contact form as a WebsiteLead
 * (type: CONTACT) — see leads.ts/apps/api/src/leads for the real
 * capture endpoint and staff-facing view. `name` here is one field on
 * the form but the backend's CreateWebsiteLeadRequest wants
 * firstName/lastName separately; split on the first space, same
 * "good enough for a lead record, not a legal name parser" pragmatism
 * this form's simplicity already implies.
 */
export async function submitContactRequest(input: ContactRequestInput): Promise<{ success: true }> {
  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const lastName = rest.join(' ');
  return createWebsiteLead({
    tenantSlug: siteConfig.tenantSlug,
    type: WebsiteLeadType.CONTACT,
    firstName: firstName || input.name,
    lastName: lastName || undefined,
    email: input.email,
    phone: input.phone || undefined,
    subject: input.subject,
    message: input.message,
  });
}
