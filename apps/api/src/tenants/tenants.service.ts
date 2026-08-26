import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** PLATFORM_ADMIN only — lists every tenant on the platform. */
  findAll() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** PLATFORM_ADMIN only — arbitrary tenant lookup by id. */
  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  /** Used by tenant staff to fetch only their own tenant (GET /tenants/me). */
  async findOwnTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  /**
   * Onboards a new tenant with sane defaults (TenantSettings row using
   * platform-default numbering prefixes, which the tenant can customize
   * later). PLATFORM_ADMIN only.
   */
  create(dto: CreateTenantDto) {
    return this.prisma.tenant.create({
      data: {
        ...dto,
        settings: {
          create: {},
        },
      },
      include: { settings: true },
    });
  }
}
