import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DocumentSummary, PortalDocumentSummary } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER, type DownloadTarget, type StorageProvider } from '../storage/storage.provider';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

/** 20MB — generous enough for a scanned multi-page BOL/customs form PDF, small enough to keep memory-buffered uploads (see multer config in DocumentsController) safe. */
export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;

/** Deliberately narrow — document scans and photos only, nothing executable. Extend here (not per-call) if a real need for another type shows up. */
export const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

const DISPLAY_INCLUDE = {
  customer: { select: { firstName: true, lastName: true } },
  shipment: { select: { trackingNumber: true } },
  uploadedByUser: { select: { firstName: true, lastName: true } },
} as const;

type DocumentWithDisplayFields = Prisma.DocumentGetPayload<{ include: typeof DISPLAY_INCLUDE }>;

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Stage 3G: every method takes tenantId as an explicit first parameter
 * (sourced by the controller from the caller's verified JWT), same
 * per-query tenant-scoping convention every other service in this
 * codebase follows. Upload methods never accept a caller-supplied
 * customerId/shipmentId pairing on faith — see uploadForShipment/
 * uploadForCustomer below.
 *
 * DocumentsService never touches the filesystem or any cloud SDK
 * directly — file bytes only ever move through the injected
 * StorageProvider (see storage/storage.provider.ts), which is what keeps
 * this service itself provider-agnostic.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /** Attaches a document to a shipment — customerId is always the shipment's own, derived server-side, never client-supplied, so a document can never end up attributed to a shipment/customer pair that don't actually belong together. */
  async uploadForShipment(
    tenantId: string,
    uploadedByUserId: string,
    shipmentId: string,
    file: UploadedFile,
    dto: CreateDocumentDto,
  ): Promise<DocumentSummary> {
    const shipment = await this.prisma.shipment.findFirst({ where: { id: shipmentId, tenantId } });
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }
    return this.storeAndCreate(
      tenantId,
      uploadedByUserId,
      { shipmentId, customerId: shipment.customerId },
      file,
      dto,
    );
  }

  /** Attaches a document to a customer directly — for documents not tied to one specific shipment (e.g. an ID document on file). */
  async uploadForCustomer(
    tenantId: string,
    uploadedByUserId: string,
    customerId: string,
    file: UploadedFile,
    dto: CreateDocumentDto,
  ): Promise<DocumentSummary> {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return this.storeAndCreate(tenantId, uploadedByUserId, { shipmentId: null, customerId }, file, dto);
  }

  async findAllForTenant(
    tenantId: string,
    filters: { customerId?: string; shipmentId?: string; type?: string },
  ): Promise<DocumentSummary[]> {
    const documents = await this.prisma.document.findMany({
      where: {
        tenantId,
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.shipmentId ? { shipmentId: filters.shipmentId } : {}),
        ...(filters.type ? { type: filters.type as Prisma.DocumentWhereInput['type'] } : {}),
      },
      include: DISPLAY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((doc) => this.toSummary(doc));
  }

  async findByIdForTenant(tenantId: string, id: string): Promise<DocumentSummary> {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId }, include: DISPLAY_INCLUDE });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    return this.toSummary(doc);
  }

  async update(tenantId: string, id: string, dto: UpdateDocumentDto): Promise<DocumentSummary> {
    const existing = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException('Document not found');
    }
    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.visibleToCustomer !== undefined ? { visibleToCustomer: dto.visibleToCustomer } : {}),
      },
      include: DISPLAY_INCLUDE,
    });
    return this.toSummary(updated);
  }

  /** Staff download — tenant-scoped only, matching every other staff resource (a staff member can reach any document in their own tenant, visible-to-customer or not). */
  async getDownloadTargetForTenant(tenantId: string, id: string): Promise<{ fileName: string; mimeType: string | null; target: DownloadTarget }> {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    const target = await this.storage.getDownloadTarget(doc.fileUrl);
    return { fileName: doc.fileName, mimeType: doc.mimeType, target };
  }

  /**
   * Stage 3G: GET /portal/documents — the customer's own visible
   * documents only. `visibleToCustomer: true` is the visibility rule,
   * exactly mirroring InvoicesService.findAllForCustomer's
   * `status: { not: DRAFT }` — a staff-only document must never reach a
   * customer, even indirectly.
   */
  async findAllForCustomer(tenantId: string, customerId: string): Promise<PortalDocumentSummary[]> {
    const documents = await this.prisma.document.findMany({
      where: { tenantId, customerId, visibleToCustomer: true },
      include: { shipment: { select: { trackingNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((doc) => this.toPortalSummary(doc));
  }

  /**
   * Stage 3G: GET /portal/documents/:id. Scoped by tenantId AND
   * customerId AND visibleToCustomer:true in one query — a staff-only
   * document, another customer's document, or another tenant's document
   * are all indistinguishable from a nonexistent id, all producing this
   * same 404 (see InvoicesService.findByIdForCustomer's identical Stage
   * 3E pattern, and documents.e2e-spec.ts for the byte-identical-404
   * proof here too).
   */
  async findByIdForCustomer(tenantId: string, customerId: string, id: string): Promise<PortalDocumentSummary> {
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId, customerId, visibleToCustomer: true },
      include: { shipment: { select: { trackingNumber: true } } },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    return this.toPortalSummary(doc);
  }

  /**
   * Customer download — findByIdForCustomer above is the actual
   * authorization gate; only once it has succeeded is it safe to resolve
   * the file itself, the same ordering-is-the-security-boundary
   * discipline CustomerPortalService.getInvoice already documents for
   * payments.
   */
  async getDownloadTargetForCustomer(
    tenantId: string,
    customerId: string,
    id: string,
  ): Promise<{ fileName: string; mimeType: string | null; target: DownloadTarget }> {
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId, customerId, visibleToCustomer: true },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    const target = await this.storage.getDownloadTarget(doc.fileUrl);
    return { fileName: doc.fileName, mimeType: doc.mimeType, target };
  }

  private async storeAndCreate(
    tenantId: string,
    uploadedByUserId: string,
    ids: { shipmentId: string | null; customerId: string | null },
    file: UploadedFile,
    dto: CreateDocumentDto,
  ): Promise<DocumentSummary> {
    validateFile(file);

    const storageKey = await this.storage.save({ tenantId, fileName: file.originalname, buffer: file.buffer });

    const created = await this.prisma.document.create({
      data: {
        tenantId,
        customerId: ids.customerId,
        shipmentId: ids.shipmentId,
        type: dto.type,
        fileName: file.originalname,
        fileUrl: storageKey,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        description: dto.description,
        visibleToCustomer: dto.visibleToCustomer ?? false,
        uploadedByUserId,
      },
      include: DISPLAY_INCLUDE,
    });

    return this.toSummary(created);
  }

  private toSummary(doc: DocumentWithDisplayFields): DocumentSummary {
    return {
      id: doc.id,
      tenantId: doc.tenantId,
      customerId: doc.customerId,
      customerName: doc.customer ? `${doc.customer.firstName} ${doc.customer.lastName}` : null,
      shipmentId: doc.shipmentId,
      shipmentTrackingNumber: doc.shipment?.trackingNumber ?? null,
      type: doc.type as unknown as DocumentSummary['type'],
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      description: doc.description,
      visibleToCustomer: doc.visibleToCustomer,
      uploadedByUserId: doc.uploadedByUserId,
      uploadedByName: doc.uploadedByUser ? `${doc.uploadedByUser.firstName} ${doc.uploadedByUser.lastName}` : null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  private toPortalSummary(doc: Prisma.DocumentGetPayload<{ include: { shipment: { select: { trackingNumber: true } } } }>): PortalDocumentSummary {
    return {
      id: doc.id,
      shipmentId: doc.shipmentId,
      shipmentTrackingNumber: doc.shipment?.trackingNumber ?? null,
      type: doc.type as unknown as PortalDocumentSummary['type'],
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      description: doc.description,
      createdAt: doc.createdAt.toISOString(),
    };
  }
}

/** Multer's own `limits.fileSize`/`fileFilter` (see DocumentsController) already reject an oversized/disallowed upload before it reaches here — this is the same check run again at the service boundary, not trusting the interceptor alone. */
function validateFile(file: UploadedFile): void {
  if (!file) {
    throw new BadRequestException('A file is required');
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new BadRequestException(`File exceeds the ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)}MB limit`);
  }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
    throw new BadRequestException('Unsupported file type — only PDF, PNG, and JPEG are accepted');
  }
}
