'use client';

import { useEffect, useState } from 'react';
import type { InvoiceSummary, PortalCustomerProfile, PortalNotificationSummary, PortalShipmentSummary } from '@transatlantic/shared';
import { PAYABLE_INVOICE_STATUSES } from '@transatlantic/shared';
import Link from 'next/link';
import {
  IconArrowRight,
  IconBox,
  IconCheckCircle,
  IconClock,
  IconHeadset,
  IconMapPin,
  IconShip,
} from '@/components/icons';
import { PortalShipmentRow } from '@/components/portal/PortalShipmentRow';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { getPortalInvoices } from '@/lib/portal-invoices';
import { getPortalNotifications } from '@/lib/portal-notifications';
import { getPortalProfile, listPortalShipments } from '@/lib/portal';
import { bucketForShipment, isActiveShipment } from '@/lib/portal-shipment-status';

const RECENT_SHIPMENT_COUNT = 3;
const RECENT_NOTIFICATION_COUNT = 3;

/**
 * Sums balanceDue (a fixed 2-decimal string, see money.util.ts) per
 * currency across every invoice that's actually payable — never blindly
 * summed across invoices regardless of currency, since two invoices on
 * the same account could in principle be issued in different currencies.
 * Returns one formatted string per currency present, e.g.
 * ["$1,234.50", "GH₵500.00"], so the dashboard tile is always honest even
 * in that edge case, rather than silently mixing currencies into one
 * meaningless number.
 */
function outstandingBalanceByCurrency(invoices: InvoiceSummary[]): { currency: string; formatted: string }[] {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) continue;
    const amount = Number.parseFloat(invoice.balanceDue);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + amount);
  }
  return Array.from(totals.entries()).map(([currency, total]) => ({
    currency,
    formatted: formatCurrency(total.toFixed(2), currency),
  }));
}

/**
 * Customer dashboard. Deliberately an *overview*, not a second copy of any
 * list page — summary tiles + short recent slices, with clear links out to
 * the full lists. Every number here is derived client-side from
 * GET /portal/shipments, GET /portal/invoices, and GET /portal/notifications
 * — all three already scoped server-side to this customer's own account
 * (see CustomerPortalService) — this page does no filtering that matters
 * for security, only for what's shown where.
 */
export default function PortalOverviewPage() {
  const [profile, setProfile] = useState<PortalCustomerProfile | null>(null);
  const [shipments, setShipments] = useState<PortalShipmentSummary[] | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [notifications, setNotifications] = useState<PortalNotificationSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([getPortalProfile(), listPortalShipments(), getPortalInvoices(), getPortalNotifications()])
      .then(([profileResult, shipmentsResult, invoicesResult, notificationsResult]) => {
        setProfile(profileResult);
        setShipments(shipmentsResult);
        setInvoices(invoicesResult);
        setNotifications(notificationsResult);
      })
      .catch(() => setError(true));
  }, []);

  const loading = !error && (!profile || !shipments || !invoices || !notifications);

  if (error) {
    return (
      <Card className="mt-2">
        <p className="text-sm text-red-600">
          We couldn&apos;t load your dashboard right now. Please refresh the page, or contact us if this keeps
          happening.
        </p>
      </Card>
    );
  }

  if (loading) {
    return (
      <div>
        <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-slate-100" />
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  const allShipments = shipments!;
  const allInvoices = invoices!;
  const allNotifications = notifications!;

  const activeCount = allShipments.filter(isActiveShipment).length;
  const inTransitCount = allShipments.filter((s) => bucketForShipment(s) === 'inTransit').length;
  const arrivedOrReadyCount = allShipments.filter((s) => bucketForShipment(s) === 'arrivedOrReady').length;
  const completedCount = allShipments.filter((s) => bucketForShipment(s) === 'completed').length;
  const recentShipments = allShipments.slice(0, RECENT_SHIPMENT_COUNT);

  const unpaidInvoices = allInvoices.filter((i) => PAYABLE_INVOICE_STATUSES.includes(i.status));
  const outstandingBalances = outstandingBalanceByCurrency(allInvoices);
  const hasOutstandingBalance = outstandingBalances.length > 0;
  // Deep-link straight to the one invoice that needs attention; only fall
  // back to the list page when there's more than one, so this never has to
  // guess which one the customer means.
  const payNowHref =
    unpaidInvoices.length === 1 ? `/portal/invoices/${unpaidInvoices[0].id}` : '/portal/invoices';

  const recentNotifications = allNotifications.slice(0, RECENT_NOTIFICATION_COUNT);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Welcome back, {profile!.firstName}</h1>
      <p className="mt-1 text-sm text-slate-500">Here&apos;s a quick look at your account.</p>

      {/* Quick actions — always available, regardless of whether there's any data yet. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {hasOutstandingBalance && (
          <LinkButton href={payNowHref} size="sm">
            Pay outstanding invoice
          </LinkButton>
        )}
        <LinkButton href="/portal/documents" variant="secondary" size="sm">
          View documents
        </LinkButton>
        <LinkButton href="/portal/profile" variant="secondary" size="sm">
          Update profile
        </LinkButton>
        <LinkButton href="/contact" variant="ghost" size="sm">
          <IconHeadset className="h-4 w-4" />
          Contact support
        </LinkButton>
      </div>

      {allShipments.length === 0 ? (
        <Card className="mt-6 flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <IconBox className="h-6 w-6" />
          </span>
          <h2 className="mt-2 text-base font-semibold text-slate-900">No shipments yet</h2>
          <p className="max-w-sm text-sm text-slate-500">
            Once your shipping company adds a shipment to your account, it will show up here with live status
            updates.
          </p>
        </Card>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="flex flex-col gap-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <IconBox className="h-4 w-4" />
              </span>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{activeCount}</p>
              <p className="text-sm text-slate-500">Active Shipments</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <IconShip className="h-4 w-4" />
              </span>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{inTransitCount}</p>
              <p className="text-sm text-slate-500">In Transit</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <IconMapPin className="h-4 w-4" />
              </span>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{arrivedOrReadyCount}</p>
              <p className="text-sm text-slate-500">Arrived / Ready</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <IconCheckCircle className="h-4 w-4" />
              </span>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{completedCount}</p>
              <p className="text-sm text-slate-500">Completed</p>
            </Card>
          </div>

          <Card className="mt-6 p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">Recent shipments</h2>
              <LinkButton href="/portal/shipments" variant="ghost" size="sm">
                View all
                <IconArrowRight className="h-4 w-4" />
              </LinkButton>
            </div>
            <div className="divide-y divide-slate-100 px-4 sm:px-6">
              {recentShipments.map((shipment) => (
                <PortalShipmentRow key={shipment.id} shipment={shipment} />
              ))}
            </div>
          </Card>
        </>
      )}

      {/* Invoices + notifications — shown once there's at least something on the account to summarize, so a brand-new customer with no shipments isn't shown two more empty cards. */}
      {allShipments.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Invoices</h2>
              <LinkButton href="/portal/invoices" variant="ghost" size="sm">
                View all
                <IconArrowRight className="h-4 w-4" />
              </LinkButton>
            </div>
            {allInvoices.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No invoices yet.</p>
            ) : hasOutstandingBalance ? (
              <div className="mt-3">
                <div className="flex items-center gap-2 text-amber-700">
                  <IconClock className="h-4 w-4 shrink-0" />
                  <p className="text-sm font-medium">
                    {unpaidInvoices.length} invoice{unpaidInvoices.length === 1 ? '' : 's'} need
                    {unpaidInvoices.length === 1 ? 's' : ''} payment
                  </p>
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {outstandingBalances.map((b) => b.formatted).join(' + ')}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">Outstanding balance</p>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 text-emerald-700">
                <IconCheckCircle className="h-4 w-4 shrink-0" />
                <p className="text-sm font-medium">All invoices paid — nothing due.</p>
              </div>
            )}
          </Card>

          <Card className="p-0">
            <div className="flex items-center justify-between px-6 pt-6">
              <h2 className="text-base font-semibold text-slate-900">Recent notifications</h2>
              <LinkButton href="/portal/notifications" variant="ghost" size="sm">
                View all
                <IconArrowRight className="h-4 w-4" />
              </LinkButton>
            </div>
            {recentNotifications.length === 0 ? (
              <p className="px-6 pb-6 pt-3 text-sm text-slate-500">No notifications yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 px-4 pb-2 sm:px-6">
                {recentNotifications.map((notification) => (
                  <li key={notification.id} className="py-3">
                    <Link href="/portal/notifications" className="block hover:opacity-80">
                      <div className="flex items-start gap-2">
                        {!notification.readAt && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600" aria-label="Unread" />
                        )}
                        <div className={notification.readAt ? 'pl-4' : ''}>
                          <p className="text-sm font-medium text-slate-900">{notification.title}</p>
                          <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(notification.createdAt)}</p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
