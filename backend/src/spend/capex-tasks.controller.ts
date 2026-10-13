import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';
import { resolveToUuid } from '../common/resolve-item-id';
import { EntityManager } from 'typeorm';

@UseGuards(JwtAuthGuard)
@Controller('capex-items/:id/tasks')
export class CapexTasksController {
  constructor(private readonly unified: TasksUnifiedService) {}

  private resolveItemId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'capex', manager);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get()
  async list(@Param('id') idOrRef: string, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.unified.listForTarget({ type: 'capex_item', id: itemId }, { manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Post()
  async create(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.unified.createForTarget({ type: 'capex_item', id: itemId, payload: body }, req.user?.sub ?? null, { manager, tenantId: req?.tenant?.id });
  }

  // PATCH expects body.id of the task to update
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Patch()
  async update(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.unified.updateForTarget({ type: 'capex_item', id: itemId, payload: body }, req.user?.sub ?? null, { manager, tenantId });
  }
}

