import { IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { StatusLifecycleDto } from '../../common/dto/status-lifecycle.dto';

export class SpendItemUpsertDto extends StatusLifecycleDto {
  @IsOptional()
  @IsString()
  product_name?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  supplier_id?: string | null;

  @IsOptional()
  @IsUUID()
  paying_company_id?: string | null;

  @IsOptional()
  @IsUUID()
  account_id?: string | null;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string | null;

  @IsOptional()
  @IsISO8601()
  effective_start?: string | null;

  /** @deprecated Alias of disabled_at for one release: fills an empty end of validity, never stored. */
  @IsOptional()
  @IsISO8601()
  effective_end?: string | null;

  @IsOptional()
  @IsUUID()
  owner_it_id?: string | null;

  @IsOptional()
  @IsUUID()
  owner_business_id?: string | null;

  /** Analytics values by dimension id: a value id, or null to clear; omitted dimensions are untouched. */
  @IsOptional()
  @IsObject()
  analytics_values?: Record<string, string | null>;

  /** Legacy: the default dimension's value (refused when analytics_values names another one for it). */
  @IsOptional()
  @IsUUID()
  analytics_category_id?: string | null;

  /** A cost center of the tenant (not a group); an empty paying company takes its company. */
  @IsOptional()
  @IsUUID()
  cost_center_id?: string | null;

  @IsOptional()
  @IsIn(['run', 'build'])
  run_build?: 'run' | 'build' | null;

  @IsOptional()
  @IsUUID()
  project_id?: string | null;

  @IsOptional()
  @IsUUID()
  contract_id?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
