import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { StatusLifecycleDto } from '../../common/dto/status-lifecycle.dto';
import { COST_CENTER_KINDS, CostCenterKind } from '../cost-center.entity';

// Shapes only: trimming, lengths, the tree rules and tenant checks are the service's.

export class CostCenterCreateDto extends StatusLifecycleDto {
  @IsString()
  code!: string;

  @IsIn(COST_CENTER_KINDS as unknown as string[])
  kind!: CostCenterKind;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  parent_id?: string | null;

  @IsOptional()
  @IsUUID()
  company_id?: string | null;

  @IsOptional()
  @IsUUID()
  owner_user_id?: string | null;

  @IsOptional()
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  sort_order?: number;
}

export class CostCenterUpdateDto extends StatusLifecycleDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsIn(COST_CENTER_KINDS as unknown as string[])
  kind?: CostCenterKind;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  parent_id?: string | null;

  @IsOptional()
  @IsUUID()
  company_id?: string | null;

  @IsOptional()
  @IsUUID()
  owner_user_id?: string | null;

  @IsOptional()
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  sort_order?: number;
}

export class CostCenterBulkDeleteDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  ids!: string[];
}
