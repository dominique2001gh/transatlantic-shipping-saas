import Link from 'next/link';
import { IconHeadset } from '@/components/icons';

/**
 * Phase 3: a contextual entry point into the AI Training & Support Agent
 * (Section 11) from wherever a workflow's own instructions live — deep-
 * links straight to /dashboard/ai-agent with the relevant question
 * pre-asked (see that page's own `?q=` handling), so a new employee stuck
 * on e.g. Receiving doesn't have to leave the page, retype their question,
 * and lose their place. Purely a convenience link; the AI_AGENT
 * entitlement gate lives on the destination page itself, not here.
 */
export function AskAiLink({ question }: { question: string }) {
  return (
    <Link
      href={`/dashboard/ai-agent?q=${encodeURIComponent(question)}`}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-800"
    >
      <IconHeadset className="h-4 w-4" />
      Ask AI: &ldquo;{question}&rdquo;
    </Link>
  );
}
