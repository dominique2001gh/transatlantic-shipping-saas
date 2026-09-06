import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateTrackingDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{2,10}$/, { message: 'trackingNumberPrefix must be 2-10 uppercase letters/digits' })
  trackingNumberPrefix?: string;
}
