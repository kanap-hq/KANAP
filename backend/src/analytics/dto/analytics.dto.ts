import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
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

  /** A new line must hold a value on it; absent leaves it unchanged. */
  @IsOptional()
  @IsBoolean()
  required?: boolean;
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

  /** A new line must hold a value on it; absent leaves it unchanged. */
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

/** The order of the dimensions; the service checks the ids (they must be the tenant's dimensions). */
export class AnalyticsAxisReorderDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  axis_ids!: string[];
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

  /** OPEX lines only, CAPEX lines only; null clears it (both), absent leaves it unchanged. */
  @IsOptional()
  @IsIn(AXIS_APPLIES_TO)
  applies_to?: AxisAppliesTo | null;
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

  /** OPEX lines only, CAPEX lines only; null clears it (both), absent leaves it unchanged. */
  @IsOptional()
  @IsIn(AXIS_APPLIES_TO)
  applies_to?: AxisAppliesTo | null;
}

/** The order of a dimension's values; the service checks the ids (they must be values of `axis_id`). */
export class AnalyticsCategoryReorderDto {
  @IsString()
  axis_id!: string;

  @IsArray()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  value_ids!: string[];
}

export class AnalyticsCategoryBulkDeleteDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  ids!: string[];
}
