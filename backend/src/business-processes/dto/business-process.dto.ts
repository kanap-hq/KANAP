import { IsIn, IsOptional, IsString } from 'class-validator';
import { BUSINESS_PROCESS_TYPES } from '../business-process-tree';
import { StatusLifecycleDto } from '../../common/dto/status-lifecycle.dto';

export class BusinessProcessUpsertDto extends StatusLifecycleDto {
  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  owner_user_id?: string | null;

  @IsOptional()
  @IsString()
  it_owner_user_id?: string | null;

  @IsOptional()
  @IsIn(BUSINESS_PROCESS_TYPES)
  process_type?: string | null;

  @IsOptional()
  @IsString()
  parent_id?: string | null;
}
