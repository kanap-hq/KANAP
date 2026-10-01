import type { FieldSql } from './list-engine.types';

/**
 * One SQL statement under construction: positional parameters, the CTEs and
 * the joins its fragments registered (in registration order, so a join or a
 * CTE always follows what it depends on), and the fields already compiled.
 * The tenant is always `$1`.
 */
export class SqlStatement {
  readonly params: unknown[] = [];
  private readonly ctes = new Map<string, string>();
  private readonly joins = new Map<string, { sql: string; deps: string[] }>();
  readonly fieldCache = new Map<string, FieldSql>();

  constructor(tenantId: string) {
    this.params.push(tenantId);
  }

  get tenant(): string {
    return '$1';
  }

  /** Binds a value: `$n`, with an optional cast. */
  bind(value: unknown, cast?: string): string {
    this.params.push(value);
    return `$${this.params.length}${cast ? `::${cast}` : ''}`;
  }

  /** Registers a CTE once; returns its name. */
  cte(name: string, build: () => string): string {
    if (!this.ctes.has(name)) {
      // Build first: the body may register the CTEs it reads, which must come before it.
      const sql = build();
      if (!this.ctes.has(name)) this.ctes.set(name, sql);
    }
    return name;
  }

  hasCte(name: string): boolean {
    return this.ctes.has(name);
  }

  /** Registers a join once (after its dependencies); returns its key. */
  join(key: string, build: () => string, deps: string[] = []): string {
    if (!this.joins.has(key)) {
      const sql = build();
      if (!this.joins.has(key)) this.joins.set(key, { sql, deps });
    }
    return key;
  }

  /** The joins needed by `keys`, dependencies included, in registration order. */
  joinSql(keys: Iterable<string>): string {
    const wanted = new Set<string>();
    const visit = (key: string) => {
      if (wanted.has(key)) return;
      const def = this.joins.get(key);
      if (!def) throw new Error(`Unknown join ${key}`);
      wanted.add(key);
      for (const dep of def.deps) visit(dep);
    };
    for (const key of keys) visit(key);
    return Array.from(this.joins.entries())
      .filter(([key]) => wanted.has(key))
      .map(([, def]) => def.sql)
      .join('\n');
  }

  /**
   * The statement to run: only the parameters the text references, numbered
   * again in order of first use. A field resolved for a filter that turned
   * out to filter nothing may have bound values the final text never reads,
   * which PostgreSQL would refuse. The text must hold no `$n` inside a string
   * literal (the engine binds every value instead).
   */
  finalize(sql: string): { sql: string; params: unknown[] } {
    const renumbered = new Map<number, number>();
    const params: unknown[] = [];
    const text = sql.replace(/\$(\d+)/g, (_match, digits: string) => {
      const index = Number(digits);
      let next = renumbered.get(index);
      if (next == null) {
        params.push(this.params[index - 1]);
        next = params.length;
        renumbered.set(index, next);
      }
      return `$${next}`;
    });
    return { sql: text, params };
  }

  /** `WITH …` of every registered CTE, or ''. */
  withClause(extra: Array<[string, string]> = []): string {
    const all = [...Array.from(this.ctes.entries()), ...extra];
    if (!all.length) return '';
    return `WITH ${all.map(([name, sql]) => `${name} AS (${sql})`).join(',\n')}\n`;
  }
}

/**
 * A TypeORM-style fragment (`:name`, `:...name`) rewritten with positional
 * parameters of `stmt`. Used for the shared `compileAgFilterCondition`.
 */
export function bindNamed(stmt: SqlStatement, sql: string, params: Record<string, unknown>): string {
  return sql.replace(/:(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)/g, (match, spread: string | undefined, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
    const value = params[name];
    if (spread && Array.isArray(value)) return value.map((entry) => stmt.bind(entry)).join(', ');
    return stmt.bind(value);
  });
}
