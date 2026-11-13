import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import {
  BULK_MAX_ROWS,
  BULK_REFUSAL_NOT_FOUND,
  BulkEditField,
  BulkEditList,
  BulkEditResult,
  bulkTooMany,
  parseBulkChanges,
  parseBulkConfirmation,
  parseBulkSelection,
  runBulkEdit,
} from '../common/bulk-edit/bulk-edit';

/**
 * "Change the selection" of the applications list (lot F2 of 26.11.8): one change on many
 * applications, each through the update of one application, in the request's transaction: the
 * PATCH's (`ApplicationsCrudService.update`) for the lifecycle and the business criticality, the
 * owners' replacement of the application page (`ApplicationsOwnersService.bulkReplaceOwners`) for
 * the business and IT owners. Every rule of those updates holds for each application: the
 * lifecycle states and the classification catalog of the tenant, the classification revision a
 * new criticality raises, the audit row (the application's history) and the search index their
 * triggers maintain. The contract is the common one (`common/bulk-edit/bulk-edit.ts`).
 *
 * The fields: business owners, IT owners (a list of people that replaces the application's, as
 * the page saves it; empty, the role has nobody), lifecycle (one of the tenant's states, never
 * empty, as on the page) and business criticality (one of the tenant's levels still offered, or
 * empty).
 *
 * The rows: the chosen applications, or every application of the list's filters, quick search and
 * scope (`ApplicationsListService.listIds`, the list's own query), less those unticked. A Business
 * Contributor reaches only the applications they own, as the list shows them: a chosen application
 * outside them and an id that names nothing are both counted `not_found`, so the count says nothing
 * of the others. An application that already holds the value is `unchanged`, without a write.
 */

/** The codes of a refused application, which the screen and Kad word. */
export const APPLICATION_BULK_REFUSALS = [BULK_REFUSAL_NOT_FOUND] as const;

const OWNER_FIELDS = { owners_business: 'business', owners_it: 'it' } as const;
type OwnerField = keyof typeof OWNER_FIELDS;
type OwnerType = (typeof OWNER_FIELDS)[OwnerField];
const COLUMN_FIELDS = ['lifecycle', 'criticality'] as const;

/** The fields, with the tenant's values: its lifecycle states, its business criticality levels still offered. */
export function applicationBulkFields(values: { lifecycle: readonly string[]; criticality: readonly string[] }): BulkEditField[] {
  return [
    { name: 'owners_business', value: 'id_list', optional: true },
    { name: 'owners_it', value: 'id_list', optional: true },
    { name: 'lifecycle', value: 'enum', values: values.lifecycle, optional: false },
    { name: 'criticality', value: 'enum', values: values.criticality, optional: true },
  ];
}

type AppRow = {
  id: string;
  lifecycle: string;
  criticality: string | null;
  owners: Array<{ user_id: string; owner_type: OwnerType }>;
};

export type ApplicationBulkDeps = {
  manager: EntityManager;
  tenantId: string;
  /** A Business Contributor's: the applications they own only. */
  accessScope?: ParticipationAccessScope;
  /** The values the enum fields accept, the tenant's (`ApplicationsCrudService.bulkEditValues`). */
  values: () => Promise<{ lifecycle: string[]; criticality: string[] }>;
  /** The ids of the list's filters, with the person's scope (`ApplicationsListService.listIds`). */
  listIds: (query: Record<string, unknown>) => Promise<{ ids: string[]; total: number }>;
  /** The update of one application (the PATCH's), on the request's manager. */
  update: (id: string, patch: Record<string, unknown>) => Promise<void>;
  /** The owners' replacement of one application (the page's), on the request's manager. */
  replaceOwners: (id: string, owners: Array<{ user_id: string; owner_type: OwnerType }>) => Promise<void>;
};

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/**
 * The body of `POST /applications/bulk-update`: the selection (`ids`, or `all` with `filters` and
 * `exclude_ids`), `changes`, and `dry_run`, or the `as_of`, `expected_rows` and `fingerprint` of the
 * dry run.
 */
export async function bulkUpdateApplications(body: unknown, deps: ApplicationBulkDeps): Promise<BulkEditResult> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('A body is required.');
  const input = body as Record<string, unknown>;
  const selection = parseBulkSelection(input);
  const changes = parseBulkChanges(input.changes, applicationBulkFields(await deps.values()));
  const confirmation = parseBulkConfirmation(input, selection.all);
  const { manager, tenantId } = deps;
  const columns = COLUMN_FIELDS.filter((column) => column in changes);
  const ownerFields = (Object.keys(OWNER_FIELDS) as OwnerField[]).filter((field) => field in changes);
  const owners = (field: OwnerField) => (changes[field] as string[] | null) ?? [];

  const list: BulkEditList<AppRow> = {
    async reach(chosen, asOf) {
      let ids = chosen.ids;
      if (chosen.all) {
        const excluded = new Set(chosen.excluded);
        // The list's own query. The cap counts the applications left once the unticked ones are out,
        // as the budget lines do: the first ids past the cap plus the unticked ones are enough to
        // tell. Ids beyond them (the list caps its answer at 10,000) leave more than the cap anyway.
        const { __classificationExport: _internal, page: _page, sort: _sort, ...query } = chosen.filters;
        const found = await deps.listIds({ ...query, limit: String(BULK_MAX_ROWS + excluded.size + 1) });
        if (found.total > found.ids.length) throw bulkTooMany(found.total - excluded.size);
        ids = found.ids.filter((id) => !excluded.has(id.toLowerCase()));
        if (ids.length > BULK_MAX_ROWS) throw bulkTooMany(ids.length);
      }
      if (ids.length === 0) return [];
      // The lock order of the update of one application: the tenant's classification catalog, then
      // the application. Without it, a change in bulk holding applications would wait for the
      // catalog an update of one of them holds. The catalog's mode (`lockClassificationCatalog`):
      // the tenant's other inserts do not wait for the change.
      if (columns.length > 0) await manager.query(`SELECT id FROM tenants WHERE id = $1 FOR NO KEY UPDATE`, [tenantId]);
      const params: unknown[] = [tenantId, ids];
      let where = '';
      if (deps.accessScope) {
        params.push(deps.accessScope.userId);
        where += ` AND ${applicationParticipantCondition('a', `$${params.length}`)}`;
      }
      if (asOf) {
        params.push(asOf);
        where += ` AND a.created_at <= $${params.length}::timestamptz`;
      }
      // In id order, held until the end of the request: the update of one application locks it the same way.
      const rows: Array<{ id: string; lifecycle: string; criticality: string | null }> = await manager.query(
        `SELECT a.id::text AS id, a.lifecycle, a.criticality
           FROM applications a
          WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])${where}
          ORDER BY a.id
            FOR UPDATE OF a`,
        params,
      );
      const held = new Map<string, AppRow['owners']>();
      if (ownerFields.length > 0 && rows.length > 0) {
        const found: Array<{ application_id: string; user_id: string; owner_type: OwnerType }> = await manager.query(
          `SELECT application_id::text AS application_id, user_id::text AS user_id, owner_type
             FROM application_owners
            WHERE tenant_id = $1 AND application_id = ANY($2::uuid[])
            ORDER BY created_at, id`,
          [tenantId, rows.map((row) => row.id)],
        );
        for (const owner of found) {
          const list = held.get(owner.application_id) ?? [];
          list.push({ user_id: owner.user_id, owner_type: owner.owner_type });
          held.set(owner.application_id, list);
        }
      }
      return rows.map((row) => ({ ...row, owners: held.get(row.id) ?? [] }));
    },

    async apply(app) {
      const patch: Record<string, unknown> = {};
      for (const column of columns) {
        if ((app[column] ?? null) !== changes[column]) patch[column] = changes[column];
      }
      const ownersChange = ownerFields.some((field) => !sameIds(
        app.owners.filter((owner) => owner.owner_type === OWNER_FIELDS[field]).map((owner) => owner.user_id),
        owners(field),
      ));
      if (Object.keys(patch).length === 0 && !ownersChange) return 'unchanged';
      if (Object.keys(patch).length > 0) await deps.update(app.id, patch);
      if (ownersChange) {
        // The roles not in the change keep their people, as the page replaces one role.
        const changed = new Set(ownerFields.map((field) => OWNER_FIELDS[field]));
        await deps.replaceOwners(app.id, [
          ...app.owners.filter((owner) => !changed.has(owner.owner_type)),
          ...ownerFields.flatMap((field) => owners(field).map((user_id) => ({ user_id, owner_type: OWNER_FIELDS[field] }))),
        ]);
      }
      return 'changed';
    },

    refusal(error) {
      // Gone since it was reached: as an application that names nothing.
      return error instanceof NotFoundException ? BULK_REFUSAL_NOT_FOUND : null;
    },
  };
  return runBulkEdit(manager, list, selection, confirmation);
}
