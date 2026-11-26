import type { EntityManager } from 'typeorm';
import { touchUpdatedAt } from '../updated-at-trigger';
import type { AuditService, AuditSourceOptions } from '../../audit/audit.service';
import { auditedLinkSet, hiddenLineCounts, type HiddenLineOwner } from '../../data-access/hidden-links';
import { auditTableOf, BUDGET_NATURES, linkedLineOf, naturesAnd, type BudgetNature } from '../../spend/budget-nature';

/**
 * The other end of a link (lot K2f, decision I34): a link between a project and an application, an
 * asset or a budget line, between an application and a budget line, and between a request and an
 * application, an asset or a budget line, is read in the History of both records, whichever end
 * posts or removes it: the project's Relations tab, the other record's tab, a bulk replacement from
 * either end, the assistant from either end, the copies (a request converted, a line whose type
 * changes from a year, a new version of an application).
 *
 * Every writer of these links writes its own row first, as before (the record it was posted from,
 * its whole set before and after), then hands the ids it really wrote to `markLinkedEnds`, which
 * writes one row per record of the other end, in the form that record's History already reads for
 * its own gesture: `recordId` that record, its own set before and after (a project's, a request's
 * and an asset's `{ ids }`, an application's and a line's sorted list, the lines a limited person
 * cannot read counted, a budget line link labelled by the line's nature, a line naming itself as
 * parent). So a bulk replacement gives each record it reached its own entry, and the dating that
 * follows every audit row (`audit/record-dating.ts`) moves both modification dates. A record the
 * writer's own row already names as its parent (the project side's single change) reads that row:
 * it is left out.
 *
 * A writer removes and adds only the links it read under its record's lock, against the set the
 * person asked for: a link the other end posted meanwhile is neither removed nor rewritten.
 *
 * Lock order: a gesture waits for one record lock only, the record it was posted from (`FOR NO KEY
 * UPDATE`), taken before its links are read. The other end is never waited for: its set is read as
 * this transaction sees it, the entry is derived from the ids this call really wrote (so its before
 * and after differ by exactly that link), and its date is set by the dating, which takes the row
 * `SKIP LOCKED`. One of two gestures posting the same link from both ends writes it (the unique key
 * of the link table decides), the other writes nothing, so neither record gets a second entry, and
 * no gesture waits on a lock taken without waiting: there is no deadlock.
 * When the other end is held by a gesture posted from it, the dating skips it: that gesture, once
 * its own write found nothing to do, dates its record when an entry of its History is newer than
 * its date (`dateRecordMarkedMeanwhile`), so in both orders the two records end dated. A record
 * held otherwise at that instant (saved without a change, a budget operation holding its lines)
 * keeps its date, the gap `doc/architecture.md` accepts for the dating.
 * `__tests__/linked-ends.integration.spec.ts` races them.
 *
 * The rows are written with the person's rights, in the gesture's transaction: under data-scoped
 * access the set of lines is the one the person reads, the others counted (`hidden_kept`); a line
 * the person may only read keeps its date (the dating passes the UPDATE policy).
 */

export type LinkedEnd = 'project' | 'request' | 'application' | 'asset' | 'budget_line';

/** The link tables whose two ends are marked, and the column of each end. */
const LINKED_TABLES = {
  application_projects: { project: 'project_id', application: 'application_id' },
  asset_projects: { project: 'project_id', asset: 'asset_id' },
  portfolio_project_opex: { project: 'project_id', budget_line: 'opex_id' },
  application_spend_items: { application: 'application_id', budget_line: 'spend_item_id' },
  // A request's links are written by the request's replacements only (its tab, the application's
  // tab through them, the assistant): the request is never the end marked.
  portfolio_request_opex: { request: 'request_id', budget_line: 'opex_id' },
  portfolio_request_applications: { request: 'request_id', application: 'application_id' },
  portfolio_request_assets: { request: 'request_id', asset: 'asset_id' },
} as const satisfies Record<string, Partial<Record<LinkedEnd, string>>>;

export type LinkedTable = keyof typeof LINKED_TABLES;

/** How each end's own writer stores its set, and whose hidden lines it counts. */
const END_FORMS: Record<LinkedEnd, { form: 'ids' | 'list'; hiddenOwner?: HiddenLineOwner }> = {
  project: { form: 'ids', hiddenOwner: 'project' },
  request: { form: 'ids', hiddenOwner: 'request' },
  application: { form: 'list', hiddenOwner: 'application' },
  asset: { form: 'ids' },
  budget_line: { form: 'list' },
};

/** The end of `table` stored in `column`, when `table` is one whose two ends are marked. */
export function linkedEndOf(table: string, column: string): { table: LinkedTable; end: LinkedEnd } | null {
  if (!Object.prototype.hasOwnProperty.call(LINKED_TABLES, table)) return null;
  const ends = LINKED_TABLES[table as LinkedTable] as Partial<Record<LinkedEnd, string>>;
  const end = (Object.keys(ends) as LinkedEnd[]).find((key) => ends[key] === column);
  return end ? { table: table as LinkedTable, end } : null;
}

const lower = (value: string) => String(value).toLowerCase();

/** The table of each end's records. */
const END_TABLES: Record<LinkedEnd, string> = {
  project: 'portfolio_projects',
  request: 'portfolio_requests',
  application: 'applications',
  asset: 'assets',
  budget_line: 'spend_items',
};

/**
 * Called by a gesture that holds the lock of the record it was posted from and wrote no link: a
 * gesture from the other end may have marked that record meanwhile, its dating skipping the row this
 * lock held. The record is dated when an entry of its History (its own row, or one naming it as
 * parent) is newer than its date and was written after the record's row: by a later transaction
 * (`age(xmin)`, the entries of the transaction that dated the record are always a little newer
 * than its date, which is that transaction's start). Otherwise nothing is written, as for any save
 * without a change.
 */
export async function dateRecordMarkedMeanwhile(manager: EntityManager, end: LinkedEnd, tenantId: string, id: string): Promise<void> {
  const table = END_TABLES[end];
  const marked: unknown[] = await manager.query(
    `SELECT 1 FROM ${table} r
      WHERE r.tenant_id = $1 AND r.id = $2
        AND EXISTS (SELECT 1 FROM audit_log a
                     WHERE a.tenant_id = r.tenant_id AND a.created_at > r.updated_at
                       AND age(a.xmin) < age(r.xmin)
                       AND (a.record_id = r.id OR (a.parent_table = $3 AND a.parent_id = r.id)))`,
    [tenantId, id, table],
  );
  if (marked.length > 0) await touchUpdatedAt(manager, table, id);
}

/** The end of `table` stored in `column`'s record, for a writer that knows only its own column. */
export function ownerEndOf(table: string, ownerColumn: string): LinkedEnd | null {
  return linkedEndOf(table, ownerColumn)?.end ?? null;
}

/**
 * Writes the rows of the other end of the links `from` gained (`written.added`) or lost
 * (`written.removed`): `end` is the family of those records, `from` the record the gesture was
 * posted from. Call it after the link rows and the writer's own audit row, in the same transaction.
 */
export async function markLinkedEnds(args: {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
  table: LinkedTable;
  end: LinkedEnd;
  from: string;
  tenantId: string;
  written: { added: readonly string[]; removed: readonly string[] };
  userId: string | null;
  source?: AuditSourceOptions;
  /** The record the writer's own row names as its parent: its History reads that row already. */
  covered?: string | null;
}): Promise<void> {
  const ends = LINKED_TABLES[args.table] as Partial<Record<LinkedEnd, string>>;
  const endColumn = ends[args.end];
  const otherEnd = (Object.keys(ends) as LinkedEnd[]).find((end) => end !== args.end);
  if (!endColumn || !otherEnd) throw new Error(`${args.table} has no end ${args.end}`);
  const otherColumn = ends[otherEnd]!;
  const from = lower(args.from);
  const covered = args.covered ? lower(args.covered) : null;
  const added = new Set(args.written.added.map(lower));
  const removed = new Set(args.written.removed.map(lower).filter((id) => !added.has(id)));
  const ids = Array.from(new Set([...added, ...removed])).filter((id) => id !== covered).sort();
  if (ids.length === 0) return;
  const mg = args.manager;

  // A line's nature labels the row and narrows the set of lines (`budget-nature.ts`).
  const natures = new Map<string, BudgetNature>();
  const lineIds = args.end === 'budget_line' ? ids : otherEnd === 'budget_line' ? [from] : [];
  if (lineIds.length > 0) {
    const rows: Array<{ id: string; nature: BudgetNature }> = await mg.query(
      `SELECT id::text AS id, nature FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[])${naturesAnd(null, BUDGET_NATURES)}`,
      [args.tenantId, lineIds],
    );
    for (const row of rows) natures.set(lower(row.id), row.nature);
  }
  const fromNature = otherEnd === 'budget_line' ? natures.get(from) : undefined;
  if (otherEnd === 'budget_line' && !fromNature) return;

  // The sets of the records marked, in one statement; a set of lines holds the lines of the nature
  // of the line toggled, as each record's own writer reads it.
  const lineScope = fromNature ? linkedLineOf('l.tenant_id', `l.${otherColumn}`, fromNature) : '';
  const stored: Array<{ owner: string; id: string }> = await mg.query(
    `SELECT l.${endColumn}::text AS owner, l.${otherColumn}::text AS id
       FROM ${args.table} l
      WHERE l.tenant_id = $1 AND l.${endColumn} = ANY($2::uuid[])${lineScope}`,
    [args.tenantId, ids],
  );
  const sets = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  for (const row of stored) sets.get(lower(row.owner))?.add(lower(row.id));
  const hiddenOwner = otherEnd === 'budget_line' ? END_FORMS[args.end].hiddenOwner : undefined;
  const hidden = hiddenOwner ? await hiddenLineCounts(mg, hiddenOwner, ids) : new Map<string, number>();
  const shape = (set: string[]) => (END_FORMS[args.end].form === 'ids' ? { ids: set } : set);

  for (const id of ids) {
    const nature = args.end === 'budget_line' ? natures.get(id) : fromNature;
    // A line the person does not read (or gone meanwhile) is not marked from here.
    if (args.end === 'budget_line' && !nature) continue;
    const isAdded = added.has(id);
    const set = sets.get(id)!;
    if (isAdded) set.add(from);
    else set.delete(from);
    const after = Array.from(set).sort();
    const before = (isAdded ? after.filter((value) => value !== from) : [...after, from]).sort();
    const kept = hidden.get(id) ?? 0;
    await args.audit.log(
      {
        table: nature ? auditTableOf(nature, args.table) : args.table,
        recordId: id,
        action: 'update',
        before: auditedLinkSet(shape(before), kept),
        after: auditedLinkSet(shape(after), kept),
        userId: args.userId,
        source: args.source?.source,
        sourceRef: args.source?.sourceRef,
        // A line's History reads its link rows by their parent: the line names itself.
        parent: args.end === 'budget_line' ? { table: 'spend_items', id } : null,
      },
      { manager: mg },
    );
  }
}
