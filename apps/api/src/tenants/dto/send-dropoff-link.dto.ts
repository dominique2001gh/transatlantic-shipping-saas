import { IsEmail } from 'class-validator';

export class SendDropoffLinkDto {
  @IsEmail()
  email!: string;
}
