import Link from 'next/link';
import { Card } from '@/components/ui/Card';

const FEATURES = [
  {
    title: 'Multi-modal shipping',
    description:
      'Air, ocean LCL, ocean FCL and RoRo — one platform for every way cargo moves, not just barrels.',
  },
  {
    title: 'Real-time tracking',
    description:
      'A full status history for every shipment, from warehouse receipt to final delivery.',
  },
  {
    title: 'Built for multiple markets',
    description:
      'Serve customers shipping to Ghana, Nigeria, Sierra Leone, Liberia and beyond from one account.',
  },
  {
    title: 'Warehouse & container ops',
    description:
      'Manage origin and destination warehouses, consolidate shipments, and build container manifests.',
  },
];

export default function HomePage() {
  return (
    <>
      <section className="bg-gradient-to-b from-primary-950 via-primary-900 to-primary-800 text-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-accent-400">
              Freight forwarding, modernized
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Ship to Ghana and beyond, without the spreadsheets.
            </h1>
            <p className="mt-6 text-lg text-primary-100">
              A single platform for freight forwarders to manage customers, shipments,
              warehouses, containers, and tracking — from origin to destination.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/track"
                className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-primary-900 hover:bg-primary-50"
              >
                Track a Shipment
              </Link>
              <Link
                href="/register"
                className="rounded-md border border-white/30 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                Create an Account
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <h3 className="text-base font-semibold text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{feature.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h2 className="text-2xl font-semibold text-slate-900">
            Already shipping with us?
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Log in to your customer portal to view your shipments, invoices, and documents.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex rounded-md bg-primary-700 px-5 py-3 text-sm font-semibold text-white hover:bg-primary-800"
          >
            Log In
          </Link>
        </div>
      </section>
    </>
  );
}
