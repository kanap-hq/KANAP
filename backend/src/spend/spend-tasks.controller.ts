import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { SpendTasksService } from './spend-tasks.service';
import { resolveToUuid } from '../common/resolve-item-id';
import { EntityManager } from 'typeorm';
import { creationContextOf, withCreationToken } from '../common/creation/creation-routes';

@UseGuards(JwtAuthGuard)
@Controller('spend-items/:id/tasks')
export class SpendTasksController {
  constructor(private readonly svc: SpendTasksService) {}

  private resolveItemId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'spend', manager);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get()
  async list(@Param('id') idOrRef: string, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.svc.listForItem(itemId, { manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Post()
  async create(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    const created = await this.svc.createForItem(itemId, body, req.user?.sub ?? null, { manager, tenantId: req?.tenant?.id });
    // The token of "Cancel" of a task being created (`tasks/task-creation.ts`).
    return withCreationToken('tasks', created, creationContextOf(req));
  }

  // PATCH expects body.id of the task to update
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Patch()
  async update(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.svc.updateForItem(itemId, body, req.user?.sub ?? null, { manager, tenantId });
  }
}
