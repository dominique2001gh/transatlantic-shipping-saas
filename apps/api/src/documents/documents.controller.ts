import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { DOCUMENT_MANAGE_ROLES } from '@transatlantic/shared';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_SIZE_BYTES, type UploadedFile } from './documents.service';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

const MANAGE_ROLES = DOCUMENT_MANAGE_ROLES;
const VIEW_ROLES = MANAGE_ROLES;

/**
 * Multer buffers the upload in memory (never writes to disk itself —
 * DocumentsService/StorageProvider owns where bytes actually land) and
 * rejects anything oversized or of a disallowed mimetype before the
 * request body is even fully read. DocumentsService.validateFile
 * re-checks both independently — defense in depth, not trusting this
 * interceptor alone (the same posture every other boundary check in this
 * codebase takes).
 */
const UPLOAD_INTERCEPTOR_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
  fileFilter: (_req: unknown, file: { mimetype: string }, callback: (error: Error | null, accept: boolean) => void) => {
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      callback(new BadRequestException('Unsupported file type — only PDF, PNG, and JPEG are accepted'), false);
      return;
    }
    callback(null, true);
  },
};

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('shipments/:shipmentId')
  @Roles(...MANAGE_ROLES)
  @UseInterceptors(FileInterceptor('file', UPLOAD_INTERCEPTOR_OPTIONS))
  uploadForShipment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shipmentId') shipmentId: string,
    @UploadedFileParam() file: UploadedFile,
    @Body() dto: CreateDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.documentsService.uploadForShipment(requireTenantId(user.tenantId), user.id, shipmentId, file, dto);
  }

  @Post('customers/:customerId')
  @Roles(...MANAGE_ROLES)
  @UseInterceptors(FileInterceptor('file', UPLOAD_INTERCEPTOR_OPTIONS))
  uploadForCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId') customerId: string,
    @UploadedFileParam() file: UploadedFile,
    @Body() dto: CreateDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.documentsService.uploadForCustomer(requireTenantId(user.tenantId), user.id, customerId, file, dto);
  }

  @Get()
  @Roles(...VIEW_ROLES)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('customerId') customerId?: string,
    @Query('shipmentId') shipmentId?: string,
    @Query('type') type?: string,
  ) {
    return this.documentsService.findAllForTenant(requireTenantId(user.tenantId), { customerId, shipmentId, type });
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documentsService.findByIdForTenant(requireTenantId(user.tenantId), id);
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.documentsService.update(requireTenantId(user.tenantId), id, dto);
  }

  /**
   * Streams the file directly for the local provider; redirects to a
   * signed URL for any future provider that returns `{ kind: 'redirect' }`
   * instead — see storage/storage.provider.ts's DownloadTarget doc
   * comment. Uses raw `@Res()` (not passthrough) since the two branches
   * need genuinely different response handling; the service call that can
   * throw NotFoundException happens before either branch touches `res`,
   * so Nest's normal exception handling still applies.
   */
  @Get(':id/download')
  @Roles(...VIEW_ROLES)
  async download(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const { fileName, mimeType, target } = await this.documentsService.getDownloadTargetForTenant(
      requireTenantId(user.tenantId),
      id,
    );
    sendDownload(res, fileName, mimeType, target);
  }
}

/** Shared by both the staff and customer-portal download handlers. */
export function sendDownload(
  res: Response,
  fileName: string,
  mimeType: string | null,
  target: { kind: 'stream'; stream: NodeJS.ReadableStream } | { kind: 'redirect'; url: string },
): void {
  if (target.kind === 'redirect') {
    res.redirect(target.url);
    return;
  }
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  res.set({
    'Content-Type': mimeType ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  });
  target.stream.pipe(res);
}
