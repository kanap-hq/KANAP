import { BadRequestException } from '@nestjs/common';

/**
 * Rows of an import that look like a stored record (lot I3 of 26.11.9, the applications, T-I3d): the
 * shape the budget file gave them (lot I2, `BudgetFileLookalikes`), with a record named by its id
 * instead of a budget line's number. A row that would create a record and looks like one the person
 * reads is left out by default; the person may create it anyway or update that record.
 */

/** Why a row looks like a record: its name equal once accents are set aside, or close with the same supplier or publisher. */
export type ImportLookalikeReason = 'name_accents' | 'close_name';

/** The record a row looked like at a check, and its state then (16 hexadecimal characters; empty when it is gone). */
export interface ImportLookalikeTarget {
  id: string;
  state: string;
}

/** A row to create that looks like a stored record the person reads. */
export interface ImportLookalike {
  /** The row's line in the file (header counted). */
  line: number;
  /** The row's name. */
  name: string;
  /** The record it looks like: its id, reference, name and state at this check (reference, name and state empty when it is gone). */
  target: { id: string; ref: string; name: string; state: string };
  /** Absent when the row keeps a target it no longer looks like (the record changed since the check the person chose on). */
  reason?: ImportLookalikeReason;
  /** What the import does with it: left out (the default), created anyway, or the record updated. */
  outcome: 'ignored' | 'created' | 'updated';
  /** Whether the row may update that record: "Update" is offered only then. */
  updatable: boolean;
  /** For an update: the file's columns it changes (none when the record already holds the row). */
  fields?: string[];
}

export interface ImportLookalikes {
  /** The first LOOKALIKE_LIST_LIMIT, in file order. */
  lines: ImportLookalike[];
  /** Every row's target and its state now, by line of the file: what "Update all" sends back. */
  targets: Record<string, ImportLookalikeTarget>;
  count: number;
  ignored: number;
  created: number;
  updated: number;
  /**
   * The choices the import followed, the person's and the targets of the rows it left out by default:
   * the load (and the approval of Kad's card) sends them back, so that a row left out at the check is
   * never created without a choice, and an update is refused when its record changed since.
   */
  choices: ImportLookalikeChoice[];
}

/** Lookalikes a result lists; beyond, only the choice for all rows reaches them. */
export const IMPORT_LOOKALIKE_LIST_LIMIT = 200;

/**
 * What a row that looks like a record becomes: left out (sent only to override a choice for all rows),
 * created anyway, or the update of the record it looks like (`id`), whose `state` at the check makes
 * the update refused when the record changed since. For all rows: `targets`, by line of the file, the
 * record each row looked like at the check shown; a row it names keeps that target.
 */
export type ImportLookalikeChoice =
  | { kind: 'lookalike'; line: number; action: 'ignore' | 'create' }
  | { kind: 'lookalike'; line: number; action: 'update'; id: string; state?: string }
  | { kind: 'lookalikes'; action: 'ignore' | 'create' | 'update'; targets?: Record<string, ImportLookalikeTarget> };

/** Choices of a request or a card, all kinds together, as the budget file's. */
const CHOICE_LIMIT = 200;
/** The targets of a choice for all rows: a file's rows at most. */
const TARGETS_MAX = 20000;
const ACTIONS = new Set(['ignore', 'create', 'update']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isState(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function targetsOf(value: unknown): Record<string, ImportLookalikeTarget> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > TARGETS_MAX) return null;
  const targets: Record<string, ImportLookalikeTarget> = {};
  for (const [line, raw] of entries) {
    const target = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    // A record gone since the check has an empty state: the row keeps it and stays left out.
    if (!/^[1-9]\d{0,9}$/.test(line) || !isId(target.id) || !(isState(target.state) || target.state === '')) return null;
    targets[line] = { id: String(target.id).toLowerCase(), state: target.state };
  }
  return targets;
}

/** Whether an entry of a list of choices is a lookalike choice (one row, or all of them). */
export function isLookalikeChoiceEntry(entry: unknown): boolean {
  const kind = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).kind : undefined;
  return kind === 'lookalike' || kind === 'lookalikes';
}

/**
 * The lookalike choices of a list (a JSON text or an array): one per row at most (the first one), one
 * choice for all rows at most. Anything else, or more than 200 entries, throws.
 */
export function parseLookalikeChoices(raw: unknown): ImportLookalikeChoice[] {
  if (raw === undefined || raw === null || raw === '') return [];
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('The choices are not valid.');
    }
  }
  if (!Array.isArray(value) || value.length > CHOICE_LIMIT) throw new Error('The choices are not valid.');
  const choices: ImportLookalikeChoice[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    if (item.kind === 'lookalike' && isLine(item.line) && ACTIONS.has(item.action as string)) {
      const key = `lookalike|${item.line}`;
      if (item.action === 'update') {
        if (!isId(item.id) || (item.state !== undefined && !isState(item.state))) throw new Error('The choices are not valid.');
        if (!seen.has(key)) {
          choices.push({ kind: 'lookalike', line: item.line, action: 'update', id: item.id.toLowerCase(), ...(item.state !== undefined ? { state: item.state as string } : {}) });
        }
      } else if (!seen.has(key)) {
        choices.push({ kind: 'lookalike', line: item.line, action: item.action as 'ignore' | 'create' });
      }
      seen.add(key);
      continue;
    }
    if (item.kind === 'lookalikes' && ACTIONS.has(item.action as string)) {
      const targets = item.targets === undefined ? undefined : targetsOf(item.targets);
      if (targets === null) throw new Error('The choices are not valid.');
      if (!seen.has('lookalikes')) choices.push({ kind: 'lookalikes', action: item.action as 'ignore' | 'create' | 'update', ...(targets ? { targets } : {}) });
      seen.add('lookalikes');
      continue;
    }
    throw new Error('The choices are not valid.');
  }
  return choices;
}

/**
 * The `lookalikes` field of an import form (a JSON list of the choices above), read as the route reads
 * `unmatched`: never in the address, refused with 400 before any work when it cannot be read.
 */
export function csvLookalikes(raw: unknown): ImportLookalikeChoice[] {
  try {
    return parseLookalikeChoices(raw);
  } catch {
    throw new BadRequestException('The choices for the rows that look like a record are not valid.');
  }
}
