import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformLeadSource, PlatformLeadStatus } from '@prisma/client';
import type { PlatformLeadSummary } from '@transatlantic/shared';
import { demoRequestConfirmationEmail } from '../notifications/templates/platform-emails';
import { resolvePlatformEmailSender } from '../notifications/providers/platform-email-sender.util';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlatformLeadDto } from './dto/create-platform-lead.dto';

/**
 * AnanseLogix Phase 1: the marketing site's Demo/Contact form chokepoint —
 * a prospect wanting to *become* a tenant, never an existing tenant's own
 * shipping customer (that's WebsiteLead/LeadsService, a separate concern —
 * see PlatformLead's own schema doc comment). Mirrors LeadsService's shape
 * closely: public capture + best-effort confirmation email + staff (here,
 * platform-admin) triage, never auto-converting into a real
 * Tenant/SignupSession.
 */
@Injectable()
export class PlatformLeadsService {
  private readonly logger = new Logger(PlatformLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async create(dto: CreatePlatformLeadDto): Promise<{ success: true }> {
    const lead = await this.prisma.platformLead.create({
      data: {
        companyName: dto.companyName,
        contactName: dto.contactName,
        phone: dto.phone,
        email: dto.email,
        country: dto.country,
        currentWorkflow: dto.currentWorkflow,
        monthlyShipmentVolume: dto.monthlyShipmentVolume,
        currentSoftware: dto.currentSoftware,
        servicesOffered: dto.servicesOffered,
        message: dto.message,
        source: dto.source ?? PlatformLeadSource.DIRECT,
      },
    });

    try {
      const email = demoRequestConfirmationEmail({ contactName: dto.contactName, companyName: dto.companyName });
      await this.emailProvider.send({
        to: dto.email,
        subject: email.subject,
        body: email.body,
        ...resolvePlatformEmailSender(this.config),
      });
    } catch (err) {
      this.logger.error(`Failed to send demo-request confirmation email for lead ${lead.id}: ${err}`);
    }

    return { success: true };
  }

  async findAll(status?: PlatformLeadStatus): Promise<PlatformLeadSummary[]> {
    const leads = await this.prisma.platformLead.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return leads.map((lead) => this.toSummary(lead));
  }

  async updateStatus(id: string, status: PlatformLeadStatus): Promise<PlatformLeadSummary> {
    const existing = await this.prisma.platformLead.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Lead not found');
    }
    const updated = await this.prisma.platformLead.update({ where: { id }, data: { status } });
    return this.toSummary(updated);
  }

  private toSummary(lead: {
    id: string;
    status: PlatformLeadStatus;
    source: PlatformLeadSource;
    companyName: string;
    contactName: string;
    phone: string | null;
    email: string;
    country: string | null;
    currentWorkflow: string | null;
    monthlyShipmentVolume: string | null;
    currentSoftware: string | null;
    servicesOffered: string[];
    message: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): PlatformLeadSummary {
    return {
      id: lead.id,
      status: lead.status as unknown as PlatformLeadSummary['status'],
      source: lead.source as unknown as PlatformLeadSummary['source'],
      companyName: lead.companyName,
      contactName: lead.contactName,
      phone: lead.phone,
      email: lead.email,
      country: lead.country,
      currentWorkflow: lead.currentWorkflow,
      monthlyShipmentVolume: lead.monthlyShipmentVolume,
      currentSoftware: lead.currentSoftware,
      servicesOffered: lead.servicesOffered,
      message: lead.message,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    };
  }
}
