import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ReservedToUnscopedDataAccess } from '../../data-access/reserved-operations';
import { SystemAdminGuard } from './system-admin.guard';
import { ScheduledTasksService } from './scheduled-tasks.service';

@ReservedToUnscopedDataAccess()
@Controller('admin/scheduled-tasks')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class ScheduledTasksController {
  constructor(private readonly service: ScheduledTasksService) {}

  @Get()
  async list() {
    return this.service.listTasks();
  }

  @Patch(':name')
  async update(
    @Param('name') name: string,
    @Body() body: { cron_expression?: string; enabled?: boolean },
  ) {
    return this.service.updateTask(name, body);
  }

  @Get(':name/runs')
  async runs(
    @Param('name') name: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getTaskRuns(name, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
  }

  @Post(':name/trigger')
  async trigger(@Param('name') name: string) {
    await this.service.triggerTask(name);
    return { message: `Task '${name}' triggered` };
  }
}
