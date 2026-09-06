import { IsString, MaxLength, MinLength } from 'class-validator';

export class AskAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question!: string;
}
