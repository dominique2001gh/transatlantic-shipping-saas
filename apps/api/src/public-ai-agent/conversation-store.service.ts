import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { PublicAgentMessage } from './providers/public-agent-provider.interface';

/** Kept small on purpose — a public support widget needs "did I just say that" context, not a long transcript. 6 messages = 3 user/assistant exchanges. */
const MAX_MESSAGES_PER_CONVERSATION = 6;
/** Conversations older than this are treated as gone — nothing is ever persisted to disk or a database, so this is also the effective maximum data-retention window. */
const CONVERSATION_TTL_MS = 30 * 60 * 1000;
/** A hard ceiling on total tracked conversations regardless of TTL, so a sustained flood of new conversationIds (each cheap to create — no LLM call is required to start one) can't grow this process's memory unboundedly between TTL sweeps. */
const MAX_TRACKED_CONVERSATIONS = 2000;

interface StoredConversation {
  messages: PublicAgentMessage[];
  lastActivityAt: number;
}

/**
 * Public Website AI Agent, Phase 1 — short, server-held conversational
 * context for the current chat session, exactly as scoped: in-memory only
 * (nothing written to disk or a database — the most privacy-conscious
 * option available, and the simplest correct one for a single-process
 * Phase 1 deployment), bounded in both message count and lifetime, and
 * the server is the sole source of truth — a client only ever echoes back
 * an opaque conversationId it was given, never any message content or
 * history. This is deliberate: trusting a client-supplied transcript would
 * let anyone forge a fake prior exchange (e.g. "you already agreed to
 * quote me $50") and have the model treat it as real context.
 *
 * All state disappears on process restart — acceptable for Phase 1 (no
 * cross-session memory is required or wanted), and avoids any question of
 * where/how chat transcripts would need to be retained or purged.
 */
@Injectable()
export class PublicAgentConversationStore {
  private readonly conversations = new Map<string, StoredConversation>();

  /** Starts a new, empty conversation and returns its id. */
  create(): string {
    this.cleanupExpired();
    const id = randomUUID();
    this.conversations.set(id, { messages: [], lastActivityAt: Date.now() });
    this.enforceCap();
    return id;
  }

  /** Whether this id currently refers to a live (non-expired) conversation — an expired or unrecognized id is never an error, callers should just start a new one. */
  has(id: string): boolean {
    this.cleanupExpired();
    return this.conversations.has(id);
  }

  getHistory(id: string): PublicAgentMessage[] {
    return this.conversations.get(id)?.messages.slice() ?? [];
  }

  append(id: string, message: PublicAgentMessage): void {
    const conversation = this.conversations.get(id);
    if (!conversation) return;
    conversation.messages.push(message);
    if (conversation.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      conversation.messages.splice(0, conversation.messages.length - MAX_MESSAGES_PER_CONVERSATION);
    }
    conversation.lastActivityAt = Date.now();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, conversation] of this.conversations) {
      if (now - conversation.lastActivityAt > CONVERSATION_TTL_MS) {
        this.conversations.delete(id);
      }
    }
  }

  private enforceCap(): void {
    if (this.conversations.size <= MAX_TRACKED_CONVERSATIONS) return;
    const oldestFirst = [...this.conversations.entries()].sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt);
    const excess = this.conversations.size - MAX_TRACKED_CONVERSATIONS;
    for (const [id] of oldestFirst.slice(0, excess)) {
      this.conversations.delete(id);
    }
  }
}
