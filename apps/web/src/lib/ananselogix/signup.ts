import type {
  SaasPlanType,
  SignupCheckoutResponse,
  SignupCompanyDetails,
  SignupStatusResponse,
  StartSignupResponse,
} from '@transatlantic/shared';
import { apiFetch } from '@/lib/api';

export interface SignupOwnerInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword: string;
}

/**
 * AnanseLogix Phase 1: the signup wizard's entire API surface — every call
 * here is public/unauthenticated (no account exists yet), addressed by the
 * SignupSession token rather than a bearer token. See SignupService's own
 * doc comment for the server-side lifecycle these calls stage.
 */
export function startSignup(planKey: SaasPlanType): Promise<StartSignupResponse> {
  return apiFetch<StartSignupResponse>('/public/signup/start', {
    method: 'POST',
    body: JSON.stringify({ planKey }),
  });
}

export function setSignupOwner(token: string, input: SignupOwnerInput): Promise<{ success: true }> {
  return apiFetch<{ success: true }>(`/public/signup/${token}/owner`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function setSignupCompany(token: string, input: SignupCompanyDetails): Promise<{ success: true }> {
  return apiFetch<{ success: true }>(`/public/signup/${token}/company`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function createSignupCheckout(token: string, successUrl: string, cancelUrl: string): Promise<SignupCheckoutResponse> {
  return apiFetch<SignupCheckoutResponse>(`/public/signup/${token}/checkout`, {
    method: 'POST',
    body: JSON.stringify({ successUrl, cancelUrl }),
  });
}

/** Polled by the success page — never derived from the Stripe redirect's own query params (see SignupStatusResponse's own doc comment). */
export function getSignupStatus(token: string): Promise<SignupStatusResponse> {
  return apiFetch<SignupStatusResponse>(`/public/signup/${token}/status`);
}
