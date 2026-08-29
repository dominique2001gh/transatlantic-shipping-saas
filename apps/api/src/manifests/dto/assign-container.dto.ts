import { IsOptional, IsString } from 'class-validator';

/** Container assignment is a selection/planning action, not a scan — no scan-provenance fields needed. */
export class AssignContainerDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
