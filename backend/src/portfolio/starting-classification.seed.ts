import { EntityManager } from 'typeorm';
import { SEED_LANGUAGES, SeedLanguage } from '../analytics/recommended-dimensions.seed';

type SeedText = Record<SeedLanguage, string>;
type SeedValue = { name: SeedText; description: SeedText };

/**
 * The portfolio classification a workspace starts with: three request sources and five
 * categories, no stream (the user creates their own). Stored in the workspace seed language as
 * ordinary values: the user renames, translates or deletes them like any other.
 */
export const STARTING_PORTFOLIO_SOURCES: readonly SeedValue[] = [
  {
    name: { en: 'IT', fr: 'Informatique', de: 'IT', es: 'TI' },
    description: { en: 'Internal IT initiative', fr: 'Initiative informatique interne', de: 'Interne IT-Initiative', es: 'Iniciativa interna de TI' },
  },
  {
    name: { en: 'Business', fr: 'Métier', de: 'Fachbereich', es: 'Negocio' },
    description: { en: 'Business-driven request', fr: 'Demande portée par les métiers', de: 'Anfrage aus dem Fachbereich', es: 'Solicitud impulsada por el negocio' },
  },
  {
    name: { en: 'Compliance', fr: 'Conformité', de: 'Compliance', es: 'Cumplimiento' },
    description: {
      en: 'Regulatory or compliance requirement',
      fr: 'Exigence réglementaire ou de conformité',
      de: 'Regulatorische oder Compliance-Anforderung',
      es: 'Requisito normativo o de cumplimiento',
    },
  },
];

export const STARTING_PORTFOLIO_CATEGORIES: readonly SeedValue[] = [
  {
    name: { en: 'Business Applications', fr: 'Applications métier', de: 'Geschäftsanwendungen', es: 'Aplicaciones de negocio' },
    description: { en: 'ERP, CRM, and business software systems', fr: 'ERP, CRM et logiciels métier', de: 'ERP, CRM und Geschäftssoftware', es: 'ERP, CRM y software de negocio' },
  },
  {
    name: {
      en: 'End-user Computing & Services',
      fr: 'Poste de travail et services aux utilisateurs',
      de: 'Arbeitsplatz und Anwenderservices',
      es: 'Puesto de trabajo y servicios al usuario',
    },
    description: {
      en: 'Workplace, devices, and end-user support',
      fr: 'Environnement de travail, équipements et support aux utilisateurs',
      de: 'Arbeitsplatz, Geräte und Anwendersupport',
      es: 'Entorno de trabajo, dispositivos y soporte al usuario',
    },
  },
  {
    name: { en: 'Infrastructure & Operations', fr: 'Infrastructure et exploitation', de: 'Infrastruktur und Betrieb', es: 'Infraestructura y operaciones' },
    description: {
      en: 'Network, servers, cloud, and data center',
      fr: 'Réseau, serveurs, cloud et centre de données',
      de: 'Netzwerk, Server, Cloud und Rechenzentrum',
      es: 'Red, servidores, nube y centro de datos',
    },
  },
  {
    name: {
      en: 'Innovation & Digital Transformation',
      fr: 'Innovation et transformation numérique',
      de: 'Innovation und digitale Transformation',
      es: 'Innovación y transformación digital',
    },
    description: {
      en: 'New technologies, analytics, and digital initiatives',
      fr: 'Nouvelles technologies, analyse de données et initiatives numériques',
      de: 'Neue Technologien, Analytik und digitale Initiativen',
      es: 'Nuevas tecnologías, analítica e iniciativas digitales',
    },
  },
  {
    name: { en: 'Cybersecurity', fr: 'Cybersécurité', de: 'Cybersicherheit', es: 'Ciberseguridad' },
    description: {
      en: 'Protection of systems, identities, and data',
      fr: 'Protection des systèmes, des identités et des données',
      de: 'Schutz von Systemen, Identitäten und Daten',
      es: 'Protección de sistemas, identidades y datos',
    },
  },
];

/** Every seeded name of a table, in the four seed languages, lower case (the empty-workspace check). */
export function startingClassificationNames(table: 'portfolio_sources' | 'portfolio_categories'): string[] {
  const values = table === 'portfolio_sources' ? STARTING_PORTFOLIO_SOURCES : STARTING_PORTFOLIO_CATEGORIES;
  return [...new Set(values.flatMap((value) => SEED_LANGUAGES.map((language) => value.name[language].toLowerCase())))];
}

/**
 * Creates the starting sources and categories a workspace lacks (a value of the same name is
 * kept), as ordinary values (`is_system` false: renamed or deleted like any other).
 */
export async function ensureStartingPortfolioClassification(
  manager: EntityManager,
  tenantId: string,
  language: SeedLanguage,
): Promise<void> {
  for (const [table, values] of [
    ['portfolio_sources', STARTING_PORTFOLIO_SOURCES],
    ['portfolio_categories', STARTING_PORTFOLIO_CATEGORIES],
  ] as const) {
    for (const [index, value] of values.entries()) {
      await manager.query(
        `INSERT INTO ${table} (tenant_id, name, description, is_active, display_order, is_system)
         VALUES ($1, $2, $3, true, $4, false)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tenantId, value.name[language], value.description[language], index + 1],
      );
    }
  }
}
