import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';

@Injectable()
export class SpendTasksService {
  constructor(
    private readonly unified: TasksUnifiedService,
  ) {}

  listForItem(itemId: string, opts?: { manager?: EntityManager }) {
    return this.unified.listForTarget({ type: 'spend_item', id: itemId }, opts);
  }

  // The unified service writes the single audit row, under `tasks`.
  createForItem(itemId: string, body: any, userId?: string, opts?: { manager?: EntityManager; tenantId?: string }) {
    return this.unified.createForTarget({ type: 'spend_item', id: itemId, payload: body }, userId, opts);
  }

  updateForItem(itemId: string, body: any, userId?: string, opts?: { manager?: EntityManager; tenantId?: string }) {
    return this.unified.updateForTarget({ type: 'spend_item', id: itemId, payload: body }, userId, opts);
  }
}
