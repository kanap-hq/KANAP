import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { accentFreeKey, trigramSimilarity, trigrams } from '../common/name-matching';
import {
  IMPORT_LOOKALIKE_LIST_LIMIT,
  type ImportLookalike,
  type ImportLookalikeChoice,
  type ImportLookalikeReason,
  type ImportLookalikes,
  type ImportLookalikeTarget,
} from '../common/csv/csv-lookalikes';

/**
 * The applications a row of an import looks like (lot I3 of 26.11.9, T-I3d). The uniqueness rule of
 * the name does not change (case aside, accents kept): a row it finds updates that application. A row
 * that would create one looks like an application the person reads when:
 * - its name is that application's once accents are set aside (`name_accents`);
 * - or its name is close (`similarity` of 0.6 at least, the close title rule of the budget file) and it
 *   names the same supplier (resolved) or the same publisher, accents aside (`close_name`).
 * The first rule wins; within a rule, the closest name, then the smallest reference. Two rows of one
 * file are never compared. The row is left out by default; the person may create it anyway or update
 * that application (`ImportLookalikeChoice`).
 */

/** The close name rule: the budget file's close title threshold. */
export const CLOSE_NAME_THRESHOLD = 0.6;

/** An application as the lookalike rule reads it. */
export interface StoredApplication {
  id: string;
  sequential_id: string | null;
  name: string;
  supplier_id: string | null;
  editor: string | null;
  /** `updated_at` as PostgreSQL writes it, to the microsecond. */
  updated_at: string;
}

/** The applications of the workspace, in one query. */
export async function storedApplications(manager: EntityManager, tenantId: string): Promise<StoredApplication[]> {
  return manager.query(
    `SELECT id::text AS id, sequential_id, name, supplier_id::text AS supplier_id, editor, updated_at::text AS updated_at
       FROM applications WHERE tenant_id = $1`,
    [tenantId],
  );
}

/** An application's state: any write to it changes `updated_at`, so the state. 16 hexadecimal characters, as a budget line's. */
export function applicationState(app: Pick<StoredApplication, 'id' | 'updated_at'>): string {
  return createHash('sha256').update(`${app.id}|${app.updated_at}`).digest('hex').slice(0, 16);
}

/** The number of `APP-n`, for the order of the references; an application without one comes last. */
function numberOf(app: StoredApplication): number {
  const match = /(\d+)\s*$/.exec(app.sequential_id ?? '');
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** What the rule knows of a row that would create an application: its name, its supplier (resolved, or null) and its publisher. */
export interface ApplicationRowKeys {
  name: string;
  supplierId: string | null;
  editor: string | null;
}

export interface FoundApplication {
  app: StoredApplication;
  reason: ImportLookalikeReason;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The stored applications, indexed once per import: by name accents aside, by supplier and by publisher. */
export class ApplicationIndex {
  private readonly byName = new Map<string, StoredApplication[]>();
  private readonly bySupplier = new Map<string, StoredApplication[]>();
  private readonly byEditor = new Map<string, StoredApplication[]>();
  private readonly byId = new Map<string, StoredApplication>();
  /** Each name's trigrams, taken once (`similarity` would take them again for every row). */
  private readonly grams = new Map<StoredApplication, Set<string>>();

  constructor(apps: readonly StoredApplication[]) {
    const sorted = [...apps].sort((a, b) => numberOf(a) - numberOf(b) || a.id.localeCompare(b.id));
    for (const app of sorted) {
      this.byId.set(app.id, app);
      push(this.byName, accentFreeKey(app.name), app);
      if (app.supplier_id) push(this.bySupplier, app.supplier_id, app);
      const editor = accentFreeKey(app.editor ?? '');
      if (editor) push(this.byEditor, editor, app);
    }
  }

  /** The application a row looks like, by the first rule that finds one, or null. */
  find(row: ApplicationRowKeys): FoundApplication | null {
    const key = accentFreeKey(row.name);
    if (!key) return null;
    const same = this.byName.get(key)?.[0];
    if (same) return { app: same, reason: 'name_accents' };
    const candidates = new Set<StoredApplication>([
      ...(row.supplierId ? this.bySupplier.get(row.supplierId) ?? [] : []),
      ...(this.byEditor.get(accentFreeKey(row.editor ?? '')) ?? []),
    ]);
    let best: { app: StoredApplication; score: number } | null = null;
    const grams = trigrams(row.name);
    for (const app of candidates) {
      let stored = this.grams.get(app);
      if (!stored) this.grams.set(app, (stored = trigrams(app.name)));
      // Shared trigrams over all of them: below the threshold whenever one name has too few for the other.
      const [few, many] = grams.size < stored.size ? [grams.size, stored.size] : [stored.size, grams.size];
      if (few < CLOSE_NAME_THRESHOLD * many) continue;
      const score = trigramSimilarity(grams, stored);
      if (score < CLOSE_NAME_THRESHOLD) continue;
      if (!best || score > best.score || (score === best.score && numberOf(app) < numberOf(best.app))) best = { app, score };
    }
    return best ? { app: best.app, reason: 'close_name' } : null;
  }

  get(id: string): StoredApplication | undefined {
    return this.byId.get(id);
  }
}

/** A row of the file as the decision reads it: its line, its keys, and the application its name or id already finds. */
export interface LookalikeRow {
  line: number;
  keys: ApplicationRowKeys | null;
  /** The application the row updates by its id or name (the uniqueness rule), or null when it would create one. */
  foundId: string | null;
}

/** What the import does with a row that looks like an application. */
export interface LookalikeDecision {
  line: number;
  name: string;
  /** The application it looks like (undefined when it is gone). */
  app?: StoredApplication;
  /** Its id, the one the row looked like at the check when the application is gone. */
  id: string;
  reason?: ImportLookalikeReason;
  action: 'ignore' | 'create' | 'update';
  updatable: boolean;
  /** The application's state now (empty when it is gone). */
  state: string;
  /** For an update: whether the application changed since the state the choice carries. */
  stale?: boolean;
  /** An update left out because another row of the file already updates that application: that row's line. */
  claimedBy?: number;
}

/**
 * For each row that would create an application and looks like one, what the import does with it: left
 * out unless the person chose otherwise (P2), the choice for the row winning over the choice for all
 * rows. As the budget file (`decideLookalikes`, lot I2): a row keeps the target of the check the person
 * chose on (an update's `id` with its `state`, or the `targets` of the choice for all rows) even when it
 * no longer looks like it; an update is then refused when the application changed, and a row left out
 * stays left out. A choice that no longer applies (`updatable` false, or the application gone) falls back
 * to leaving the row out, and so does a second row that would update an application the file already
 * updates. `followed`: the choices the import followed, for the load to send back.
 */
export function decideLookalikes(
  rows: readonly LookalikeRow[],
  index: ApplicationIndex,
  choices: readonly ImportLookalikeChoice[],
  options: { updatable: boolean },
): { decisions: Map<number, LookalikeDecision>; followed: ImportLookalikeChoice[] } {
  const decisions = new Map<number, LookalikeDecision>();
  const perRow = new Map<number, Extract<ImportLookalikeChoice, { kind: 'lookalike' }>>();
  for (const choice of choices) if (choice.kind === 'lookalike' && !perRow.has(choice.line)) perRow.set(choice.line, choice);
  const all = choices.find((choice): choice is Extract<ImportLookalikeChoice, { kind: 'lookalikes' }> => choice.kind === 'lookalikes');
  const memory = all?.targets;
  const followed: ImportLookalikeChoice[] = [];
  const kept: Record<string, ImportLookalikeTarget> = {};
  // The applications the file updates by their id or name, and the row that updates each.
  const claimed = new Map<string, number>();
  for (const row of rows) if (row.foundId && !claimed.has(row.foundId)) claimed.set(row.foundId, row.line);
  for (const row of rows) {
    if (row.foundId || !row.keys) continue;
    const found = index.find(row.keys);
    const chosen = perRow.get(row.line);
    const remembered = memory?.[String(row.line)];
    const pinned = chosen?.action === 'update' && (chosen.state !== undefined || chosen.id === found?.app.id)
      ? chosen.id
      : remembered?.id;
    const id = pinned ?? found?.app.id;
    if (id === undefined) continue;
    const alike = found && found.app.id === id ? found : null;
    const app = alike?.app ?? index.get(id);
    const updatable = !!app && options.updatable;
    const state = app ? applicationState(app) : '';
    let action: LookalikeDecision['action'] = 'ignore';
    let expected: string | undefined;
    let follow: ImportLookalikeChoice | null = null;
    let claimedBy: number | undefined;
    if (chosen) {
      if (chosen.action !== 'update') {
        action = chosen.action;
        follow = chosen;
      } else if (chosen.id === id && updatable) {
        action = 'update';
        expected = chosen.state;
        follow = { ...chosen, state: chosen.state ?? state };
      }
    } else if (all?.action === 'create') {
      action = 'create';
    } else if (all?.action === 'update' && updatable && (!memory || remembered)) {
      action = 'update';
      expected = remembered?.state;
    }
    if (action === 'update') {
      const other = claimed.get(id);
      if (other !== undefined) {
        // Two rows, one application: the first row of the file updates it, the next one is left out.
        claimedBy = other;
        action = 'ignore';
        follow = null;
      } else claimed.set(id, row.line);
    }
    if (follow) followed.push(follow);
    if (remembered || all?.action !== 'update' || action === 'update') kept[String(row.line)] = remembered ?? { id, state };
    decisions.set(row.line, {
      line: row.line,
      name: row.keys.name,
      ...(app ? { app } : {}),
      id,
      ...(alike ? { reason: alike.reason } : {}),
      action,
      updatable,
      state,
      ...(action === 'update' ? { stale: expected !== undefined && expected !== state } : {}),
      ...(claimedBy !== undefined ? { claimedBy } : {}),
    });
  }
  // The choice for all rows, with the target of every row it covers: what the person saw. Given back
  // even when they chose nothing (`ignore`), so that the load and the card's approval keep it.
  if (Object.keys(kept).length > 0) followed.push({ kind: 'lookalikes', action: all?.action ?? 'ignore', targets: kept });
  return { decisions, followed };
}

/** A decision as the result lists it. */
export function lookalikeEntry(decision: LookalikeDecision, fields?: string[]): ImportLookalike {
  const outcome = decision.action === 'ignore' ? 'ignored' : decision.action === 'create' ? 'created' : 'updated';
  return {
    line: decision.line,
    name: decision.name,
    target: {
      id: decision.id,
      ref: decision.app?.sequential_id ?? '',
      name: decision.app?.name ?? '',
      state: decision.state,
    },
    ...(decision.reason ? { reason: decision.reason } : {}),
    outcome,
    updatable: decision.updatable,
    ...(outcome === 'updated' ? { fields: fields ?? [] } : {}),
  };
}

/** The result's `lookalikes`: the first entries, every row's target now, the counts, and the choices followed. */
export function lookalikesResult(entries: readonly ImportLookalike[], followed: ImportLookalikeChoice[]): ImportLookalikes {
  const count = (outcome: ImportLookalike['outcome']) => entries.filter((entry) => entry.outcome === outcome).length;
  return {
    lines: entries.slice(0, IMPORT_LOOKALIKE_LIST_LIMIT),
    targets: Object.fromEntries(entries.map((entry) => [String(entry.line), { id: entry.target.id, state: entry.target.state }])),
    count: entries.length,
    ignored: count('ignored'),
    created: count('created'),
    updated: count('updated'),
    choices: followed,
  };
}
