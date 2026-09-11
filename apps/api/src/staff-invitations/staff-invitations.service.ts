import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantInvitationStatus } from '@prisma/client';
import type { AcceptInvitePreview, TenantInvitationSummary } from '@transatlantic/shared';
import { AuthService } from '../auth/auth.service';
import { generateToken, hashToken } from '../common/token/token.util';
import { staffInvitationEmail } from '../notifications/templates/platform-emails';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { PrismaService } from '../prisma/prisma.service';
import { InviteStaffDto } from './dto/invite-staff.dto';

const INVITATION_TTL_DAYS = 7;

/**
 * Staff Invitations stage: the single owner of TenantInvitation's full
 * lifecycle (create, resend, preview, accept) — both OnboardingService's
 * Staff-step wizard and the permanent staff-management page
 * (UsersController) call the exact same methods here, so "invite staff
 * during setup" and "invite staff later" are never two different code
 * paths with two different rules. AuthController's accept-invite routes
 * also delegate here, the same way it already delegates password-reset
 * logic to AuthService.
 */
@Injectable()
export class StaffInvitationsService {
  private readonly logger = new Logger(StaffInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Creates a TenantInvitation and best-effort emails it (an email
   * provider outage doesn't roll back the invitation — the row still
   * exists and can be resent, matching the original inviteStaff's own
   * behavior). Refuses outright — before ever touching the database — if
   * an active User or a still-live invitation already exists for this
   * email under this tenant: the two duplicate-prevention rules the
   * Staff Invitations stage requires.
   */
  async invite(tenantId: string, invitedByUserId: string, invitedByName: string, dto: InviteStaffDto): Promise<TenantInvitationSummary> {
    const email = dto.email.toLowerCase().trim();

    const existingUser = await this.prisma.user.findFirst({ where: { tenantId, email } });
    if (existingUser) {
      throw new BadRequestException('A user with this email already exists for this tenant.');
    }

    const existingLiveInvitation = await this.prisma.tenantInvitation.findFirst({
      where: { tenantId, email, status: TenantInvitationStatus.PENDING, expiresAt: { gt: new Date() } },
    });
    if (existingLiveInvitation) {
      throw new BadRequestException('An invitation is already pending for this email. Use Resend instead of creating a new one.');
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const rawToken = generateToken();
    const invitation = await this.prisma.tenantInvitation.create({
      data: {
        tenantId,
        email,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        role: dto.role,
        tokenHash: hashToken(rawToken),
        invitedByUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await this.sendInvitationEmail(invitation.email, tenant.name, invitedByName, rawToken, invitation.expiresAt);

    return this.toSummary(invitation);
  }

  /**
   * Regenerates the token/expiry on the *same* row (never a new row) —
   * this is what makes the previous emailed link stop working
   * immediately, since its hash no longer matches anything in the
   * database. Only valid for a still-PENDING invitation; an ACCEPTED or
   * REVOKED one has nothing to resend.
   */
  async resend(tenantId: string, invitationId: string, invitedByName: string): Promise<TenantInvitationSummary> {
    const invitation = await this.prisma.tenantInvitation.findFirst({ where: { id: invitationId, tenantId } });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== TenantInvitationStatus.PENDING) {
      throw new BadRequestException(`This invitation is ${invitation.status.toLowerCase()} and can't be resent.`);
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const rawToken = generateToken();
    const updated = await this.prisma.tenantInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000) },
    });

    await this.sendInvitationEmail(updated.email, tenant.name, invitedByName, rawToken, updated.expiresAt);

    return this.toSummary(updated);
  }

  async listForTenant(tenantId: string): Promise<TenantInvitationSummary[]> {
    const invitations = await this.prisma.tenantInvitation.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return invitations.map((i) => this.toSummary(i));
  }

  /** Lets the accept-invite page show who/where before rendering the password form — see AcceptInvitePreview's own doc comment. */
  async previewToken(rawToken: string): Promise<AcceptInvitePreview> {
    const invitation = await this.prisma.tenantInvitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { tenant: { select: { name: true } } },
    });

    if (!invitation) {
      return { valid: false, reason: 'not_found' };
    }
    if (invitation.status !== TenantInvitationStatus.PENDING) {
      return { valid: false, reason: 'already_used' };
    }
    if (invitation.expiresAt < new Date()) {
      return { valid: false, reason: 'expired' };
    }

    return {
      valid: true,
      email: invitation.email,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      tenantName: invitation.tenant.name,
    };
  }

  /**
   * Consumes an invitation: validates it (pending, unexpired), then
   * creates the User and marks the invitation ACCEPTED in one
   * transaction — an invitation can never be raced into creating two
   * accounts. Re-checks for an existing User at accept time too (not
   * just at invite time), closing the gap where one could otherwise have
   * been created in between by some other path.
   */
  async accept(rawToken: string, password: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const invitation = await this.prisma.tenantInvitation.findUnique({ where: { tokenHash } });

    if (!invitation || invitation.status !== TenantInvitationStatus.PENDING) {
      throw new BadRequestException('This invitation is invalid or has already been used.');
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired — ask your admin to resend it.');
    }

    const existingUser = await this.prisma.user.findFirst({ where: { tenantId: invitation.tenantId, email: invitation.email } });
    if (existingUser) {
      throw new BadRequestException('A user with this email already exists for this tenant.');
    }

    const passwordHash = await AuthService.hashPassword(password);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          firstName: invitation.firstName,
          lastName: invitation.lastName,
          role: invitation.role,
          passwordHash,
          isActive: true,
        },
      }),
      this.prisma.tenantInvitation.update({
        where: { id: invitation.id },
        data: { status: TenantInvitationStatus.ACCEPTED, acceptedAt: now },
      }),
    ]);
  }

  private async sendInvitationEmail(
    email: string,
    tenantName: string,
    inviterName: string,
    rawToken: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
      const emailContent = staffInvitationEmail({
        inviteeEmail: email,
        tenantName,
        inviterName,
        acceptUrl: `${webAppUrl.replace(/\/$/, '')}/accept-invite?token=${rawToken}`,
        expiresAt,
      });
      await this.emailProvider.send({ to: email, subject: emailContent.subject, body: emailContent.body });
    } catch (err) {
      this.logger.error(`Failed to send staff invitation email to ${email}: ${err}`);
    }
  }

  private toSummary(invitation: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    status: TenantInvitationStatus;
    expiresAt: Date;
    createdAt: Date;
  }): TenantInvitationSummary {
    return {
      id: invitation.id,
      email: invitation.email,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      role: invitation.role as TenantInvitationSummary['role'],
      status: invitation.status as TenantInvitationSummary['status'],
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }
}
