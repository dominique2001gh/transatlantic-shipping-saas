import type { ManifestPrintDocument } from '@transatlantic/shared';
import PDFDocument from 'pdfkit';

/**
 * Renders a ManifestPrintDocument (see ManifestsService.getPrintDocument)
 * into a professional, multi-page-safe PDF — the file GET /manifests/:id/pdf
 * streams back. Deliberately built with `pdfkit` rather than a headless
 * browser (Puppeteer et al.): pdfkit is a small, pure-JS drawing library
 * with no Chromium download/spawn, matching this codebase's existing
 * "no heavy SDK for something a lighter tool can do" posture (see e.g.
 * ResendEmailProvider's/AnthropicPublicAgentProvider's own doc comments)
 * and keeping this feature's memory/build footprint minimal.
 *
 * Returns the readable stream immediately — the caller pipes it to the
 * HTTP response (same "stream directly, don't buffer the whole file in
 * memory" posture DocumentsController.download already uses for R2).
 */
export function renderManifestPdf(doc: ManifestPrintDocument): PDFKit.PDFDocument {
  const pdf = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

  const pageWidth = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;

  // ---------------------------------------------------------------------
  // Header — tenant identity + contact info.
  // ---------------------------------------------------------------------
  pdf.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text(doc.tenant.legalName ?? doc.tenant.name);
  pdf.font('Helvetica').fontSize(9).fillColor('#475569');
  const contactLine = [doc.tenant.email, doc.tenant.phone, doc.tenant.website].filter(Boolean).join('   ·   ');
  if (contactLine) pdf.text(contactLine);
  pdf.moveDown(0.6);
  pdf
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor('#0f172a')
    .text(`Manifest ${doc.manifest.manifestNumber}`);
  pdf
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#334155')
    .text(`Status: ${humanize(doc.manifest.status)}   ·   Mode: ${humanize(doc.manifest.shipmentMode)}`);
  drawRule(pdf, pageWidth);

  // ---------------------------------------------------------------------
  // Transport details grid.
  // ---------------------------------------------------------------------
  const origin = doc.manifest.originWarehouse
    ? `${doc.manifest.originWarehouse.name} (${doc.manifest.originWarehouse.code})`
    : (doc.manifest.originLocation ?? '—');
  const containerNumbers = doc.containers.map((c) => `${c.containerNumber} (${humanize(c.containerType)})`).join(', ') || '—';
  const weightLine =
    Object.entries(doc.summary.weightByUnit)
      .map(([unit, total]) => `${total} ${unit}`)
      .join(' + ') || '—';

  const fields: [string, string][] = [
    ['Origin', origin],
    ['Destination', doc.manifest.destinationLocation ?? '—'],
    ['Carrier', doc.manifest.carrierName ?? '—'],
    ...(doc.manifest.vesselName ? ([['Vessel', doc.manifest.vesselName]] as [string, string][]) : []),
    ...(doc.manifest.voyageNumber ? ([['Voyage #', doc.manifest.voyageNumber]] as [string, string][]) : []),
    ...(doc.manifest.flightNumber ? ([['Flight #', doc.manifest.flightNumber]] as [string, string][]) : []),
    ['Container(s)', containerNumbers],
    ['Planned Departure', formatDate(doc.manifest.plannedDepartureAt)],
    ['Actual Departure', formatDate(doc.manifest.departedAt)],
    ['Estimated Arrival', formatDate(doc.manifest.estimatedArrivalAt)],
  ];
  drawFieldGrid(pdf, fields, pageWidth);
  pdf.moveDown(0.4);

  // ---------------------------------------------------------------------
  // Summary tallies.
  // ---------------------------------------------------------------------
  const tallies = [
    ['Containers', String(doc.summary.containerCount)],
    ['Customers', String(doc.summary.customerCount)],
    ['Items', String(doc.summary.itemCount)],
    ['Total Weight', weightLine],
  ];
  pdf.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
  pdf.text(tallies.map(([label, value]) => `${label}: ${value}`).join('     '));
  drawRule(pdf, pageWidth);

  // ---------------------------------------------------------------------
  // Cargo / Packing List — the reconciliation table.
  // ---------------------------------------------------------------------
  pdf.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Cargo / Packing List');
  pdf.moveDown(0.3);

  const columns: { label: string; width: number; get: (row: ManifestPrintDocument['cargo'][number]) => string }[] = [
    { label: 'Item Code', width: 0.14, get: (r) => r.itemCode },
    { label: 'Tracking #', width: 0.14, get: (r) => r.trackingNumber },
    { label: 'Customer', width: 0.14, get: (r) => r.customerName },
    { label: 'Type', width: 0.09, get: (r) => humanize(r.itemType) },
    { label: 'Description', width: 0.17, get: (r) => r.description ?? '—' },
    { label: 'Qty', width: 0.05, get: (r) => String(r.quantity) },
    { label: 'Weight', width: 0.09, get: (r) => (r.weight ? `${r.weight} ${r.weightUnit}` : '—') },
    { label: 'Destination', width: 0.12, get: (r) => r.destination },
    { label: 'Container', width: 0.11, get: (r) => r.containerNumber ?? '—' },
  ];
  const colWidths = columns.map((c) => c.width * pageWidth);

  drawTableHeader(pdf, columns, colWidths);

  if (doc.cargo.length === 0) {
    pdf.font('Helvetica-Oblique').fontSize(9).fillColor('#64748b').text('No items on this manifest.', { indent: 4 });
  }

  for (const row of doc.cargo) {
    const rowHeight = measureRowHeight(pdf, columns, colWidths, row);
    if (pdf.y + rowHeight > pdf.page.height - pdf.page.margins.bottom) {
      pdf.addPage();
      drawTableHeader(pdf, columns, colWidths);
    }
    drawTableRow(pdf, columns, colWidths, row);
  }

  // ---------------------------------------------------------------------
  // Footer — page numbers + generation timestamp, on every page.
  // ---------------------------------------------------------------------
  const pageCount = pdf.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    pdf.switchToPage(i);
    const bottom = pdf.page.height - pdf.page.margins.bottom + 12;
    // Drawing inside the bottom margin is past maxY(), which pdfkit's own
    // .text() treats as "content overflowed, add a page" — exactly what a
    // footer must never trigger. Zeroing margins.bottom just for this one
    // write (restored immediately after) draws it in place instead.
    const originalBottomMargin = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    pdf
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#94a3b8')
      .text(`Generated ${formatDate(doc.generatedAt)}   ·   Page ${i + 1} of ${pageCount}`, pdf.page.margins.left, bottom, {
        width: pageWidth,
        align: 'center',
        lineBreak: false,
      });
    pdf.page.margins.bottom = originalBottomMargin;
  }

  return pdf;
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function drawRule(pdf: PDFKit.PDFDocument, width: number): void {
  pdf.moveDown(0.3);
  pdf
    .strokeColor('#e2e8f0')
    .lineWidth(1)
    .moveTo(pdf.page.margins.left, pdf.y)
    .lineTo(pdf.page.margins.left + width, pdf.y)
    .stroke();
  pdf.moveDown(0.4);
}

function drawFieldGrid(pdf: PDFKit.PDFDocument, fields: [string, string][], width: number): void {
  const colWidth = width / 2;
  for (let i = 0; i < fields.length; i += 2) {
    const startY = pdf.y;
    const [labelA, valueA] = fields[i];
    drawField(pdf, labelA, valueA, pdf.page.margins.left, startY, colWidth);
    const second = fields[i + 1];
    let usedHeight = pdf.heightOfString(valueA, { width: colWidth - 10 }) + 14;
    if (second) {
      const [labelB, valueB] = second;
      pdf.y = startY;
      drawField(pdf, labelB, valueB, pdf.page.margins.left + colWidth, startY, colWidth);
      usedHeight = Math.max(usedHeight, pdf.heightOfString(valueB, { width: colWidth - 10 }) + 14);
    }
    pdf.y = startY + usedHeight;
  }
}

function drawField(pdf: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width: number): void {
  pdf.font('Helvetica').fontSize(8).fillColor('#64748b').text(label.toUpperCase(), x, y, { width: width - 10 });
  pdf
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#0f172a')
    .text(value, x, pdf.y + 1, { width: width - 10 });
}

type CargoRow = ManifestPrintDocument['cargo'][number];
type Column = { label: string; width: number; get: (row: CargoRow) => string };

const ROW_PADDING = 5;

function drawTableHeader(pdf: PDFKit.PDFDocument, columns: Column[], colWidths: number[]): void {
  const y = pdf.y;
  const left = pdf.page.margins.left;
  pdf.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
  pdf.rect(left, y, colWidths.reduce((a, b) => a + b, 0), 18).fill('#1e293b');
  let x = left;
  for (let i = 0; i < columns.length; i++) {
    pdf.fillColor('#ffffff').text(columns[i].label, x + 3, y + 5, { width: colWidths[i] - 6 });
    x += colWidths[i];
  }
  pdf.y = y + 18;
}

function measureRowHeight(pdf: PDFKit.PDFDocument, columns: Column[], colWidths: number[], row: CargoRow): number {
  let maxHeight = 0;
  for (let i = 0; i < columns.length; i++) {
    const text = columns[i].get(row);
    const h = pdf.heightOfString(text, { width: colWidths[i] - 6 });
    maxHeight = Math.max(maxHeight, h);
  }
  return maxHeight + ROW_PADDING * 2;
}

function drawTableRow(pdf: PDFKit.PDFDocument, columns: Column[], colWidths: number[], row: CargoRow): void {
  const y = pdf.y;
  const height = measureRowHeight(pdf, columns, colWidths, row);
  const left = pdf.page.margins.left;
  pdf
    .rect(left, y, colWidths.reduce((a, b) => a + b, 0), height)
    .strokeColor('#e2e8f0')
    .lineWidth(0.5)
    .stroke();
  let x = left;
  pdf.font('Helvetica').fontSize(8).fillColor('#1e293b');
  for (let i = 0; i < columns.length; i++) {
    pdf.text(columns[i].get(row), x + 3, y + ROW_PADDING, { width: colWidths[i] - 6 });
    x += colWidths[i];
  }
  pdf.y = y + height;
}
