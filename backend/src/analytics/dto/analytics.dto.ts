import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { StatusLifecycleDto } from '../../common/dto/status-lifecycle.dto';
import { AXIS_APPLIES_TO, AxisAppliesTo } from '../analytics-axis.entity';

// Shapes only: trimming, lengths, code format, the default-dimension rules and
// tenant checks are the services'. `is_default` is not declared, so the global
// whitelist strips it: no API writes it.

export class AnalyticsAxisCreateDto extends StatusLifecycleDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  sort_order?: number;

  /** OPEX lines only, CAPEX lines only; null clears it (both), absent leaves it unchanged. */
  @IsOptional()
  @IsIn(AXIS_APPLIES_TO)
  applies_to?: AxisAppliesTo | null;
}

export class AnalyticsAxisUpdateDto extends StatusLifecycleDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  sort_order?: number;

  /** OPEX lines only, CAPEX lines only; null clears it (both), absent leaves it unchanged. */
  @IsOptional()
  @IsIn(AXIS_APPLIES_TO)
  applies_to?: AxisAppliesTo | null;
}

export class AnalyticsCategoryCreateDto extends StatusLifecycleDto {
  @IsOptional()
  @IsUUID()
  axis_id?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class AnalyticsCategoryUpdateDto extends StatusLifecycleDto {
  @IsOptional()
  @IsUUID()
  axis_id?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class AnalyticsCategoryBulkDeleteDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  ids!: string[];
}
