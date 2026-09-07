import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AskPublicAgentResponse, PublicAgentConfigResponse } from '@transatlantic/shared';
import { Public } from '../common/decorators/public.decorator';
import { AskPublicAgentDto } from './dto/ask-public-agent.dto';
import { PublicAiAgentService } from './public-ai-agent.service';

/**
 * Public Website AI Agent, Phase 1: no authentication, deliberately (an
 * anonymous website visitor has no account) — resolved instead by
 * `tenantSlug`, re-validated server-side on every call (see
 * PublicAiAgentService's own doc comment on tenant isolation).
 *
 * Rate-limited locally to this one route via a module-scoped
 * ThrottlerModule, the same established pattern PublicLeadsController and
 * TrackingController already use for the other public, unauthenticated,
 * abuse-prone endpoints in this API — every other controller's behavior is
 * completely unaffected.
 */
@Controller('public/ai-agent')
export class PublicAiAgentController {
  constructor(private readonly publicAiAgentService: PublicAiAgentService) {}

  @Post('ask')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  ask(@Body() dto: AskPublicAgentDto): Promise<AskPublicAgentResponse> {
    return this.publicAiAgentService.ask(dto);
  }

  /**
   * Lets the widget show the tenant's own configured assistant name (e.g.
   * "Eddie") before the visitor has asked anything — no LLM call, so a
   * more generous limit than `ask` is fine, matching TrackingController's
   * own public-GET-lookup throttle.
   */
  @Get('config')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  getConfig(@Query('tenantSlug') tenantSlug?: string): Promise<PublicAgentConfigResponse> {
    return this.publicAiAgentService.getConfig(tenantSlug ?? '');
  }
}
