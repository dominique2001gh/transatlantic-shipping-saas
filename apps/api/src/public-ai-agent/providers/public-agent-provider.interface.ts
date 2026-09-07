/**
 * Public Website AI Agent, Phase 1 — the clean provider seam. Everything
 * above this interface (PublicAiAgentService, the controller, prompt
 * assembly) is vendor-agnostic; everything below it (one concrete class
 * per vendor) is the only place that knows it's talking to Anthropic. This
 * is the same reasoning that already keeps ResendEmailProvider behind an
 * EmailProvider interface elsewhere in this codebase — swapping or adding
 * a vendor later means adding one new class and flipping the DI binding in
 * PublicAiAgentModule, never touching the service.
 */
export interface PublicAgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PublicAgentCompletion {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface PublicAgentProvider {
  complete(systemPrompt: string, messages: PublicAgentMessage[]): Promise<PublicAgentCompletion>;
}

/** DI token — inject with `@Inject(PUBLIC_AGENT_PROVIDER)`, never the concrete class directly. */
export const PUBLIC_AGENT_PROVIDER = Symbol('PUBLIC_AGENT_PROVIDER');
