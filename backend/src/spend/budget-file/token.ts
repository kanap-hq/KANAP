import { BUDGET_YEAR_MAX, BUDGET_YEAR_MIN } from '../../common/csv-sheet';

export interface TokenYear {
  year: number;
  rev: number;
}

export type ParsedToken =
  | { kind: 'absent' }
  | { kind: 'blank' }
  | { kind: 'bad'; raw: string }
  | { kind: 'ok'; raw: string; rowVersion: number; years: TokenYear[] };

const TOKEN = /^[vV](\d+)((?:\.\d{4}[rR]\d+)*)$/;

/**
 * `v7` or `v7.2026r3.2027r1`. A blank cell is no freshness check. Anything
 * else is a row error. Years are unique and in 1900..2199. `v` and `r` may
 * be upper case. The export writes lower case.
 */
export function parseToken(raw: string): ParsedToken {
  const text = raw.trim();
  if (text === '') return { kind: 'blank' };
  const match = TOKEN.exec(text);
  if (!match) return { kind: 'bad', raw: text };
  const rowVersion = Number(match[1]);
  if (!Number.isSafeInteger(rowVersion) || rowVersion < 1) return { kind: 'bad', raw: text };
  const years: TokenYear[] = [];
  const seen = new Set<number>();
  for (const part of match[2].split('.').filter(Boolean)) {
    const piece = /^(\d{4})[rR](\d+)$/.exec(part);
    if (!piece) return { kind: 'bad', raw: text };
    const year = Number(piece[1]);
    const rev = Number(piece[2]);
    if (year < BUDGET_YEAR_MIN || year > BUDGET_YEAR_MAX) return { kind: 'bad', raw: text };
    if (!Number.isSafeInteger(rev) || rev < 0) return { kind: 'bad', raw: text };
    if (seen.has(year)) return { kind: 'bad', raw: text };
    seen.add(year);
    years.push({ year, rev });
  }
  return { kind: 'ok', raw: text, rowVersion, years };
}

/** The token the export writes. Years with no version are left out. */
export function formatToken(rowVersion: number, years: readonly TokenYear[]): string {
  const sorted = [...years].sort((a, b) => a.year - b.year);
  return `v${rowVersion}${sorted.map((year) => `.${year.year}r${year.rev}`).join('')}`;
}

export function tokenError(raw: string): string {
  return `kanap_token '${raw}' is not a line token. Export the line again.`;
}
