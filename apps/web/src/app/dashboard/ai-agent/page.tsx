'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { EntitlementFeature } from '@transatlantic/shared';
import { IconHeadset } from '@/components/icons';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { askAiAgent } from '@/lib/ai-agent';
import { fetchMyEntitlements } from '@/lib/entitlements';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTED_QUESTIONS = [
  'How do I receive a package?',
  'How do I create a manifest?',
  'I just scanned this package. What do I do next?',
  'How do I mark a shipment as arrived?',
];

/**
 * AnanseLogix Phase 1 (Section 11): the AI Training & Support Agent's chat
 * UI — pure Q&A, no action-taking. Gated client-side by the AI_AGENT
 * entitlement (a UX convenience; AiAgentController's own
 * @RequireEntitlement is the real enforcement) so a tenant without this
 * feature sees an explanatory message instead of a raw 403 from the chat
 * box itself.
 *
 * Phase 3: accepts an optional `?q=` query param so other pages can deep-
 * link a relevant, pre-asked question here — e.g. a "Ask AI" link next to
 * the Warehouse page's scanning instructions (see WarehousePage). Wrapped
 * in <Suspense> because useSearchParams() requires that boundary for a
 * statically-prerendered page in the App Router, same reason
 * (public)/login/page.tsx's SessionExpiredBanner is split out.
 */
export default function AiAgentPage() {
  return (
    <Suspense fallback={null}>
      <AiAgentContent />
    </Suspense>
  );
}

function AiAgentContent() {
  const searchParams = useSearchParams();
  const deepLinkedQuestion = searchParams.get('q');

  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const askedDeepLinkRef = useRef(false);

  useEffect(() => {
    fetchMyEntitlements()
      .then((entitlements) => setEntitled(entitlements.some((e) => e.feature === EntitlementFeature.AI_AGENT && e.enabled)))
      .catch(() => setEntitled(true)); // fail open on the UX check — the API guard is the real gate
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function ask(text: string) {
    if (!text.trim() || sending) return;
    setError(null);
    setMessages((m) => [...m, { role: 'user', text }]);
    setQuestion('');
    setSending(true);
    try {
      const { answer } = await askAiAgent(text);
      setMessages((m) => [...m, { role: 'assistant', text: answer }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The AI assistant is unavailable right now.');
    } finally {
      setSending(false);
    }
  }

  // Auto-asks a deep-linked question exactly once, and only once we know
  // the tenant is actually entitled — asking (and immediately 403'ing)
  // before that check resolves would be a confusing first message.
  useEffect(() => {
    if (deepLinkedQuestion && entitled === true && !askedDeepLinkRef.current) {
      askedDeepLinkRef.current = true;
      ask(deepLinkedQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkedQuestion, entitled]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    ask(question);
  }

  if (entitled === false) {
    return (
      <Card className="mx-auto mt-10 max-w-lg text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
          <IconHeadset className="h-6 w-6" />
        </span>
        <h1 className="mt-4 font-display text-lg font-semibold text-slate-900">AI Assistant not included in your plan</h1>
        <p className="mt-2 text-sm text-slate-600">Contact your account owner or AnanseLogix support to add this feature.</p>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-2xl flex-col">
      <h1 className="text-2xl font-semibold text-slate-900">AI Training &amp; Support Agent</h1>
      <p className="mt-1 text-sm text-slate-500">Ask how to do something in AnanseLogix — this assistant only teaches, it never takes actions on your data.</p>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation with the AI assistant"
        className="mt-4 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4"
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-400">Try asking:</p>
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="w-fit rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-600 hover:border-primary-400 hover:text-primary-700"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2.5 text-sm ${
                m.role === 'user' ? 'ml-auto bg-primary-700 text-white' : 'bg-slate-100 text-slate-800'
              }`}
            >
              {m.text}
            </div>
          ))}
          {sending && <div className="max-w-[85%] rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-400">Thinking…</div>}
        </div>
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}

      <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-3">
        <div className="flex-1">
          <TextInput
            label="Ask a question"
            hideLabel
            id="ai-agent-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="How do I..."
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={sending || !question.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}
