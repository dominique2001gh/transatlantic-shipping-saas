import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /public/platform-sms-consent — Ananse Logix's own platform-level
 * SMS consent form (ananselogix.com/sms-consent), supporting Twilio A2P
 * Campaign review for the approved Brand (Sole Proprietor: Debrah
 * Atuahene). Deliberately unrelated to CustomerSignupDto/CreateLeadDto —
 * this is not a tenant signup and not a WebsiteLead; see
 * PlatformSmsConsentSubmission's own schema doc comment.
 */
export class CreatePlatformSmsConsentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  phone!: string;

  /**
   * Unchecked/omitted means no consent, never assumed — see
   * PlatformSmsConsentService.create for how this is recorded.
   */
  @IsOptional()
  @IsBoolean()
  smsConsent?: boolean;
}
