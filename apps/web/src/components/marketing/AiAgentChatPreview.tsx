import { IconHeadset } from '@/components/icons';

interface ExampleMessage {
  role: 'employee' | 'ai';
  text: string;
}

/**
 * A realistic AI Training & Support Agent transcript — the actual product
 * (apps/api/src/ai-agent), not a mockup of hypothetical functionality.
 * Deliberately Q&A only: every AI reply here explains where to go and
 * what to do next in the real UI, never "I've done X for you" — the
 * agent has no tool use / action-taking capability today (see
 * ai-agent.service.ts's own doc comment), and this preview must not
 * imply otherwise.
 */
const EXAMPLE_CONVERSATION: ExampleMessage[] = [
  { role: 'employee', text: 'How do I receive a package?' },
  {
    role: 'ai',
    text: 'Open Warehouse → Receive. Scan the package barcode or enter the shipment number, confirm the customer and destination, then submit to log it as received.',
  },
  { role: 'employee', text: 'I just scanned this package. What do I do next?' },
  {
    role: 'ai',
    text: 'Confirm the package details, then select Process / Inspect to record condition, weight, and dimensions before it moves to container loading.',
  },
];

export function AiAgentChatPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center gap-2.5 border-b border-slate-100 bg-primary-950 px-4 py-3 text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
          <IconHeadset className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">AnanseLogix AI</p>
          <p className="text-[11px] text-primary-200">Training &amp; Support Agent · Q&amp;A only</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 bg-slate-50 p-4">
        {EXAMPLE_CONVERSATION.map((message, i) => (
          <div key={i} className={`flex ${message.role === 'employee' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                message.role === 'employee' ? 'bg-primary-700 text-white' : 'border border-slate-200 bg-white text-slate-700'
              }`}
            >
              {message.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
