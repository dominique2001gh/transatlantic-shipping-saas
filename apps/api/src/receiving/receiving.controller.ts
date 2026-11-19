import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile as UploadedFileParam, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EntitlementFeature, ReceivingRecordStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { OPERATIONS_ROLES } from '@transatlantic/shared';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_SIZE_BYTES, type UploadedFile } from '../documents/documents.service';
import { CreateDocumentDto } from '../documents/dto/create-document.dto';
import { CreateReceivingRecordDto } from './dto/create-receiving-record.dto';
import { UpdateReceivingRecordDto } from './dto/update-receiving-record.dto';
import { ReceivingService } from './receiving.service';

// Receiving/correcting is available to OPERATIONS_ROLES (OWNER/MANAGER/
// STAFF) — the spec explicitly allows warehouse staff to log and correct
// receiving records. FINANCE has no access, matching its closed-list remit
// everywhere else in this codebase.
const VIEW_ROLES = OPERATIONS_ROLES;
const MANAGE_ROLES = OPERATIONS_ROLES;

const VALID_STATUSES = new Set<string>(Object.values(ReceivingRecordStatus));

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

@Controller('receiving')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
export class ReceivingController {
  constructor(private readonly receivingService: ReceivingService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  @RequirePermission('receiving.view')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('awaitingConsolidation') awaitingConsolidation?: string,
  ) {
    const validStatus = status && VALID_STATUSES.has(status) ? (status as ReceivingRecordStatus) : undefined;
    return this.receivingService.findAll(requireTenantId(user.tenantId), {
      customerId,
      status: validStatus,
      awaitingConsolidation: awaitingConsolidation === 'true',
    });
  }

  // Must stay above @Get(':id') — Nest/Express match routes in declaration
  // order, so 'search' would otherwise be swallowed as an :id value (same
  // convention as ShipmentsController.search).
  @Get('search')
  @Roles(...VIEW_ROLES)
  @RequirePermission('receiving.view')
  search(@CurrentUser() user: AuthenticatedUser, @Query('query') query?: string) {
    return this.receivingService.search(requireTenantId(user.tenantId), query ?? '');
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  @RequirePermission('receiving.view')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.receivingService.findById(requireTenantId(user.tenantId), id);
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  @RequirePermission('receiving.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReceivingRecordDto) {
    return this.receivingService.create(requireTenantId(user.tenantId), user.id, dto);
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('receiving.manage')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateReceivingRecordDto) {
    return this.receivingService.update(requireTenantId(user.tenantId), user.id, id, dto);
  }

  @Post(':id/cancel')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('receiving.manage')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body('reason') reason?: string) {
    return this.receivingService.cancel(requireTenantId(user.tenantId), user.id, id, reason);
  }

  @Post(':id/photo')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('receiving.manage')
  @UseInterceptors(FileInterceptor('file', UPLOAD_INTERCEPTOR_OPTIONS))
  uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFileParam() file: UploadedFile,
    @Body() dto: CreateDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.receivingService.uploadPhoto(requireTenantId(user.tenantId), user.id, id, file, dto);
  }
}
