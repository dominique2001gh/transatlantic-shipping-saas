import { BadGatewayException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { AI_AGENT_SYSTEM_PROMPT } from './system-prompt';

/**
 * AnanseLogix Phase 1 (Section 11): the AI Training & Support Agent —
 * pure Q&A, no tool use, no action execution. Uses the platform's native
 * `fetch` against Anthropic's Messages API rather than adding the
 * `@anthropic-ai/sdk` dependency — the same "one POST, one JSON body,
 * not worth a dependency" reasoning ResendEmailProvider's own doc comment
 * gives for Resend. `ANTHROPIC_API_KEY` is read lazily (same pattern —
 * and same reason — as ResendEmailProvider.apiKey) so an environment
 * without it set only breaks this one feature at first use, not app boot.
 *
 * The user's role/name/tenant are included in the request only to let the
 * model tailor tone (e.g. addressing a STAFF employee
 * differently than an OWNER) — never as an authorization signal;
 * RolesGuard/EntitlementsGuard already gated the request before this
 * service is reached, and the model has no tool access that could act on
 * that context even if it wanted to.
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private cachedApiKey: string | undefined;

  constructor(private readonly config: ConfigService) {}

  async ask(question: string, user: AuthenticatedUser): Promise<string> {
    const model = this.config.get<string>('ANTHROPIC_MODEL', 'claude-sonnet-5');

    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: AI_AGENT_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `[Employee role: ${user.role}] ${question}`,
            },
          ],
        }),
      });
    } catch (err) {
      this.logger.error(`AI agent request threw: ${err}`);
      throw new BadGatewayException('The AI assistant is temporarily unavailable — please try again shortly.');
    }

    const data = (await res.json().catch(() => ({}))) as {
      content?: { type: string; text?: string }[];
      error?: { message?: string };
    };

    if (!res.ok) {
      this.logger.error(`AI agent request failed (${res.status}): ${data.error?.message ?? 'unknown error'}`);
      throw new BadGatewayException('The AI assistant is temporarily unavailable — please try again shortly.');
    }

    const answer = data.content?.find((block) => block.type === 'text')?.text;
    if (!answer) {
      throw new BadGatewayException('The AI assistant returned an empty response — please try again.');
    }
    return answer;
  }

  private get apiKey(): string {
    if (!this.cachedApiKey) {
      const key = this.config.get<string>('ANTHROPIC_API_KEY');
      if (!key) {
        throw new InternalServerErrorException('Missing required env var "ANTHROPIC_API_KEY" for the AI agent');
      }
      this.cachedApiKey = key;
    }
    return this.cachedApiKey;
  }
}
