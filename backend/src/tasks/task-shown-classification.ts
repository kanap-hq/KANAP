/**
 * The classification a task shows (lot I7a of 26.12.1). A task of a project takes its project's
 * source, category and company where it has none of its own. Its project's stream only goes with its
 * project's category: a task inherits it when it has no stream of its own and its own category is
 * empty or the project's. A task of another category than its project shows no stream, so it never
 * shows a stream outside the category it shows.
 *
 * The list, the record, the filters, Kad's queries and the export all read these two forms, the SQL one
 * for queries over `tasks t LEFT JOIN portfolio_projects pp`, the TypeScript one for values already read.
 */

/** The stream a task shows, over `tasks t` and its project `pp` (NULL for a task of no project). */
export const TASK_SHOWN_STREAM_SQL =
  '(CASE WHEN t.stream_id IS NOT NULL THEN t.stream_id WHEN t.category_id IS NULL OR t.category_id = pp.category_id THEN pp.stream_id END)';

type Classification = { source_id?: unknown; category_id?: unknown; stream_id?: unknown; company_id?: unknown };

export type ShownTaskClassification = { source_id: string | null; category_id: string | null; stream_id: string | null; company_id: string | null };

const idOf = (value: unknown): string | null => (value == null || value === '' ? null : String(value));
const sameId = (left: string | null, right: string | null) => (left?.toLowerCase() ?? null) === (right?.toLowerCase() ?? null);

/** The values `TASK_SHOWN_STREAM_SQL` and the `COALESCE` of the other columns give, on values already read. */
export function shownTaskClassification(taskRecord: object | null | undefined, projectRecord: object | null | undefined): ShownTaskClassification {
  const task = taskRecord as Classification | null | undefined;
  const project = projectRecord as Classification | null | undefined;
  const own = {
    source_id: idOf(task?.source_id),
    category_id: idOf(task?.category_id),
    stream_id: idOf(task?.stream_id),
    company_id: idOf(task?.company_id),
  };
  const parent = {
    source_id: idOf(project?.source_id),
    category_id: idOf(project?.category_id),
    stream_id: idOf(project?.stream_id),
    company_id: idOf(project?.company_id),
  };
  const inheritsStream = own.category_id === null || sameId(own.category_id, parent.category_id);
  return {
    source_id: own.source_id ?? parent.source_id,
    category_id: own.category_id ?? parent.category_id,
    stream_id: own.stream_id ?? (inheritsStream ? parent.stream_id : null),
    company_id: own.company_id ?? parent.company_id,
  };
}
