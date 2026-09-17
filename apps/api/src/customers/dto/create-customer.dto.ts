import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /**
   * Escape hatch for CustomersService.create's duplicate-email/phone check:
   * a first call that finds a likely duplicate 409s with the matches
   * instead of creating anything; the caller re-submits the exact same
   * body with this set to explicitly confirm "yes, create a distinct
   * customer anyway" (e.g. two different people sharing a household
   * phone line). Never set by anything other than that deliberate
   * re-submission — omitted/false is the only path on a first attempt.
   */
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}
