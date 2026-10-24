import { Controller, Get, Param, Patch, Query, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { DepartmentMetricsService } from './department-metrics.service';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

@UseGuards(JwtAuthGuard)
@Controller('department-metrics')
export class DepartmentMetricsController {
  constructor(private readonly svc: DepartmentMetricsService) {}

  @Get(':departmentId')
  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'reader')
  async get(
    @Param('departmentId') departmentId: string,
    @Query('year') yearRaw: string,
    @Req() req: any,
  ) {
    const year = Number(yearRaw);
    return this.svc.getForDepartment(departmentId, year, { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @Patch(':departmentId')
  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'member')
  async upsert(
    @Param('departmentId') departmentId: string,
    @Query('year') yearRaw: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const year = Number(yearRaw);
    return this.svc.upsertForDepartment(departmentId, year, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }
}
