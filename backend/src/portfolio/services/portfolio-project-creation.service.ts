import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { RecordInUseException } from '../../common/record-in-use';
import { StorageService } from '../../common/storage/storage.service';
import { assertNoHiddenLines } from '../../data-access/hidden-links';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import { deleteBlobs, deleteItemTasks, unreferencedPaths } from '../../spend/item-delete-cleanup';
import { UserTimeAggregateService } from './user-time-aggregate.service';

/** The refusal's code, worded by the screens (`errors:PROJECT_FROM_REQUEST`). */
export const PROJECT_FROM_REQUEST = 'PROJECT_FROM_REQUEST';

/**
 * The delete behind "Cancel creation" of a project (`DELETE /portfolio/projects/:id/creation`),
 * its only caller: projects have no delete of their own, on the screen or in the API. The route
 * checks the creation token; this removes the project and what belongs to it, as the request and
 * incident deletes do.
 *
 * Refused: a project linked to a request (`PROJECT_FROM_REQUEST`, the request keeps it as its
 * outcome) and, for a person with limited data access, a project linked to budget lines they
 * cannot read (its cascade would drop those links). Removed: its managed documents (the purpose),
 * its tasks (polymorphic rows, no foreign key), then the row, whose phases, milestones, team, time
 * entries, attachment rows and links cascade. The search entry goes with the row (trigger). The
 * time totals of the people who logged time on it are computed again; attachment files go last,
 * once no attachment row of the tenant uses them.
 */
@Injectable()
export class PortfolioProjectCreationService {
  private readonly logger = new Logger(PortfolioProjectCreationService.name);

  constructor(
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly integratedDocuments: IntegratedDocumentsService,
    private readonly timeAggregates: UserTimeAggregateService,
  ) {}

  async deleteCreated(id: string, tenantId: string, userId: string | null, manager: EntityManager): Promise<void> {
    const locked: Array<Record<string, unknown>> = await manager.query(
      `SELECT * FROM portfolio_projects WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id],
    );
    const project = locked[0];
    if (!project) throw new NotFoundException('Project not found');

    const [{ requests }] = await manager.query(
      `SELECT count(*)::int AS requests FROM portfolio_request_projects WHERE tenant_id = $1 AND project_id = $2`,
      [tenantId, id],
    );
    if (requests > 0) {
      throw new RecordInUseException(
        PROJECT_FROM_REQUEST,
        'project',
        String(project.name ?? ''),
        [],
        'This project came from a request, which keeps it as its outcome: it cannot be deleted.',
      );
    }
    // Its cascade would drop links to lines the person cannot read (spec §5.4).
    await assertNoHiddenLines(manager, 'project', id);

    const attachments: Array<{ storage_path: string }> = await manager.query(
      `SELECT storage_path FROM portfolio_project_attachments WHERE tenant_id = $1 AND project_id = $2`,
      [tenantId, id],
    );
    const months: Array<{ user_id: string; year_month: string }> = await manager.query(
      `SELECT DISTINCT user_id, to_char(date_trunc('month', logged_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS year_month
         FROM portfolio_project_time_entries
        WHERE tenant_id = $1 AND project_id = $2 AND user_id IS NOT NULL`,
      [tenantId, id],
    );

    // Its managed documents name it without a foreign key: they go here, audited under the actor.
    // The creation token covers them, as the request delete right does for a request's.
    await this.integratedDocuments.deleteForEntity('projects', id, userId, { manager, checkAccess: false });
    await deleteItemTasks(manager, 'project', tenantId, id, { audit: this.audit, timeAggregates: this.timeAggregates, userId });
    // Phases, milestones, team, time entries, attachment rows and links cascade.
    await manager.query(`DELETE FROM portfolio_projects WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    for (const { user_id, year_month } of months) {
      await this.timeAggregates.recalculateUserMonth(user_id, new Date(`${year_month}T00:00:00Z`), manager);
    }

    await this.audit.log({ table: 'portfolio_projects', recordId: id, action: 'delete', before: project, after: null, userId }, { manager });

    const paths = await unreferencedPaths(manager, tenantId, [...new Set(attachments.map((a) => a.storage_path).filter(Boolean))]);
    await deleteBlobs(this.storage, paths, this.logger);
  }
}
