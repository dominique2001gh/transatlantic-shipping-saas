import type { AiAgentAskResponse } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

/** AnanseLogix Phase 1: pure Q&A — see AiAgentService's own doc comment for why there's no action-taking capability here yet. */
export function askAiAgent(question: string): Promise<AiAgentAskResponse> {
  const token = getStoredToken();
  return apiFetch<AiAgentAskResponse>('/ai-agent/ask', {
    method: 'POST',
    body: JSON.stringify({ question }),
    token: token ?? undefined,
  });
}
