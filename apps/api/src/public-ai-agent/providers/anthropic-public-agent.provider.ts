import { BadGatewayException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PublicAgentCompletion, PublicAgentMessage, PublicAgentProvider } from './public-agent-provider.interface';

/** Server-enforced output cap — a cost/abuse control independent of whatever the caller asks for; there is no way to raise this from the request. */
const MAX_OUTPUT_TOKENS = 512;

/**
 * Public Website AI Agent, Phase 1 — Anthropic implementation of
 * PublicAgentProvider. Uses the platform's native `fetch`, same "one POST,
 * not worth an SDK dependency" reasoning as the staff AiAgentService.
 *
 * Deliberately reads its OWN env vars (`PUBLIC_AI_AGENT_API_KEY` /
 * `PUBLIC_AI_AGENT_MODEL`), never the staff agent's `ANTHROPIC_API_KEY` /
 * `ANTHROPIC_MODEL` — an unauthenticated, public-facing endpoint has a very
 * different abuse/cost exposure than one gated behind full staff auth +
 * plan entitlement, so it gets its own key and its own budget to manage
 * independently, even though today both happen to call the same vendor.
 */
@Injectable()
export class AnthropicPublicAgentProvider implements PublicAgentProvider {
  private readonly logger = new Logger(AnthropicPublicAgentProvider.name);
  private cachedApiKey: string | undefined;

  constructor(private readonly config: ConfigService) {}

  async complete(systemPrompt: string, messages: PublicAgentMessage[]): Promise<PublicAgentCompletion> {
    // Read outside the network try/catch below, on purpose: a missing key
    // is a misconfiguration, not an upstream/network failure, and the two
    // must never be logged or thrown identically — see this method's own
    // apiKey getter for why that distinction previously got lost.
    const apiKey = this.apiKey;
    const model = this.config.get<string>('PUBLIC_AI_AGENT_MODEL', 'claude-sonnet-5');

    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: systemPrompt,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
    } catch (err) {
      this.logger.error(`Public AI agent request threw (network/transport error, not a configuration issue): ${err}`);
      throw new BadGatewayException('The assistant is temporarily unavailable — please try again shortly.');
    }

    const data = (await res.json().catch(() => ({}))) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { message?: string };
    };

    if (!res.ok) {
      this.logger.error(`Public AI agent request failed (${res.status}): ${data.error?.message ?? 'unknown error'}`);
      throw new BadGatewayException('The assistant is temporarily unavailable — please try again shortly.');
    }

    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new BadGatewayException('The assistant returned an empty response — please try again.');
    }

    return {
      text,
      usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
    };
  }

  /**
   * Deliberately a distinct exception type (and a distinct, unambiguous
   * log line) from every network/upstream failure in `complete()` above —
   * this is a misconfigured deployment, not Anthropic being unreachable or
   * erroring, and the two must never look the same in the logs or take a
   * live reproduction to tell apart (see the Phase 1 follow-up this fixes).
   * The client-facing message stays generic either way — never leaks which
   * case it was.
   */
  private get apiKey(): string {
    if (!this.cachedApiKey) {
      const key = this.config.get<string>('PUBLIC_AI_AGENT_API_KEY');
      if (!key) {
        this.logger.error(
          'PUBLIC_AI_AGENT_API_KEY is not set — the public AI agent cannot make requests until this env var is configured and the API process is fully restarted (editing .env alone does not restart a running "nest start --watch" process).',
        );
        throw new InternalServerErrorException('The assistant is not configured correctly — please contact support.');
      }
      this.cachedApiKey = key;
    }
    return this.cachedApiKey;
  }
}
