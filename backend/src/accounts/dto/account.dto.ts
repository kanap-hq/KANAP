import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { StatusLifecycleDto } from '../../common/dto/status-lifecycle.dto';
import { ACCOUNT_NATURES, AccountNature } from '../account.entity';

export class AccountUpsertDto extends StatusLifecycleDto {
  @IsOptional()
  @IsString()
  coa_id?: string | null;
  @IsOptional()
  @Transform(({ value }) => (value != null ? String(value) : value))
  @IsString()
  account_number?: string | null;

  @IsOptional()
  @IsString()
  account_name?: string | null;

  @IsOptional()
  @IsString()
  native_name?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  consolidation_account_number?: number | null;

  @IsOptional()
  @IsString()
  consolidation_account_name?: string | null;

  @IsOptional()
  @IsString()
  consolidation_account_description?: string | null;

  /** OPEX lines only, CAPEX lines only; null clears it (both), absent leaves it unchanged. */
  @IsOptional()
  @IsIn(ACCOUNT_NATURES)
  nature?: AccountNature | null;
}
