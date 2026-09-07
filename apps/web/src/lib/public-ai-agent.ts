import type { AskPublicAgentResponse, PublicAgentConfigResponse } from '@transatlantic/shared';
import { apiFetch } from './api';

/**
 * Public Website AI Agent, Phase 1 — the unauthenticated widget client.
 * No token is ever attached (there is none — the visitor is anonymous);
 * the tenant is identified by `tenantSlug` alone, exactly like the public
 * tracking lookup already does. `conversationId` is opaque and
 * server-issued — callers just echo back whatever the previous response
 * returned, never anything else.
 */
export function askPublicAiAgent(
  tenantSlug: string,
  question: string,
  conversationId?: string,
): Promise<AskPublicAgentResponse> {
  return apiFetch<AskPublicAgentResponse>('/public/ai-agent/ask', {
    method: 'POST',
    body: JSON.stringify({ tenantSlug, question, conversationId }),
  });
}

/** Fetches the tenant's own configured assistant display name (e.g. "Eddie") — no LLM call, safe to call as soon as the widget mounts. */
export function fetchPublicAiAgentConfig(tenantSlug: string): Promise<PublicAgentConfigResponse> {
  return apiFetch<PublicAgentConfigResponse>(`/public/ai-agent/config?tenantSlug=${encodeURIComponent(tenantSlug)}`);
}
