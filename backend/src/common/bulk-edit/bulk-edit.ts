import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { UUID_RE } from '../relations/relation-target';

/**
 * Changes in bulk from a list: one change applied to the rows the person chose, or to every row
 * of the list's filters less the rows unticked. The contract of the vulnerabilities' bulk state
 * (`vulnerabilities.service.ts`, `bulkState`), shared:
 * - the rows: `ids` (the chosen rows, taken as they are), or `all: true` with `filters` (the
 *   list's parameters) and `exclude_ids`;
 * - `dry_run: true` (a boolean, else a 400) counts without writing and returns `as_of`, the instant of the count; the write
 *   sends it back with `expected_rows`, the rows of the count (both required with `all`): rows that
 *   are more than counted refuse the write whole with a 409 `bulk_list_changed`;
 * - at most `BULK_MAX_ROWS` rows (400 `bulk_too_many`).
 *
 * `runBulkEdit` adds the write of a list whose rows are written one by one through the update of
 * one row (`BulkEditList`). Its dry run also returns `fingerprint`, which names the rows it reached;
 * the write sends it back (required with `all`) and refuses with the same 409 as soon as the rows it
 * reaches are no longer those of the count, a row swapped for another included. Every row is written
 * in a savepoint of the request's transaction, the refusals of
 * a row counted under a stable code (the screen and Kad word them) and the row left as it is, any
 * other error failing the whole request. The dry run plays the same writes under a savepoint, then
 * rolls them back: its counts are the write's. Each list declares the fields it changes in bulk
 * (`BulkEditField`) and how a row takes them.
 */

/** At most this many rows in one change in bulk. */
export const BULK_MAX_ROWS = 5000;

/** The 400 of a change in bulk over `BULK_MAX_ROWS` rows; `rows`, the rows the filters reach. */
export function bulkTooMany(rows?: number): BadRequestException {
  return new BadRequestException({
    code: 'bulk_too_many',
    message: rows === undefined
      ? `At most ${BULK_MAX_ROWS} rows at once: narrow the filters.`
      : `These filters reach ${rows} rows, more than ${BULK_MAX_ROWS} at once: narrow them.`,
  });
}

/** The 409 of a write that reaches more rows than its dry run counted: nothing is written. */
export function bulkListChanged(): ConflictException {
  return new ConflictException({ code: 'bulk_list_changed', message: 'The list changed since the count: count again.' });
}

export type BulkSelection = {
  all: boolean;
  /** The chosen rows, lower case, without repeats (empty with `all`). */
  ids: string[];
  /** The rows unticked from the filter (with `all` only). */
  excluded: string[];
  /** The list's parameters (with `all`). */
  filters: Record<string, unknown>;
};

/**
 * `dry_run`, when given, is a boolean: a text "true" read as anything but a count would write without
 * one. Checked by both parses, so a route refuses it at its first one, before it reads anything.
 */
function assertDryRunFlag(body: Record<string, unknown>): void {
  if (body.dry_run !== undefined && body.dry_run !== null && typeof body.dry_run !== 'boolean') {
    throw new BadRequestException('dry_run must be true or false.');
  }
}

/** The rows of a change in bulk: `ids`, or `all` with `filters` less `exclude_ids`. */
export function parseBulkSelection(body: Record<string, unknown>): BulkSelection {
  assertDryRunFlag(body);
  const all = body.all === true;
  const rowIds = (name: 'ids' | 'exclude_ids'): string[] => {
    const raw = body[name];
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new BadRequestException(`${name} must be a list of row ids.`);
    const ids = Array.from(new Set(raw.map((v) => String(v ?? '').trim().toLowerCase())));
    if (ids.some((id) => !UUID_RE.test(id))) throw new BadRequestException(`${name} must be row ids.`);
    if (ids.length > BULK_MAX_ROWS) throw bulkTooMany();
    return ids;
  };
  const ids = rowIds('ids');
  const excluded = rowIds('exclude_ids');
  if (all && ids.length > 0) throw new BadRequestException('Send the chosen rows (ids) or every row of the filter (all: true), not both.');
  if (!all && excluded.length > 0) throw new BadRequestException('exclude_ids goes with all: true.');
  if (!all && ids.length === 0) throw new BadRequestException('Choose the rows (ids), or every row of the filter (all: true).');
  const filters = (body.filters && typeof body.filters === 'object' ? body.filters : {}) as Record<string, unknown>;
  return { all, ids, excluded, filters };
}

export type BulkConfirmation = {
  dryRun: boolean;
  /** The instant of the dry run, ISO; null when not sent. */
  asOf: string | null;
  /** The rows the dry run counted; null when not sent. */
  expectedRows: number | null;
  /** The `fingerprint` of the rows the dry run reached (`runBulkEdit`); null when not sent. */
  fingerprint: string | null;
};

/**
 * `dry_run`, and the `as_of`, `expected_rows` and `fingerprint` of the count the write confirms (the
 * first two required with `all`; `runBulkEdit` requires the third with `all`).
 */
export function parseBulkConfirmation(body: Record<string, unknown>, all: boolean): BulkConfirmation {
  assertDryRunFlag(body);
  const dryRun = body.dry_run === true;
  // Every one of the filter: only what the user confirmed, so the count's instant is required.
  if (all && !dryRun && (body.as_of === undefined || body.as_of === null)) {
    throw new BadRequestException('as_of is required with all: send the instant the dry run returned.');
  }
  // The rows the user confirmed (the dry run's `rows`): required with all, checked under the lock.
  let expectedRows: number | null = null;
  if (body.expected_rows !== undefined && body.expected_rows !== null) {
    expectedRows = Number(body.expected_rows);
    if (!Number.isSafeInteger(expectedRows) || expectedRows < 0) throw new BadRequestException('expected_rows must be the rows the dry run counted.');
  } else if (all && !dryRun) {
    throw new BadRequestException('expected_rows is required with all: send the rows the dry run counted.');
  }
  let asOf: string | null = null;
  if (body.as_of !== undefined && body.as_of !== null) {
    const date = new Date(String(body.as_of));
    if (Number.isNaN(date.getTime())) throw new BadRequestException('as_of must be the instant a dry run returned.');
    asOf = date.toISOString();
  }
  let fingerprint: string | null = null;
  if (body.fingerprint !== undefined && body.fingerprint !== null) {
    if (typeof body.fingerprint !== 'string' || !FINGERPRINT_RE.test(body.fingerprint)) {
      throw new BadRequestException('fingerprint must be the one the dry run returned.');
    }
    fingerprint = body.fingerprint;
  }
  return { dryRun, asOf, expectedRows, fingerprint };
}

const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

/** The rows a count reached, as one value: their ids, sorted, hashed. */
export function bulkFingerprint(ids: readonly string[]): string {
  return createHash('sha256').update([...ids].map((id) => id.toLowerCase()).sort().join(',')).digest('hex');
}

/**
 * A field a list changes in bulk: `id`, a row id of the tenant (the list's update of one row
 * resolves it); `enum`, one of `values`; `id_map`, an object from ids to ids (a dimension to its
 * value), each entry changed alone. `optional`: null (the field emptied) is a value; an `id_map`
 * entry may always be null, the row's update says whether its dimension may be emptied.
 */
export type BulkEditField = {
  name: string;
  value: 'id' | 'enum' | 'id_map';
  values?: readonly string[];
  optional: boolean;
};

export type BulkChanges = Record<string, string | null | Record<string, string | null>>;

/** `changes`: at least one declared field, each value of its type; ids in lower case. */
export function parseBulkChanges(raw: unknown, fields: readonly BulkEditField[]): BulkChanges {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('changes must name at least one field.');
  const byName = new Map(fields.map((field) => [field.name, field]));
  const id = (value: unknown, name: string): string | null => {
    if (value === null) return null;
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!UUID_RE.test(text)) throw new BadRequestException(`${name} must be an id or null.`);
    return text;
  };
  const changes: BulkChanges = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined) continue;
    const field = byName.get(name);
    if (!field) throw new BadRequestException(`${name} cannot be changed in bulk.`);
    if (value === null && field.value !== 'id_map') {
      if (!field.optional) throw new BadRequestException(`${name} cannot be emptied.`);
      changes[name] = null;
    } else if (field.value === 'id') {
      changes[name] = id(value, name);
    } else if (field.value === 'enum') {
      if (typeof value !== 'string' || !(field.values ?? []).includes(value)) {
        throw new BadRequestException(`${name} must be one of ${(field.values ?? []).join(', ')}${field.optional ? ' or null' : ''}.`);
      }
      changes[name] = value;
    } else {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`${name} must map ids to ids or null.`);
      const entries: Record<string, string | null> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry === undefined) continue;
        entries[id(key, name)!] = id(entry, name);
      }
      if (Object.keys(entries).length === 0) continue;
      changes[name] = entries;
    }
  }
  if (Object.keys(changes).length === 0) throw new BadRequestException('changes must name at least one field.');
  return changes;
}

/** The code of a chosen row that the person cannot read or that is gone: the same for both, so nothing leaks. */
export const BULK_REFUSAL_NOT_FOUND = 'not_found';

export type BulkEditOutcome = 'changed' | 'unchanged';

/**
 * A list that changes its rows in bulk. `reach` returns the rows the selection reaches that the
 * person can read, in the order they are written (the lock order of the list: by id); for chosen
 * rows, those it does not return are counted `not_found`. `apply` writes the changes on one row
 * through the list's update of one row (`unchanged` when the row already holds them: nothing
 * written). `refusal` gives the stable code of an error of `apply` that refuses this row, or null:
 * the whole request then fails with the error.
 */
export type BulkEditList<Row extends { id: string }> = {
  reach(selection: BulkSelection, asOf: string | null): Promise<Row[]>;
  apply(row: Row): Promise<BulkEditOutcome>;
  refusal(error: unknown, row: Row): string | null;
};

/**
 * The answer: `rows`, the rows reached (`changes` or `changed`, plus `unchanged`, plus every refused
 * row); `refused`, the refused rows per code (a code with no row is absent). The dry run answers
 * `changes` and `as_of`, the write `changed`.
 */
export type BulkEditResult = {
  dry_run: boolean;
  rows: number;
  changes?: number;
  changed?: number;
  unchanged: number;
  refused: Record<string, number>;
  as_of?: string;
  /** The dry run's: the rows it reached (`bulkFingerprint`), sent back by the write. */
  fingerprint?: string;
};

const DRY_RUN_SAVEPOINT = 'bulk_edit_dry_run';
const ROW_SAVEPOINT = 'bulk_edit_row';

/**
 * Runs a change in bulk in the request's transaction (required: the dry run is rolled back to its
 * savepoint). The dry run takes `as_of` before it reaches the rows, and the list leaves out the rows
 * created after it, the dry run's as the write's. With `expected_rows`, rows reached beyond it
 * refuse the write whole (409); with `fingerprint` (required with `all`), so do rows reached that
 * are not those of the count.
 */
export async function runBulkEdit<Row extends { id: string }>(
  manager: EntityManager,
  list: BulkEditList<Row>,
  selection: BulkSelection,
  confirmation: BulkConfirmation,
): Promise<BulkEditResult> {
  if (!manager.queryRunner?.isTransactionActive) throw new Error('A change in bulk runs in the request transaction.');
  if (selection.all && !confirmation.dryRun && confirmation.fingerprint === null) {
    throw new BadRequestException('fingerprint is required with all: send the fingerprint the dry run returned.');
  }
  const asOf = confirmation.dryRun
    ? new Date((await manager.query(`SELECT clock_timestamp() AS now`))[0].now).toISOString()
    : confirmation.asOf;
  // Rolled back after the count; on an error, the request's transaction rolls back with it.
  if (confirmation.dryRun) await manager.query(`SAVEPOINT ${DRY_RUN_SAVEPOINT}`);
  // The dry run reaches as the write will: a row created after `as_of` is out of both.
  const rows = await list.reach(selection, asOf);
  const notFound = selection.all ? 0 : selection.ids.length - rows.length;
  const reached = rows.length + notFound;
  if (reached > BULK_MAX_ROWS) throw bulkTooMany(reached);
  if (confirmation.expectedRows !== null && reached > confirmation.expectedRows) throw bulkListChanged();
  // As many rows as counted is not enough: the same rows (one entering the filter while another
  // leaves it is a change of the list, as is a row that left it).
  const fingerprint = bulkFingerprint(rows.map((row) => row.id));
  if (confirmation.fingerprint !== null && confirmation.fingerprint !== fingerprint) throw bulkListChanged();
  const refused: Record<string, number> = notFound > 0 ? { [BULK_REFUSAL_NOT_FOUND]: notFound } : {};
  let changed = 0;
  let unchanged = 0;
  for (const row of rows) {
    await manager.query(`SAVEPOINT ${ROW_SAVEPOINT}`);
    let outcome: BulkEditOutcome;
    try {
      outcome = await list.apply(row);
    } catch (error) {
      await manager.query(`ROLLBACK TO SAVEPOINT ${ROW_SAVEPOINT}`);
      await manager.query(`RELEASE SAVEPOINT ${ROW_SAVEPOINT}`);
      const code = list.refusal(error, row);
      if (!code) throw error;
      refused[code] = (refused[code] ?? 0) + 1;
      continue;
    }
    await manager.query(`RELEASE SAVEPOINT ${ROW_SAVEPOINT}`);
    if (outcome === 'changed') changed += 1;
    else unchanged += 1;
  }
  if (confirmation.dryRun) {
    await manager.query(`ROLLBACK TO SAVEPOINT ${DRY_RUN_SAVEPOINT}`);
    await manager.query(`RELEASE SAVEPOINT ${DRY_RUN_SAVEPOINT}`);
    return { dry_run: true, rows: reached, changes: changed, unchanged, refused, as_of: asOf!, fingerprint };
  }
  return { dry_run: false, rows: reached, changed, unchanged, refused };
}
