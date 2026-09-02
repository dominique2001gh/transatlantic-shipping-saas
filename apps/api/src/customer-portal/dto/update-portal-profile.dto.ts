import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * PATCH /portal/me. Deliberately excludes `email` and `customerNumber` —
 * see UpdatePortalProfileRequest's own doc comment in @transatlantic/shared
 * for why. Global ValidationPipe (whitelist + forbidNonWhitelisted, see
 * main.ts) is what actually enforces that nothing beyond these three
 * fields can ever reach CustomerPortalService.updateProfile.
 */
export class UpdatePortalProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
