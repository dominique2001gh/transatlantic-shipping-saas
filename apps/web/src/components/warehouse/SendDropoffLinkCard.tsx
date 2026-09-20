'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getDropoffLink, sendDropoffLinkEmail } from '@/lib/dropoff-link';

/** How long "Link copied" stays visible before reverting to the Copy Link button label. */
const COPY_CONFIRMATION_MS = 2000;

/**
 * Quick Receive staff convenience: lets a warehouse employee immediately
 * hand a calling customer the public, unauthenticated "Prepare Your
 * Drop-Off" link (/dropoff) — by reading it aloud, copying it, or emailing
 * it — without knowing or typing the URL themselves.
 *
 * The URL itself is never constructed here: GET /tenants/me/dropoff-link
 * resolves it server-side via the same tenant-aware logic staff-invitation
 * links already use (see TenantsService.getDropoffLink's own doc comment),
 * so this component works unchanged for any future tenant.
 */
export function SendDropoffLinkCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [emailResult, setEmailResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    getDropoffLink()
      .then((res) => setUrl(res.url))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timer = setTimeout(() => setCopyStatus('idle'), COPY_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  }

  async function handleSendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setEmailResult(null);
    try {
      await sendDropoffLinkEmail(email.trim());
      setEmailResult({ type: 'success', message: `Link sent to ${email.trim()}.` });
      setEmail('');
    } catch (err) {
      setEmailResult({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'Failed to send the email — try Copy Link instead.',
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="mt-6">
      <h2 className="text-sm font-semibold text-slate-900">Send Drop-Off Link</h2>
      <p className="mt-1 text-xs text-slate-500">
        Give this to a customer calling about shipping — they can prepare their drop-off online before they arrive.
      </p>

      {loadError && <p className="mt-3 text-sm text-red-600">Couldn&apos;t load the drop-off link right now.</p>}

      {!loadError && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            readOnly
            value={url ?? 'Loading…'}
            onFocus={(event) => event.target.select()}
            className="w-full flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 font-mono text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          />
          <Button type="button" variant="secondary" disabled={!url} onClick={handleCopy} className="shrink-0">
            {copyStatus === 'copied' ? 'Link copied' : copyStatus === 'error' ? 'Copy failed — select and copy' : 'Copy Link'}
          </Button>
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => {
            setShowEmailForm((open) => !open);
            setEmailResult(null);
          }}
          className="text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          {showEmailForm ? 'Cancel' : 'Send by Email'}
        </button>

        {showEmailForm && (
          <form onSubmit={handleSendEmail} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
            <input
              type="email"
              required
              placeholder="customer@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            />
            <Button type="submit" disabled={sending || !url} className="shrink-0">
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </form>
        )}

        {emailResult && (
          <p role={emailResult.type === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${emailResult.type === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
            {emailResult.message}
          </p>
        )}
      </div>
    </Card>
  );
}
