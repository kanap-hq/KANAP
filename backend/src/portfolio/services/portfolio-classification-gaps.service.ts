import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ClassificationGapsResponse, GapCounts } from '../dto/classification-gaps.dto';
import { TASK_SHOWN_STREAM_SQL } from '../../tasks/task-shown-classification';

/**
 * Counts the open portfolio items that still miss a classification value.
 *
 * Only the fields a user can actually fill are counted. Classification lives on standalone
 * tasks and project tasks; the task service nulls it on contract / spend item / capex item /
 * incident tasks, so those are out of scope and would otherwise be permanent false positives.
 *
 * A project task with no classification of its own inherits its project's, and the task list
 * shows that inherited value (its project's stream only with its project's category,
 * `TASK_SHOWN_STREAM_SQL`). The counts use the same expressions, so a figure never sends the
 * user to a list where the column is already filled.
 *
 * A missing stream is only a gap when the item already has a category and that category
 * offers at least one active stream. Many categories have no stream at all, and an item
 * without a category is already counted under the category gap.
 */
@Injectable()
export class PortfolioClassificationGapsService {
  /** Categories of the tenant that have at least one active stream to choose from. */
  private static readonly CATEGORIES_WITH_STREAM = `
    SELECT DISTINCT s.category_id
    FROM portfolio_streams s
    WHERE s.tenant_id = $1 AND s.is_active = true
  `;

  private static counts(alias: string, withTaskType: boolean): string {
    const streamGap = `${alias}.stream_gap`;
    const gaps = [`${alias}.source_id IS NULL`, `${alias}.category_id IS NULL`, streamGap];
    if (withTaskType) gaps.push(`${alias}.task_type_id IS NULL`);
    return `
      COUNT(*)::int AS open,
      COUNT(*) FILTER (WHERE ${gaps.join(' OR ')})::int AS any_gap,
      COUNT(*) FILTER (WHERE ${alias}.source_id IS NULL)::int AS source,
      COUNT(*) FILTER (WHERE ${alias}.category_id IS NULL)::int AS category,
      COUNT(*) FILTER (WHERE ${streamGap})::int AS stream
      ${withTaskType ? `, COUNT(*) FILTER (WHERE ${alias}.task_type_id IS NULL)::int AS task_type` : ''}
    `;
  }

  private static row(raw: any): GapCounts {
    return {
      open: Number(raw?.open ?? 0),
      anyGap: Number(raw?.any_gap ?? 0),
      source: Number(raw?.source ?? 0),
      category: Number(raw?.category ?? 0),
      stream: Number(raw?.stream ?? 0),
    };
  }

  async getGaps(tenantId: string, opts: { manager?: EntityManager }): Promise<ClassificationGapsResponse> {
    const manager = opts.manager;
    if (!manager) throw new Error('A tenant-bound EntityManager is required');
    const cats = PortfolioClassificationGapsService.CATEGORIES_WITH_STREAM;

    const [tasks] = await manager.query(
      `
      WITH cat_with_stream AS (${cats}),
      effective AS (
        SELECT
          COALESCE(t.source_id, pp.source_id) AS source_id,
          COALESCE(t.category_id, pp.category_id) AS category_id,
          ${TASK_SHOWN_STREAM_SQL} AS stream_id,
          t.task_type_id
        FROM tasks t
        LEFT JOIN portfolio_projects pp
          ON t.related_object_type = 'project' AND pp.id = t.related_object_id AND pp.tenant_id = $1
        WHERE t.tenant_id = $1
          AND t.status NOT IN ('done', 'cancelled')
          AND (t.related_object_type IS NULL OR t.related_object_type = 'project')
      ),
      scoped AS (
        SELECT
          e.source_id,
          e.category_id,
          e.task_type_id,
          (e.stream_id IS NULL AND e.category_id IS NOT NULL AND cs.category_id IS NOT NULL) AS stream_gap
        FROM effective e
        LEFT JOIN cat_with_stream cs ON cs.category_id = e.category_id
      )
      SELECT ${PortfolioClassificationGapsService.counts('scoped', true)} FROM scoped
      `,
      [tenantId],
    );

    const [requests] = await manager.query(
      `
      WITH cat_with_stream AS (${cats}),
      scoped AS (
        SELECT
          r.source_id,
          r.category_id,
          (r.stream_id IS NULL AND r.category_id IS NOT NULL AND cs.category_id IS NOT NULL) AS stream_gap
        FROM portfolio_requests r
        LEFT JOIN cat_with_stream cs ON cs.category_id = r.category_id
        WHERE r.tenant_id = $1
          AND r.status NOT IN ('rejected', 'converted')
      )
      SELECT ${PortfolioClassificationGapsService.counts('scoped', false)} FROM scoped
      `,
      [tenantId],
    );

    const [projects] = await manager.query(
      `
      WITH cat_with_stream AS (${cats}),
      scoped AS (
        SELECT
          p.source_id,
          p.category_id,
          (p.stream_id IS NULL AND p.category_id IS NOT NULL AND cs.category_id IS NOT NULL) AS stream_gap
        FROM portfolio_projects p
        LEFT JOIN cat_with_stream cs ON cs.category_id = p.category_id
        WHERE p.tenant_id = $1
          AND p.status NOT IN ('done', 'cancelled')
      )
      SELECT ${PortfolioClassificationGapsService.counts('scoped', false)} FROM scoped
      `,
      [tenantId],
    );

    const categoryRows: Array<{ name: string }> = await manager.query(
      `
      SELECT DISTINCT c.name
      FROM portfolio_categories c
      WHERE c.tenant_id = $1
        AND EXISTS (
          SELECT 1 FROM portfolio_streams s
          WHERE s.tenant_id = $1 AND s.category_id = c.id AND s.is_active = true
        )
      ORDER BY c.name
      `,
      [tenantId],
    );

    return {
      tasks: { ...PortfolioClassificationGapsService.row(tasks), taskType: Number(tasks?.task_type ?? 0) },
      requests: PortfolioClassificationGapsService.row(requests),
      projects: PortfolioClassificationGapsService.row(projects),
      categoriesWithStreams: categoryRows.map((r) => r.name),
    };
  }
}
