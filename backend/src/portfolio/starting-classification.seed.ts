import { EntityManager } from 'typeorm';
import { SEED_LANGUAGES, SeedLanguage } from '../analytics/recommended-dimensions.seed';

type SeedName = Record<SeedLanguage, string>;

/**
 * The portfolio classification a workspace starts with: three request sources and three
 * categories, no stream. Stored in the workspace seed language; the user renames or translates
 * them like any other value.
 */
export const STARTING_PORTFOLIO_SOURCES: readonly SeedName[] = [
  { en: 'IT', fr: 'Informatique', de: 'IT', es: 'TI' },
  { en: 'Business', fr: 'Métier', de: 'Fachbereich', es: 'Negocio' },
  { en: 'Compliance', fr: 'Conformité', de: 'Compliance', es: 'Cumplimiento' },
];

export const STARTING_PORTFOLIO_CATEGORIES: readonly SeedName[] = [
  { en: 'Applications', fr: 'Applications', de: 'Anwendungen', es: 'Aplicaciones' },
  { en: 'Cybersecurity', fr: 'Cybersécurité', de: 'Cybersicherheit', es: 'Ciberseguridad' },
  { en: 'Infrastructure', fr: 'Infrastructure', de: 'Infrastruktur', es: 'Infraestructura' },
];

/** Every seeded name of a table, in the four seed languages, lower case (the empty-workspace check). */
export function startingClassificationNames(table: 'portfolio_sources' | 'portfolio_categories'): string[] {
  const names = table === 'portfolio_sources' ? STARTING_PORTFOLIO_SOURCES : STARTING_PORTFOLIO_CATEGORIES;
  return [...new Set(names.flatMap((name) => SEED_LANGUAGES.map((language) => name[language].toLowerCase())))];
}

/** Creates the starting sources and categories a workspace lacks (a value of the same name is kept). */
export async function ensureStartingPortfolioClassification(
  manager: EntityManager,
  tenantId: string,
  language: SeedLanguage,
): Promise<void> {
  for (const [table, names] of [
    ['portfolio_sources', STARTING_PORTFOLIO_SOURCES],
    ['portfolio_categories', STARTING_PORTFOLIO_CATEGORIES],
  ] as const) {
    for (const [index, name] of names.entries()) {
      await manager.query(
        `INSERT INTO ${table} (tenant_id, name, is_active, display_order, is_system)
         VALUES ($1, $2, true, $3, false)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tenantId, name[language], index + 1],
      );
    }
  }
}
