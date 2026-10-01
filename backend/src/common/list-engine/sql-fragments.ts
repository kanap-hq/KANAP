/**
 * SQL fragments that reproduce a JavaScript rule exactly, one helper per rule.
 * Each is unit-tested against its JavaScript counterpart
 * (`__tests__/sql-fragments.spec.ts`); the list engine never writes these
 * expressions by hand.
 *
 * Every fragment takes and returns SQL text. Callers only ever pass column
 * references, bound parameters (`$n`) or other fragments: never user input.
 */

/** ICU root collation: the one text rule of the engine (sort, case mapping). Needs a PostgreSQL built with ICU. */
export const ICU_COLLATION = '"und-x-icu"';

/**
 * The ECMAScript white space and line terminators `String.prototype.trim`
 * removes, as a PostgreSQL escape-string literal. `btrim(x)` alone removes
 * spaces only.
 */
const JS_WHITESPACE_CODE_POINTS = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
export const JS_WHITESPACE_SQL = `E'${JS_WHITESPACE_CODE_POINTS.map((cp) => `\\u${cp.toString(16).padStart(4, '0').toUpperCase()}`).join('')}'`;

/** `s.toLowerCase()`: ICU full case mapping, like V8 (`İ` → `i̇`, a final `Σ` → `ς`). */
export function jsLower(expr: string): string {
  return `lower((${expr}) COLLATE ${ICU_COLLATION})`;
}

/** `s.toUpperCase()`. */
export function jsUpper(expr: string): string {
  return `upper((${expr}) COLLATE ${ICU_COLLATION})`;
}

/** `s.trim()`. */
export function jsTrim(expr: string): string {
  return `btrim(${expr}, ${JS_WHITESPACE_SQL})`;
}

/**
 * Accent and case folding of the quick search and the text filters
 * (decision Q2): `unaccent`, then the JavaScript lowercasing. The oracle
 * folds with the same character map, read from the database's own rules.
 */
export function fold(expr: string): string {
  return `lower(public.unaccent(${expr}) COLLATE ${ICU_COLLATION})`;
}

/**
 * `Math.round(x)` for a float8 `x`: ties toward +∞, exact for every finite
 * double (`floor(x + 0.5)` is not, at 0.49999999999999994 and beyond 2^52).
 * Returns a float8 holding an integer.
 */
export function jsRound(x: string): string {
  return `(floor(${x}) + CASE WHEN (${x}) - floor(${x}) >= 0.5 THEN 1 ELSE 0 END)`;
}

/** The UTC calendar day of a timestamptz, independent of the session time zone. */
export function utcDay(ts: string): string {
  return `((${ts}) AT TIME ZONE 'UTC')::date`;
}

/** Days since 1970-01-01 of a `date` expression: compared with `Date.UTC(...) / 86400000` computed in JavaScript. */
export function epochDay(dateExpr: string): string {
  return `((${dateExpr}) - DATE '1970-01-01')`;
}

/** `date.toISOString()` of a timestamptz as JavaScript holds it (millisecond precision, truncated). */
export function jsIsoString(ts: string): string {
  return `to_char(date_trunc('milliseconds', ${ts}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** `String(n)` of a 2-decimal number held as integer cents (bigint). */
export function centsText(cents: string): string {
  return `trim_scale((${cents})::numeric / 100)::text`;
}

/**
 * A 2-decimal `numeric` as the double JavaScript parses from its text
 * (`Number(formatCents(toCents(text)))`): exact cents through bigint, then
 * one correctly rounded division. Cheaper than `numeric::float8`, which
 * formats and parses text, and equal to it for 2-decimal values.
 */
export function decimal2ToFloat(expr: string): string {
  return `(((${expr}) * 100)::bigint::float8 / 100)`;
}

/** `Number(formatCents(c))` of integer cents: IEEE division is correctly rounded, so it equals the parsed decimal. */
export function centsNumber(cents: string): string {
  return `((${cents})::float8 / 100)`;
}

/** The sort key of a text value: blank (null or '') last ascending, then the ICU order. */
export function textSortKey(expr: string): string {
  return `NULLIF(${expr}, '') COLLATE ${ICU_COLLATION}`;
}

/** The sort key of a timestamp as JavaScript compares it (millisecond precision). */
export function timestampSortKey(ts: string): string {
  return `date_trunc('milliseconds', ${ts})`;
}

/** Quotes a constant string as a SQL literal (for engine constants such as labels; never user input). */
export function sqlLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ----- JavaScript side -----

const collator = new Intl.Collator('en-US');

/**
 * The text order of the engine on the JavaScript side (decision Q1): the ICU
 * root order (`en-US` has no tailoring), then code point order for strings
 * ICU finds equal, like a deterministic PostgreSQL ICU collation. A total
 * order: only identical strings compare equal.
 */
export function naturalCompare(a: string, b: string): number {
  const byCollation = collator.compare(a, b);
  if (byCollation !== 0) return byCollation;
  if (a === b) return 0;
  return codePointCompare(a, b);
}

/** Code point (UTF-8 byte) order, unlike `<` on UTF-16 code units. */
export function codePointCompare(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const ca = ia.next();
    const cb = ib.next();
    if (ca.done || cb.done) return ca.done ? (cb.done ? 0 : -1) : 1;
    const da = ca.value.codePointAt(0)!;
    const db = cb.value.codePointAt(0)!;
    if (da !== db) return da < db ? -1 : 1;
  }
}

/** Values with nulls last, the rest in the natural order. */
export function compareNullableText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return naturalCompare(a, b);
}
