import { IsBoolean, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

/**
 * E.164: leading `+`, then 7–15 digits total, first digit 1–9 — matches
 * the format already documented on Customer.whatsappPhone in
 * schema.prisma (e.g. "+233201234567").
 */
const E164_PHONE = /^\+[1-9]\d{6,14}$/;

/**
 * PATCH /portal/me/notification-preferences. All fields optional (partial
 * update). `whatsappPhone` may be explicitly set to `null` to clear a
 * previously-set number. CustomerPortalService.updateNotificationPreferences
 * validates the *resulting merged* state (not just this DTO in isolation) —
 * enabling WhatsApp in one request while a number was already on file from
 * an earlier one must still succeed, so the "WhatsApp needs a number" check
 * can't live purely in this DTO.
 */
export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  notifyByEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyBySms?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyByWhatsapp?: boolean;

  @IsOptional()
  @ValidateIf((o) => o.whatsappPhone !== null)
  @IsString()
  @Matches(E164_PHONE, { message: 'whatsappPhone must be in E.164 format, e.g. +233201234567' })
  whatsappPhone?: string | null;
}
