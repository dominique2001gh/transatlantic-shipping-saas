import type { ManifestPrintDocument as ManifestPrintDocumentData } from '@transatlantic/shared';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';

/**
 * The tenant-branded, printable Manifest document — the single source of
 * truth rendered both for on-screen "Print Manifest" (via window.print(),
 * see the [id]/print route) and, in spirit, GET /manifests/:id/pdf on the
 * backend (manifest-pdf.util.ts renders the same ManifestPrintDocument
 * data independently, since a real downloadable PDF file needs actual
 * server-side generation — this component and that util deliberately stay
 * in sync on *what* they show, not by sharing rendering code across the
 * client/server boundary).
 *
 * Print-safe by design: `.manifest-print` (globals.css) sets `@page`
 * margins and repeats the cargo table's <thead> on every printed page via
 * `display: table-header-group`, with `break-inside: avoid` on each row —
 * the standard multi-page-safe HTML table print pattern, so a long cargo
 * list never splits a row mid-page or loses its column headers partway
 * through.
 */
export function ManifestPrintDocument({ data }: { data: ManifestPrintDocumentData }) {
  const { tenant, manifest, containers, summary, cargo, generatedAt } = data;
  const contactLine = [tenant.email, tenant.phone, tenant.website].filter(Boolean).join('  ·  ');
  const origin = manifest.originWarehouse
    ? `${manifest.originWarehouse.name} (${manifest.originWarehouse.code})`
    : (manifest.originLocation ?? '—');
  const containerLabel =
    containers.length > 0
      ? containers.map((c) => `${c.containerNumber} (${humanizeEnumValue(c.containerType)})`).join(', ')
      : '—';
  const weightLine =
    Object.entries(summary.weightByUnit)
      .map(([unit, total]) => `${total} ${unit}`)
      .join(' + ') || '—';

  return (
    <div className="manifest-print">
      <header className="manifest-print__header">
        <h1>{tenant.legalName ?? tenant.name}</h1>
        {contactLine && <p className="manifest-print__contact">{contactLine}</p>}
      </header>

      <div className="manifest-print__title">
        <h2>Manifest {manifest.manifestNumber}</h2>
        <p>
          Status: <strong>{humanizeEnumValue(manifest.status)}</strong> &nbsp;·&nbsp; Mode:{' '}
          <strong>{humanizeEnumValue(manifest.shipmentMode)}</strong>
        </p>
      </div>

      <dl className="manifest-print__grid">
        <Field label="Origin" value={origin} />
        <Field label="Destination" value={manifest.destinationLocation ?? '—'} />
        <Field label="Carrier" value={manifest.carrierName ?? '—'} />
        {manifest.vesselName && <Field label="Vessel" value={manifest.vesselName} />}
        {manifest.voyageNumber && <Field label="Voyage #" value={manifest.voyageNumber} />}
        {manifest.flightNumber && <Field label="Flight #" value={manifest.flightNumber} />}
        <Field label="Container(s)" value={containerLabel} />
        <Field label="Planned Departure" value={manifest.plannedDepartureAt ? formatDateTime(manifest.plannedDepartureAt) : '—'} />
        <Field label="Actual Departure" value={manifest.departedAt ? formatDateTime(manifest.departedAt) : '—'} />
        <Field label="Estimated Arrival" value={manifest.estimatedArrivalAt ? formatDateTime(manifest.estimatedArrivalAt) : '—'} />
        {manifest.arrivedAt && <Field label="Actual Arrival" value={formatDateTime(manifest.arrivedAt)} />}
      </dl>

      <p className="manifest-print__tallies">
        <strong>{summary.containerCount}</strong> container{summary.containerCount === 1 ? '' : 's'} &nbsp;·&nbsp;
        <strong>{summary.customerCount}</strong> customer{summary.customerCount === 1 ? '' : 's'} &nbsp;·&nbsp;
        <strong>{summary.itemCount}</strong> item{summary.itemCount === 1 ? '' : 's'} &nbsp;·&nbsp; Total weight:{' '}
        <strong>{weightLine}</strong>
      </p>

      <h3 className="manifest-print__section-title">Cargo / Packing List</h3>
      <table className="manifest-print__table">
        <thead>
          <tr>
            <th>Item Code</th>
            <th>Tracking #</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Weight</th>
            <th>Destination</th>
            <th>Container</th>
          </tr>
        </thead>
        <tbody>
          {cargo.length === 0 && (
            <tr>
              <td colSpan={9} className="manifest-print__empty">
                No items on this manifest.
              </td>
            </tr>
          )}
          {cargo.map((row) => (
            <tr key={row.itemCode}>
              <td>{row.itemCode}</td>
              <td>{row.trackingNumber}</td>
              <td>{row.customerName}</td>
              <td>{humanizeEnumValue(row.itemType)}</td>
              <td>{row.description ?? '—'}</td>
              <td>{row.quantity}</td>
              <td>{row.weight ? `${row.weight} ${row.weightUnit}` : '—'}</td>
              <td>{row.destination}</td>
              <td>{row.containerNumber ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="manifest-print__generated">Generated {formatDateTime(generatedAt)}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="manifest-print__field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
