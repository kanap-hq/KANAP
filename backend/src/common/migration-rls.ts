import type { QueryRunner } from 'typeorm';

/**
 * For migrations, which run without app.current_tenant while FORCE RLS binds the table owner:
 * runs `fn` with RLS disabled on `tables`, then puts back the state found (ENABLE, FORCE), also
 * when `fn` throws.
 */
export async function withRlsDisabled<T>(queryRunner: QueryRunner, tables: readonly string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ relname: string; enabled: boolean; forced: boolean }> = await queryRunner.query(
    `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
       FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`,
    [tables],
  );
  for (const table of tables) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  try {
    return await fn();
  } finally {
    for (const state of states) {
      if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.relname} ENABLE ROW LEVEL SECURITY`);
      if (state.forced) await queryRunner.query(`ALTER TABLE ${state.relname} FORCE ROW LEVEL SECURITY`);
    }
  }
}
