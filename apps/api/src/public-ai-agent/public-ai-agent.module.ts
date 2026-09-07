import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AnthropicPublicAgentProvider } from './providers/anthropic-public-agent.provider';
import { PUBLIC_AGENT_PROVIDER } from './providers/public-agent-provider.interface';
import { PublicAgentConversationStore } from './conversation-store.service';
import { PublicAiAgentController } from './public-ai-agent.controller';
import { PublicAiAgentService } from './public-ai-agent.service';

/**
 * ThrottlerModule.forRoot is imported here only — not registered as a
 * global APP_GUARD — the same "module-local, not global" convention
 * LeadsModule/TrackingModule already use, so this is the only endpoint in
 * the API affected by it. PrismaService is available without an explicit
 * import here because PrismaModule is @Global().
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 8 }])],
  controllers: [PublicAiAgentController],
  providers: [
    PublicAiAgentService,
    PublicAgentConversationStore,
    // Swap this binding to add/change vendors later — nothing else in this
    // module needs to change. See PublicAgentProvider's own doc comment.
    { provide: PUBLIC_AGENT_PROVIDER, useClass: AnthropicPublicAgentProvider },
  ],
})
export class PublicAiAgentModule {}
