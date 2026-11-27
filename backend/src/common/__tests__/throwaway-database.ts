/**
 * The guard of the specs that need a throwaway database (they commit fixtures across connections,
 * or create a schema): the rule of the race specs (`spend/__tests__/race-harness.ts`). They refuse a
 * developer's `appdb`; they run on any other database (a lane copy `<db>_<n>`, a dedicated database
 * such as `appdb_ci`), and on GitHub Actions' `appdb`, a service container thrown away after the run.
 * A spec that calls this guard carries the marker `@throwaway-db-spec`: `scripts/run-ci-tests.js`
 * leaves it out of a run on a developer's `appdb`, as it does the race specs.
 *
 * The guard runs twice: on the URL before any connection (`assertThrowawayDatabase`), then on the
 * database the connection really opened (`assertThrowawayConnection`), which a URL may name other
 * than by its path (a socket URL with `?db=`, a query parameter). The race harness runs the same two.
 */

/** The database name of DATABASE_URL, or null (the reading of `scripts/run-ci-tests.js`). */
export function databaseName(url = process.env.DATABASE_URL): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

/** Refuses to run without DATABASE_URL, or against `appdb` outside GitHub Actions. */
export function assertThrowawayDatabase(spec: string): void {
  const name = databaseName();
  if (!name) throw new Error(`DATABASE_URL is required: ${spec} runs on a throwaway database such as appdb_ci.`);
  if (name === 'appdb' && process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error(`${spec} never runs against appdb: point DATABASE_URL at a throwaway database (appdb_ci, a lane copy).`);
  }
}

/**
 * The same refusal, on the database the connection opened (`current_database()`). A refused
 * connection is closed (`destroy`, a TypeORM DataSource), so the spec exits instead of waiting on it.
 */
export async function assertThrowawayConnection(
  source: { query: (sql: string) => Promise<Array<{ db?: string }>>; destroy?: () => Promise<void> },
  spec: string,
): Promise<void> {
  const [row] = await source.query('SELECT current_database() AS db');
  const refusal = !row?.db
    ? `${spec}: the connection names no database.`
    : row.db === 'appdb' && process.env.GITHUB_ACTIONS !== 'true'
      ? `${spec} never runs against appdb: point DATABASE_URL at a throwaway database (appdb_ci, a lane copy).`
      : null;
  if (!refusal) return;
  await source.destroy?.().catch(() => undefined);
  throw new Error(refusal);
}
