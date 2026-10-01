import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { StatusLifecycleDto } from '../../common/dto/status-lifecycle.dto';

// Shapes only: trimming, lengths, uniqueness and the days rules are the service's.

export class WorkingDayProfileCreateDto extends StatusLifecycleDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsObject()
  days_by_year?: Record<string, unknown>;

  /** A standard calendar: its years follow this country's public holidays. Set at creation only. */
  @IsOptional()
  @IsString()
  country_iso?: string | null;

  @IsOptional()
  @IsString()
  region_code?: string | null;
}

export class WorkingDayProfileUpdateDto extends StatusLifecycleDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  /** Merged per year: a year sent replaces that year, `null` removes it, other years stay. */
  @IsOptional()
  @IsObject()
  days_by_year?: Record<string, unknown>;

  /** Accepted only equal to the stored values: the source of a calendar never changes. */
  @IsOptional()
  @IsString()
  country_iso?: string | null;

  @IsOptional()
  @IsString()
  region_code?: string | null;
}

export class WorkingDayProfileBulkDeleteDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  ids!: string[];
}
