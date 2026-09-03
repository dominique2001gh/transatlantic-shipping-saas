import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, WebsiteLeadStatus, WebsiteLeadType } from '@prisma/client';
import type { WebsiteLeadSummary } from '@transatlantic/shared';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';

/**
 * Website Launch: the public (unauthenticated) lead-capture chokepoint —
 * everything the marketing site's Contact and Request-a-Quote forms
 * ultimately call. Deliberately separate from QuotesService/CustomersService:
 * a website visitor isn't a Customer yet, and this never creates one —
 * staff review captured leads and manually create a real Customer/Quote
 * through the existing flows if/when one converts.
 *
 * `create()` resolves the tenant by slug, the same pattern
 * TrackingService.lookupPublic already uses for the public tracking
 * lookup, since there is no authenticated session on a public form to
 * derive tenant identity from otherwise.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async create(dto: CreateLeadDto): Promise<{ success: true }> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug: dto.tenantSlug.trim(), isActive: true },
    });
    if (!tenant) {
      // A wrong tenantSlug here is a client bug (it's hard-coded in this
      // deployment's own siteConfig, never visitor-suppliable), not an
      // attack surface to hide behind a vague error the way the public
      // tracking lookup's anti-enumeration posture requires — a plain,
      // honest 404 is the right response.
      throw new NotFoundException('Unknown tenant');
    }

    const lead = await this.prisma.websiteLead.create({
      data: {
        tenantId: tenant.id,
        type: dto.type,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        subject: dto.subject,
        message: dto.message,
        quoteDetails: dto.quoteDetails as unknown as Prisma.InputJsonValue | undefined,
      },
    });

    // Best-effort only — a notification failure must never fail the
    // visitor's form submission. Uses the existing EmailProvider
    // abstraction (console/no-op today, a real provider later) exactly
    // like every Stage 3H customer notification already does; this is
    // the one case of notifying a *tenant* rather than a customer, so it
    // calls the provider directly instead of going through
    // NotificationsService, which is customer-fan-out shaped.
    try {
      const typeLabel = dto.type === WebsiteLeadType.QUOTE_REQUEST ? 'quote request' : 'contact message';
      await this.emailProvider.send({
        to: tenant.email,
        subject: `New website ${typeLabel} from ${dto.firstName} ${dto.lastName ?? ''}`.trim(),
        body: this.formatLeadEmail(dto),
      });
    } catch (err) {
      this.logger.error(`Failed to send lead-notification email for lead ${lead.id}: ${err}`);
    }

    return { success: true };
  }

  async findAll(tenantId: string, filters: { status?: WebsiteLeadStatus; type?: WebsiteLeadType }): Promise<WebsiteLeadSummary[]> {
    const leads = await this.prisma.websiteLead.findMany({
      where: {
        tenantId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { type: filters.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return leads.map((lead) => this.toSummary(lead));
  }

  async updateStatus(tenantId: string, id: string, status: WebsiteLeadStatus): Promise<WebsiteLeadSummary> {
    const existing = await this.prisma.websiteLead.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException('Lead not found');
    }
    const updated = await this.prisma.websiteLead.update({ where: { id }, data: { status } });
    return this.toSummary(updated);
  }

  private formatLeadEmail(dto: CreateLeadDto): string {
    const lines = [
      `Name: ${dto.firstName} ${dto.lastName ?? ''}`.trim(),
      `Email: ${dto.email}`,
      dto.phone ? `Phone: ${dto.phone}` : null,
      dto.subject ? `Subject: ${dto.subject}` : null,
      dto.message ? `Message: ${dto.message}` : null,
      dto.quoteDetails ? `Shipment details: ${JSON.stringify(dto.quoteDetails)}` : null,
    ].filter((line): line is string => line !== null);
    return lines.join('\n');
  }

  private toSummary(lead: {
    id: string;
    type: WebsiteLeadType;
    status: WebsiteLeadStatus;
    firstName: string;
    lastName: string | null;
    email: string;
    phone: string | null;
    subject: string | null;
    message: string | null;
    quoteDetails: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): WebsiteLeadSummary {
    return {
      id: lead.id,
      type: lead.type as unknown as WebsiteLeadSummary['type'],
      status: lead.status as unknown as WebsiteLeadSummary['status'],
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      subject: lead.subject,
      message: lead.message,
      quoteDetails: (lead.quoteDetails as unknown as WebsiteLeadSummary['quoteDetails']) ?? null,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    };
  }
}
