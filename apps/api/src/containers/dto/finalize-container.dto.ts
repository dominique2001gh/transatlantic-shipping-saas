import { IsOptional, IsString } from 'class-validator';

export class FinalizeContainerDto {
  @IsOptional()
  @IsString()
  sealNumber?: string;
}
