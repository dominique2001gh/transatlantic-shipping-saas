import { IsUrl } from 'class-validator';

export class BillingPortalDto {
  @IsUrl({ require_tld: false })
  returnUrl!: string;
}
