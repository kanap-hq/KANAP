import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * The list engine needs two things from PostgreSQL that a stock build may
 * lack: the ICU collation `und-x-icu` (its single text rule: case mapping,
 * natural sort) and the `unaccent` function (accent folding of the quick
 * search and text filters). Official and PGDG builds have ICU; `unaccent`
 * comes with the migrations (1852900000000).
 *
 * Without them the lists built on the engine cannot answer correctly, and
 * there is no exact fallback. The rest of KANAP does not depend on them, so
 * the API still starts: the check runs once at startup and logs one clear
 * error line, and every engine request answers 503 with the same message
 * (degraded mode) instead of failing on a SQL error or sorting differently.
 */

export const LIST_ENGINE_REQUIREMENT =
  'PostgreSQL must be built with ICU (collation "und-x-icu") and have the unaccent extension: the OPEX and CAPEX lists cannot run without them.';

type SupportState = { ok: true } | { ok: false; missing: string[] };

let pending: Promise<SupportState> | null = null;
const logger = new Logger('ListEngine');

async function probe(manager: EntityManager): Promise<SupportState> {
  const [row] = await manager.query(
    `SELECT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu' AND collprovider = 'i') AS icu,
            to_regprocedure('public.unaccent(text)') IS NOT NULL AS unaccent`,
  );
  const missing: string[] = [];
  if (!row?.icu) missing.push('ICU collation "und-x-icu"');
  if (!row?.unaccent) missing.push('function public.unaccent(text)');
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** The outcome, probed once per process and logged; a failed probe (database not reachable) is retried next time. */
function supportState(manager: EntityManager): Promise<SupportState> {
  if (!pending) {
    pending = probe(manager).then(
      (state) => {
        if (state.ok) logger.log('List engine: ICU collation and unaccent available.');
        else logger.error(`List engine disabled: missing ${state.missing.join(' and ')}. ${LIST_ENGINE_REQUIREMENT}`);
        return state;
      },
      (err) => {
        pending = null;
        throw err;
      },
    );
  }
  return pending;
}

/** Startup check: logs the outcome, never throws. */
export async function checkListEngineSupport(manager: EntityManager): Promise<boolean> {
  try {
    return (await supportState(manager)).ok;
  } catch (err) {
    logger.warn(`List engine check failed, retried on the first list request: ${(err as Error).message}`);
    return false;
  }
}

/** Throws 503 when the database lacks what the engine needs. */
export async function assertListEngineSupport(manager: EntityManager): Promise<void> {
  const state = await supportState(manager);
  if (!state.ok) throw new ServiceUnavailableException(`${LIST_ENGINE_REQUIREMENT} Missing: ${state.missing.join(', ')}.`);
}

/** Test hook: forget the cached outcome. */
export function resetListEngineSupportForTests(): void {
  pending = null;
}
