'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { IconChatBubble, IconClose } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { askPublicAiAgent, fetchPublicAiAgentConfig } from '@/lib/public-ai-agent';
import { siteConfig } from '@/lib/site-config';

/** Shown until the tenant's real configured name loads (or if that lookup fails) — a safe, still-branded fallback, never a hardcoded name like "Eddie" that would leak into another tenant's copy of this same component. */
const FALLBACK_AGENT_NAME = `${siteConfig.shortName} Assistant`;

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTED_QUESTIONS = [
  'What services do you offer?',
  'How do I track my shipment?',
  'How do I get a shipping quote?',
  'Where do you ship from and to?',
];

/** The four relative paths the assistant is instructed to reference — turned into real links wherever they appear in its replies, rather than staying as inert text the visitor would have to retype into the address bar. */
const LINKABLE_PATHS = ['/track', '/login', '/quote', '/contact'];
const LINK_PATTERN = new RegExp(`(${LINKABLE_PATHS.map((p) => p.replace('/', '\\/')).join('|')})(?![\\w-])`, 'g');

function renderAnswer(text: string) {
  const parts = text.split(LINK_PATTERN);
  return parts.map((part, i) =>
    LINKABLE_PATHS.includes(part) ? (
      <Link key={i} href={part} className="font-medium underline underline-offset-2 hover:text-primary-800">
        {part}
      </Link>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/**
 * Public Website AI Agent, Phase 1 — the compact floating chat widget.
 * Mounted once in the `(public)` layout so it's available on every page of
 * the public site. Deliberately the ONLY frontend surface this phase
 * builds (no separate full-page assistant yet, per the approved plan).
 *
 * Tenant identity comes from `siteConfig.tenantSlug` — the same single
 * source of truth the public tracking lookup already reads its tenant
 * slug from (see site-config.ts's own doc comment) — never hardcoded here,
 * so this component itself has no tenant-specific knowledge baked in; it
 * would work unchanged on any tenant's own copy of this same public site.
 *
 * The displayed assistant name (e.g. Trans Atlantic's "Eddie") is fetched
 * from `GET /public/ai-agent/config`, never hardcoded in this component —
 * a different tenant's copy of this same widget shows whatever name that
 * tenant configured (see Tenant.agentName's own doc comment), falling back
 * to a generic "{company} Assistant" if unset or unreachable.
 *
 * Conversation state (messages, conversationId) lives in this component's
 * own React state only — nothing is persisted across a page reload or
 * stored client-side, matching the backend's own short-lived,
 * server-held-only conversation memory (see PublicAgentConversationStore).
 */
export function PublicAiAgentWidget() {
  const [open, setOpen] = useState(false);
  const [agentName, setAgentName] = useState(FALLBACK_AGENT_NAME);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetched once on mount (cheap, no LLM call) so the header/greeting show
  // the tenant's own configured name (e.g. "Eddie") the instant the panel
  // is first opened, not just after the first reply. Silently keeps the
  // generic fallback on any failure — never blocks the widget from working.
  useEffect(() => {
    fetchPublicAiAgentConfig(siteConfig.tenantSlug)
      .then(({ agentName: name }) => setAgentName(name))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function ask(text: string) {
    if (!text.trim() || sending) return;
    setError(null);
    setMessages((m) => [...m, { role: 'user', text }]);
    setQuestion('');
    setSending(true);
    try {
      const { answer, conversationId } = await askPublicAiAgent(siteConfig.tenantSlug, text, conversationIdRef.current);
      conversationIdRef.current = conversationId;
      setMessages((m) => [...m, { role: 'assistant', text: answer }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sorry, I'm unable to respond right now — please try again shortly.");
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(question);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
      {open && (
        <div className="fixed inset-x-3 bottom-20 top-auto z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-[4.5rem] sm:right-0 sm:h-[32rem] sm:max-h-[70vh] sm:w-96">
          <div className="flex shrink-0 items-center justify-between gap-2 bg-primary-900 px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">{agentName}</p>
              <p className="text-xs text-primary-200">Ask about our services or your shipment</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary-100 hover:bg-white/10 hover:text-white"
            >
              <IconClose className="h-5 w-5" />
            </button>
          </div>

          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-label={`Conversation with ${agentName}`}
            className="flex-1 overflow-y-auto bg-slate-50 p-3"
          >
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-slate-400">
                  Hi, I&apos;m {agentName}! I can help with questions about our services, tracking, and more. Try asking:
                </p>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => ask(q)}
                    className="w-fit rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-600 hover:border-primary-400 hover:text-primary-700"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === 'user' ? 'ml-auto bg-primary-700 text-white' : 'bg-white text-slate-800 shadow-sm'
                  }`}
                >
                  {m.role === 'assistant' ? renderAnswer(m.text) : m.text}
                </div>
              ))}
              {sending && <div className="max-w-[85%] rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-400 shadow-sm">Thinking…</div>}
            </div>
          </div>

          {error && (
            <p role="alert" className="shrink-0 border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="flex shrink-0 items-center gap-2 border-t border-slate-100 bg-white p-2.5">
            <label htmlFor="public-ai-agent-question" className="sr-only">
              Ask a question
            </label>
            <input
              id="public-ai-agent-question"
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Type a question…"
              maxLength={500}
              autoComplete="off"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <button
              type="submit"
              disabled={sending || !question.trim()}
              className="shrink-0 rounded-lg bg-primary-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close chat assistant' : 'Open chat assistant'}
        aria-expanded={open}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-700 text-white shadow-lg transition-transform hover:scale-105 hover:bg-primary-800"
      >
        {open ? <IconClose className="h-6 w-6" /> : <IconChatBubble className="h-6 w-6" />}
      </button>
    </div>
  );
}
