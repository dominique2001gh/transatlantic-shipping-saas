import { Injectable, NotFoundException } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { PublicSiteConfigResponse, TenantLocationSummary, UpdateSiteConfigRequest } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSiteConfigDto } from './dto/update-site-config.dto';
import { UpdateTenantLocationsDto } from './dto/update-tenant-locations.dto';

/**
 * AnanseLogix Phase 2 (Section 15): tenant-branded public website
 * *configuration* — this is data management only, not a website builder
 * or renderer. It exists so a tenant can prepare real content (about,
 * hero copy, service list, locations, social links) ahead of a future
 * cutover, without this app inventing any of it or fabricating a preview
 * that doesn't correspond to a real page anywhere. Trans Atlantic's own
 * public site is untouched by any of this — see Tenant's own doc comment
 * on this schema section, and apps/web/src/lib/site-config.ts's own
 * comment on the intended (future, opt-in) migration path.
 */
@Injectable()
export class SiteConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public, unauthenticated lookup by slug — the shape a future tenant-
   * branded site would render from. Returns 404 (not a distinguishable
   * "entitlement missing" error) for an inactive tenant or one whose plan
   * doesn't include PUBLIC_WEBSITE, the same anti-enumeration posture
   * assertTenantAccess's own doc comment establishes for cross-tenant
   * lookups — a visitor has no legitimate reason to learn *why* a given
   * slug has no site.
   */
  async findPublicBySlug(slug: string): Promise<PublicSiteConfigResponse> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, isActive: true },
      include: { publicLocations: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!tenant) {
      throw new NotFoundException('No public site configured for this address');
    }

    const subscription = await this.prisma.tenantSubscription.findUnique({ where: { tenantId: tenant.id } });
    if (subscription) {
      // No subscription row at all = predates this SaaS layer (grandfathered,
      // fully entitled — same rule EntitlementsGuard's own doc comment
      // documents) — only a tenant *with* a subscription can be denied here.
      const entitlement = await this.prisma.tenantEntitlement.findUnique({
        where: { tenantId_feature: { tenantId: tenant.id, feature: EntitlementFeature.PUBLIC_WEBSITE } },
      });
      if (!entitlement?.enabled) {
        throw new NotFoundException('No public site configured for this address');
      }
    }

    return this.toPublicResponse(tenant, tenant.publicLocations);
  }

  /** For the settings form to prefill from — the authenticated counterpart to findPublicBySlug, no entitlement check (see this service's own class doc comment on why the write/read-own side is never gated). */
  async getOwn(tenantId: string): Promise<UpdateSiteConfigRequest> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        tagline: true,
        aboutContent: true,
        heroHeadline: true,
        heroSubheadline: true,
        serviceTypes: true,
        facebookUrl: true,
        linkedinUrl: true,
        instagramUrl: true,
      },
    });
    return {
      tagline: tenant.tagline ?? undefined,
      aboutContent: tenant.aboutContent ?? undefined,
      heroHeadline: tenant.heroHeadline ?? undefined,
      heroSubheadline: tenant.heroSubheadline ?? undefined,
      serviceTypes: tenant.serviceTypes,
      facebookUrl: tenant.facebookUrl ?? undefined,
      linkedinUrl: tenant.linkedinUrl ?? undefined,
      instagramUrl: tenant.instagramUrl ?? undefined,
    };
  }

  async updateOwn(tenantId: string, dto: UpdateSiteConfigDto): Promise<{ success: true }> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        tagline: dto.tagline,
        aboutContent: dto.aboutContent,
        heroHeadline: dto.heroHeadline,
        heroSubheadline: dto.heroSubheadline,
        serviceTypes: dto.serviceTypes,
        facebookUrl: dto.facebookUrl,
        linkedinUrl: dto.linkedinUrl,
        instagramUrl: dto.instagramUrl,
      },
    });
    return { success: true };
  }

  /**
   * Replace-all rather than incremental add/remove/reorder endpoints — a
   * tenant's location list is short (Section 15 caps it implicitly; this
   * DTO enforces max 20) and always edited as a whole set from a single
   * settings form, the same "the whole list is the unit of edit" shape
   * this app already uses nowhere else because every other list here
   * (shipments, invoices...) is transactional business data, never a
   * small hand-curated content list like this one.
   */
  async replaceLocations(tenantId: string, dto: UpdateTenantLocationsDto): Promise<TenantLocationSummary[]> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.tenantLocation.deleteMany({ where: { tenantId } });
      if (dto.locations.length === 0) return [];
      await tx.tenantLocation.createMany({
        data: dto.locations.map((loc, index) => ({
          tenantId,
          label: loc.label,
          city: loc.city,
          region: loc.region,
          country: loc.country,
          sortOrder: index,
        })),
      });
      return tx.tenantLocation.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
    });
    return rows.map((row) => this.toLocationSummary(row));
  }

  async getOwnLocations(tenantId: string): Promise<TenantLocationSummary[]> {
    const rows = await this.prisma.tenantLocation.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
    return rows.map((row) => this.toLocationSummary(row));
  }

  private toLocationSummary(row: { id: string; label: string; city: string; region: string | null; country: string }): TenantLocationSummary {
    return { id: row.id, label: row.label, city: row.city, region: row.region, country: row.country };
  }

  private toPublicResponse(
    tenant: {
      slug: string;
      name: string;
      tagline: string | null;
      aboutContent: string | null;
      logoUrl: string | null;
      primaryColor: string | null;
      secondaryColor: string | null;
      heroHeadline: string | null;
      heroSubheadline: string | null;
      serviceTypes: string[];
      email: string;
      phone: string | null;
      whatsappNumber: string | null;
      facebookUrl: string | null;
      linkedinUrl: string | null;
      instagramUrl: string | null;
    },
    locations: { id: string; label: string; city: string; region: string | null; country: string }[],
  ): PublicSiteConfigResponse {
    return {
      slug: tenant.slug,
      companyName: tenant.name,
      tagline: tenant.tagline,
      aboutContent: tenant.aboutContent,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      heroHeadline: tenant.heroHeadline,
      heroSubheadline: tenant.heroSubheadline,
      serviceTypes: tenant.serviceTypes,
      contact: { email: tenant.email, phone: tenant.phone, whatsapp: tenant.whatsappNumber },
      locations: locations.map((row) => this.toLocationSummary(row)),
      socialLinks: {
        facebook: tenant.facebookUrl,
        linkedin: tenant.linkedinUrl,
        instagram: tenant.instagramUrl,
        whatsapp: tenant.whatsappNumber,
      },
    };
  }
}
