import { Body, Controller, Post } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AiAgentAskResponse, AuthenticatedUser } from '@transatlantic/shared';
import { AnyAuthenticatedRole } from '../common/decorators/any-authenticated-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { AskAgentDto } from './dto/ask-agent.dto';
import { AiAgentService } from './ai-agent.service';

/** AnanseLogix Phase 1: any authenticated tenant staff/customer role may ask — RBAC doesn't need to be narrower than that; the AI_AGENT entitlement is the actual gate (a WEBSITE_ONLY tenant's TENANT_OWNER is a valid role but was never granted this feature). */
@Controller('ai-agent')
export class AiAgentController {
  constructor(private readonly aiAgentService: AiAgentService) {}

  @Post('ask')
  @AnyAuthenticatedRole()
  @RequireEntitlement(EntitlementFeature.AI_AGENT)
  async ask(@CurrentUser() user: AuthenticatedUser, @Body() dto: AskAgentDto): Promise<AiAgentAskResponse> {
    const answer = await this.aiAgentService.ask(dto.question, user);
    return { answer };
  }
}
