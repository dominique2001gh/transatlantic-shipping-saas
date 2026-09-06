import { IsBoolean, IsOptional } from 'class-validator';

/**
 * AnanseLogix Phase 1: acknowledges the onboarding wizard's Notifications
 * step. Per-customer notification opt-in already exists (Customer.
 * notifyByEmail/Sms/Whatsapp) and per-tenant default preferences aren't
 * modeled yet — this step is intentionally lightweight for Phase 1 (advance
 * the wizard, record intent) rather than introducing a new tenant-level
 * settings surface; see the Phase 1 final report's "known simplifications".
 */
export class UpdateNotificationsDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;
}
