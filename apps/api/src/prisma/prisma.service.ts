import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around PrismaClient, managed by Nest's lifecycle hooks.
 *
 * IMPORTANT — tenant isolation pattern used throughout this codebase:
 * PrismaService does NOT auto-inject tenantId filters. Every service
 * method that reads/writes a tenant-owned table must explicitly include
 * `tenantId` (sourced from the authenticated user's JWT via
 * @CurrentUser(), never from client input) in its `where` clause, e.g.:
 *
 *   this.prisma.customer.findFirst({ where: { id, tenantId } })
 *
 * This keeps every query's scoping visible and reviewable at the call
 * site instead of relying on implicit, easy-to-misconfigure global
 * middleware. See src/common/tenant/tenant.util.ts for the
 * assertTenantAccess() defense-in-depth check to pair with this.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL via Prisma');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
