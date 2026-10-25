import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { StatusLifecycleDto } from '../../common/dto/status-lifecycle.dto';

const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'annual', 'other'] as const;

export class ContractUpsertDto extends StatusLifecycleDto {
  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsUUID()
  company_id?: string | null;

  @IsOptional()
  @IsUUID()
  supplier_id?: string | null;

  /** A group or a cost center of the tenant, active; null clears it. */
  @IsOptional()
  @IsUUID()
  cost_center_id?: string | null;

  @IsOptional()
  @IsUUID()
  owner_user_id?: string | null;

  @IsOptional()
  @IsISO8601()
  start_date?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  duration_months?: number | null;

  @IsOptional()
  @IsBoolean()
  auto_renewal?: boolean | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  notice_period_months?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  yearly_amount_at_signature?: number | null;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string | null;

  @IsOptional()
  @IsIn(BILLING_FREQUENCIES)
  billing_frequency?: (typeof BILLING_FREQUENCIES)[number] | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
