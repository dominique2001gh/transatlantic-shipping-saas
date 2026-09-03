import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ShipmentMode } from '@prisma/client';

/**
 * Stage 4: query shape for every GET /analytics/* endpoint except
 * /analytics/overview and /analytics/alerts (neither takes a date range —
 * see their own doc comments). `from`/`to` are ISO dates, both optional;
 * AnalyticsService.resolveDateRange defaults to the last 30 days when
 * omitted. `shipmentMode`/`warehouseId` are optional secondary filters,
 * applied only where they meaningfully apply to that endpoint's data.
 */
export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(ShipmentMode)
  shipmentMode?: ShipmentMode;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}
