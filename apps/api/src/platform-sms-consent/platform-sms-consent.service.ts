import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlatformSmsConsentDto } from './dto/create-platform-sms-consent.dto';

@Injectable()
export class PlatformSmsConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records exactly what the form submitted — checking the box is the
   * only thing that can ever set `smsConsent: true`/`consentAt`; leaving
   * it unchecked (the default) always persists `smsConsent: false`,
   * `consentAt: null`, same "never assumed" discipline as
   * Customer.smsConsentGiven elsewhere in this codebase. Never wired to
   * any SMS send path — this table exists solely as an auditable Twilio
   * A2P compliance record.
   */
  async create(dto: CreatePlatformSmsConsentDto): Promise<{ success: true }> {
    const consented = dto.smsConsent === true;
    await this.prisma.platformSmsConsentSubmission.create({
      data: {
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        smsConsent: consented,
        consentAt: consented ? new Date() : null,
      },
    });
    return { success: true };
  }
}
