import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SignupSessionStatus } from '@prisma/client';
import type { SignupCompanyDetails, SignupStatusResponse, StartSignupResponse } from '@transatlantic/shared';
import { AuthService } from '../auth/auth.service';
import { generateToken } from '../common/token/token.util';
import { PrismaService } from '../prisma/prisma.service';
import { effectivePrice } from '../saas-plans/promo-pricing.util';
import { SaasPlansService } from '../saas-plans/saas-plans.service';
import { StripeService } from '../stripe/stripe.service';
import { SignupCheckoutDto } from './dto/signup-checkout.dto';
import { SignupCompanyDto } from './dto/signup-company.dto';
import { SignupOwnerDto } from './dto/signup-owner.dto';
import { StartSignupDto } from './dto/start-signup.dto';

const SIGNUP_SESSION_TTL_HOURS = 48;

/**
 * AnanseLogix Phase 1: everything the public, unauthenticated signup
 * wizard (Steps 1-4 of the build brief) calls — staging a SignupSession
 * through Plan -> Owner -> Company, then handing off to Stripe. Never
 * creates a Tenant/User itself — that only happens in
 * TenantProvisioningService, triggered from the Stripe webhook once
 * payment is actually confirmed (see SignupStatusResponse's own doc
 * comment for why the frontend never short-circuits this by trusting its
 * own redirect).
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly saasPlansService: SaasPlansService,
    private readonly stripeService: StripeService,
  ) {}

  async start(dto: StartSignupDto): Promise<StartSignupResponse> {
    const plan = await this.prisma.saasPlan.findFirst({ where: { key: dto.planKey, isActive: true } });
    if (!plan) {
      throw new BadRequestException('This plan is not currently available');
    }

    const session = await this.prisma.signupSession.create({
      data: {
        token: generateToken(),
        status: SignupSessionStatus.DRAFT,
        planId: plan.id,
        expiresAt: new Date(Date.now() + SIGNUP_SESSION_TTL_HOURS * 60 * 60 * 1000),
      },
    });
    return { token: session.token };
  }

  async setOwner(token: string, dto: SignupOwnerDto): Promise<{ success: true }> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    const session = await this.requireEditableSession(token);

    const passwordHash = await AuthService.hashPassword(dto.password);
    await this.prisma.signupSession.update({
      where: { id: session.id },
      data: {
        ownerFirstName: dto.firstName.trim(),
        ownerLastName: dto.lastName.trim(),
        ownerEmail: dto.email.toLowerCase().trim(),
        ownerPhone: dto.phone,
        ownerPasswordHash: passwordHash,
      },
    });
    return { success: true };
  }

  async setCompany(token: string, dto: SignupCompanyDto): Promise<{ success: true }> {
    const session = await this.requireEditableSession(token);
    const companyDetails: SignupCompanyDetails = {
      legalName: dto.legalName,
      tradingName: dto.tradingName,
      businessPhone: dto.businessPhone,
      businessEmail: dto.businessEmail,
      existingWebsite: dto.existingWebsite,
      country: dto.country,
      stateRegion: dto.stateRegion,
      city: dto.city,
      address: dto.address,
      timezone: dto.timezone,
      primaryShippingMarkets: dto.primaryShippingMarkets,
      serviceTypes: dto.serviceTypes,
    };
    await this.prisma.signupSession.update({
      where: { id: session.id },
      data: { companyDetails: companyDetails as unknown as Prisma.InputJsonValue },
    });
    return { success: true };
  }

  /**
   * Builds the Stripe subscription Checkout Session from whatever the
   * plan's currently-active SaasPlanPrice says (never a client-supplied
   * amount) and stamps the resulting session id back onto the
   * SignupSession — the pairing SubscriptionsService.handleCheckoutCompleted
   * relies on to find its way back here (alongside the metadata token,
   * belt-and-suspenders).
   */
  async createCheckout(token: string, dto: SignupCheckoutDto): Promise<{ url: string }> {
    const session = await this.requireEditableSession(token);
    if (!session.ownerEmail || !session.ownerPasswordHash) {
      throw new BadRequestException('Complete the owner account step first');
    }
    if (!session.companyDetails) {
      throw new BadRequestException('Complete the company details step first');
    }
    if (!session.planId) {
      throw new BadRequestException('No plan selected for this signup session');
    }

    const plan = await this.prisma.saasPlan.findUniqueOrThrow({ where: { id: session.planId } });
    const price = await this.saasPlansService.findActivePriceForPlanKey(plan.id);
    if (!price) {
      throw new BadRequestException('This plan does not have active pricing configured yet — please contact us');
    }

    // Same isPromoActive/effectivePrice util SaasPlansService uses for
    // display and TenantProvisioningService uses for redemption counting —
    // see that function's own doc comment for why this must never be
    // computed a second, possibly-drifted way.
    const effective = effectivePrice(price);

    const checkoutSession = await this.stripeService.createSubscriptionCheckoutSession({
      signupSessionToken: session.token,
      customerEmail: session.ownerEmail,
      planName: plan.name,
      currency: price.currency,
      monthlyAmountCents: effective.monthlyAmountCents,
      setupFeeCents: effective.setupFeeCents,
      trialDays: price.trialDays,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
    if (!checkoutSession.url) {
      throw new BadRequestException('Unable to start checkout — please try again');
    }

    await this.prisma.signupSession.update({
      where: { id: session.id },
      data: { status: SignupSessionStatus.AWAITING_PAYMENT, stripeCheckoutSessionId: checkoutSession.id },
    });

    return { url: checkoutSession.url };
  }

  /**
   * Polled by the signup success page. Deliberately the ONLY source of
   * truth the frontend is allowed to act on after returning from Stripe —
   * never the redirect's own query params, which prove nothing (anyone
   * can craft a URL). Status only ever advances via the webhook-driven
   * TenantProvisioningService.
   */
  async getStatus(token: string): Promise<SignupStatusResponse> {
    const session = await this.findByToken(token);
    let tenantSlug: string | null = null;
    if (session.status === SignupSessionStatus.COMPLETED && session.resultingTenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: session.resultingTenantId }, select: { slug: true } });
      tenantSlug = tenant?.slug ?? null;
    }
    return { status: session.status as unknown as SignupStatusResponse['status'], tenantSlug };
  }

  private async findByToken(token: string) {
    const session = await this.prisma.signupSession.findUnique({ where: { token } });
    if (!session) {
      throw new NotFoundException('Signup session not found');
    }
    if (session.status !== SignupSessionStatus.COMPLETED && session.expiresAt < new Date()) {
      if (session.status !== SignupSessionStatus.EXPIRED) {
        await this.prisma.signupSession.update({ where: { id: session.id }, data: { status: SignupSessionStatus.EXPIRED } });
      }
      return { ...session, status: SignupSessionStatus.EXPIRED };
    }
    return session;
  }

  private async requireEditableSession(token: string) {
    const session = await this.findByToken(token);
    if (session.status === SignupSessionStatus.EXPIRED) {
      throw new BadRequestException('This signup session has expired — please start again');
    }
    if (session.status === SignupSessionStatus.COMPLETED) {
      throw new BadRequestException('This signup has already been completed');
    }
    return session;
  }
}
