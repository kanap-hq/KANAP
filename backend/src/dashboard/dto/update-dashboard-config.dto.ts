import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
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

export class UpdateHomeDashboardConfigDto extends UpdateDashboardConfigDto {
  @IsOptional()
  @IsBoolean()
  hideEmptyTiles?: boolean;
}
