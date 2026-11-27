import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { StatusLifecycleDto } from '../../common/dto/status-lifecycle.dto';
import { ACCOUNT_EXPECTED_UNITS, ACCOUNT_NATURES, AccountNature } from '../account.entity';
import { IsAccountNumber } from '../account-number';

export class AccountUpsertDto extends StatusLifecycleDto {
  @IsOptional()
  @IsString()
  coa_id?: string | null;
  @IsOptional()
  @Transform(({ value }) => (value != null ? String(value) : value))
  @IsString()
  @IsAccountNumber()
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
  @IsAccountNumber()
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

  /**
   * Its budget lines are expected as quantity and price: true sets it; null or false clears it
   * (stored as null, `expectedSetting`); absent leaves it unchanged.
   */
  @IsOptional()
  @IsBoolean()
  quantity_price_expected?: boolean | null;

  /**
   * The units its calculation lines are expected in (`people`, `days`, `pieces`), on an account that
   * expects quantity and price: stored once each, in the budget tab's order; null or [] clears them;
   * absent leaves them unchanged. Clearing `quantity_price_expected` clears them too.
   */
  @IsOptional()
  @IsArray()
  @IsIn(ACCOUNT_EXPECTED_UNITS, { each: true })
  expected_units?: string[] | null;
}
