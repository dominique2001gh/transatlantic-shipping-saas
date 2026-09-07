import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Public Website AI Agent, Phase 1. Bounds are deliberately tighter than
 * the staff AskAgentDto (2000 chars): this endpoint is unauthenticated and
 * abuse-exposed, so both message length and identifier shapes are kept
 * small — see PublicAiAgentController's own doc comment for the
 * accompanying rate limit.
 */
export class AskPublicAgentDto {
  /** Matches Tenant.slug's own real-world shape (lowercase, digits, hyphens) — never trusted as proof of anything, just a lookup key the service re-resolves server-side. */
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'tenantSlug must be lowercase letters, digits, and hyphens only' })
  @MaxLength(80)
  tenantSlug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;

  /** Optional — omit to start a new conversation. Always just an opaque lookup key into PublicAgentConversationStore; the server never trusts anything else about a conversation's contents from the client. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  conversationId?: string;
}
