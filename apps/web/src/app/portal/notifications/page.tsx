'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PortalNotificationSummary } from '@transatlantic/shared';
import { IconBox } from '@/components/icons';
import { Card } from '@/components/ui/Card';
import { formatDateTime } from '@/lib/format';
import { getPortalNotifications, markPortalNotificationRead } from '@/lib/portal-notifications';

/** Where a notification's "view" link should go, based on which single source ref (if any) its originating event carried. At most one is ever set — see PortalNotificationSummary's own doc comment. */
function linkFor(notification: PortalNotificationSummary): string | null {
  if (notification.shipmentId) return `/portal/shipments/${notification.shipmentId}`;
  if (notification.invoiceId) return `/portal/invoices/${notification.invoiceId}`;
  if (notification.documentId) return '/portal/documents';
  return null;
}

/**
 * Stage 3H: the customer's own in-app notifications — GET /portal/notifications
 * already excludes EMAIL/SMS/WHATSAPP delivery rows and is scoped
 * server-side to this customer's own tenant + Customer record. Clicking
 * an unread notification marks it read and, where the originating event
 * carried a shipment/invoice reference, navigates there.
 */
export default function PortalNotificationsPage() {
  const [notifications, setNotifications] = useState<PortalNotificationSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getPortalNotifications()
      .then(setNotifications)
      .catch(() => setError(true));
  }, []);

  async function handleOpen(notification: PortalNotificationSummary) {
    if (!notification.readAt) {
      try {
        const updated = await markPortalNotificationRead(notification.id);
        setNotifications((prev) => prev?.map((n) => (n.id === updated.id ? updated : n)) ?? null);
      } catch {
        // Non-fatal — the notification just stays showing as unread; the
        // customer can still navigate via the link below regardless.
      }
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Notifications</h1>
        <p className="mt-1 text-sm text-slate-500">Updates about your shipments, invoices, and documents.</p>
      </div>

      <Card className="mt-6 p-0">
        {error && (
          <p className="p-6 text-sm text-red-600">
            We couldn&apos;t load your notifications right now. Please refresh the page, or contact us if this keeps
            happening.
          </p>
        )}

        {!error && !notifications && (
          <div className="divide-y divide-slate-100 px-4 sm:px-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-4">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1">
                  <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
                  <div className="mt-2 h-3 w-56 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!error && notifications && notifications.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <IconBox className="h-6 w-6" />
            </span>
            <h2 className="mt-2 text-base font-semibold text-slate-900">No notifications yet</h2>
            <p className="max-w-sm px-6 text-sm text-slate-500">
              Updates about your shipments, invoices, and documents will show up here as they happen.
            </p>
          </div>
        )}

        {!error && notifications && notifications.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {notifications.map((notification) => {
              const href = linkFor(notification);
              const isUnread = !notification.readAt;
              const content = (
                <div className={`flex items-start gap-3 px-4 py-4 sm:px-6 ${isUnread ? 'bg-primary-50/40' : ''}`}>
                  {isUnread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600" aria-label="Unread" />}
                  <div className={isUnread ? '' : 'pl-5'}>
                    <p className="text-sm font-medium text-slate-900">{notification.title}</p>
                    <p className="mt-0.5 text-sm text-slate-600">{notification.body}</p>
                    <p className="mt-1 text-xs text-slate-400">{formatDateTime(notification.createdAt)}</p>
                  </div>
                </div>
              );
              return (
                <li key={notification.id}>
                  {href ? (
                    <Link href={href} onClick={() => handleOpen(notification)} className="block hover:bg-slate-50">
                      {content}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => handleOpen(notification)} className="block w-full text-left hover:bg-slate-50">
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
