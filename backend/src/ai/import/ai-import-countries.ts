/**
 * Countries as an import writes them, two-letter ISO codes, read from a code or a country's name in
 * English, French, German or Spanish (`Netherlands`, `Pays-Bas`, `Niederlande`, `Países Bajos`).
 */

const NAME_LANGUAGES = ['en', 'fr', 'de', 'es'] as const;
/** Region codes that name no country, or a territory ISO 3166 only reserves. */
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ', 'EA', 'IC', 'CP', 'DG', 'TA', 'AC']);
/** Names exports often use that the language tables do not give. */
const OTHER_NAMES: Record<string, string> = { uk: 'GB', usa: 'US', 'united states of america': 'US', holland: 'NL' };

function nameKey(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ');
}

/** The code an old or alias code stands for (`UK` for `GB`, `FX` for `FR`). */
function canonicalCode(code: string): string | null {
  try {
    return new Intl.Locale(`und-${code}`).region ?? null;
  } catch {
    return null;
  }
}

let countries: { codes: Set<string>; byName: Map<string, string> } | null = null;

function countryTables(): { codes: Set<string>; byName: Map<string, string> } {
  if (countries) return countries;
  const namers = NAME_LANGUAGES.map((language) => new Intl.DisplayNames([language], { type: 'region', fallback: 'none' }));
  const codes = new Set<string>();
  const byName = new Map<string, string>(Object.entries(OTHER_NAMES));
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      if (NOT_COUNTRIES.has(code) || canonicalCode(code) !== code || !namers[0].of(code)) continue;
      codes.add(code);
      for (const namer of namers) {
        const name = namer.of(code);
        if (name) byName.set(nameKey(name), code);
      }
    }
  }
  countries = { codes, byName };
  return countries;
}

/** The two-letter code of a country written by its code or its name; null when it names none. */
export function countryCode(value: string): string | null {
  const { codes, byName } = countryTables();
  const text = value.trim();
  if (/^[A-Za-z]{2}$/.test(text)) {
    const code = canonicalCode(text.toUpperCase());
    return code && codes.has(code) ? code : null;
  }
  return byName.get(nameKey(text)) ?? null;
}
