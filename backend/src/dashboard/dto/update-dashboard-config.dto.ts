import { IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { DASHBOARD_SECTION_IDS, type DashboardSectionId } from '../user-dashboard-config.entity';
import { Type } from 'class-transformer';

export class TileConfigDto {
  @IsString()
  id!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsNumber()
  order!: number;

  @IsObject()
  config!: Record<string, unknown>;
}

export class UpdateDashboardConfigDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TileConfigDto)
  tiles!: TileConfigDto[];
}

export class DashboardSectionDto {
  @IsIn(DASHBOARD_SECTION_IDS)
  id!: DashboardSectionId;

  @IsBoolean()
  hidden!: boolean;
}

export class UpdateHomeDashboardConfigDto extends UpdateDashboardConfigDto {
  @IsOptional()
  @IsBoolean()
  hideEmptyTiles?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DashboardSectionDto)
  sections?: DashboardSectionDto[];
}
