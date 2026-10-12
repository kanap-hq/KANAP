import { EntityManager } from 'typeorm';
import { DEFAULT_ANALYTICS_AXIS_CODE } from './analytics-axes.util';

/**
 * The recommended analytics dimensions (plan planning/budget-tab-redesign/plan.md, lot D): the
 * cost pool (on the default dimension), the IT tower, the purpose and the priority every new
 * tenant starts with, and the recurrence offered as an optional pack. They are ordinary
 * dimensions: enabled, optional, for OPEX and CAPEX lines (`applies_to` NULL), values included.
 * An administrator may rename, extend, disable, delete them or make one required.
 *
 * `ensureRecommendedDimensions` creates what a tenant lacks. `seedTenantDefaults` calls it with
 * the starting four (tenant creation, trial activation, reset, first start on-premise), and
 * `POST /analytics-axes/recommended` with the ones an administrator ticks on an existing tenant.
 *
 * One table per language. The tables share their keys, codes and value keys (a spec checks it).
 */

export type SeedLanguage = 'en' | 'fr' | 'de' | 'es';

export const SEED_LANGUAGES: readonly SeedLanguage[] = ['en', 'fr', 'de', 'es'];

/** The seed language of a locale (`fr-FR` gives `fr`); English for anything else. */
export function resolveSeedLanguage(raw: unknown): SeedLanguage {
  const base = String(raw ?? '').trim().toLowerCase().split(/[-_]/, 1)[0];
  return (SEED_LANGUAGES as readonly string[]).includes(base) ? (base as SeedLanguage) : 'en';
}

export type RecommendedDimensionKey = 'cost_pool' | 'it_tower' | 'purpose' | 'priority' | 'recurrence';

/** Every recommended dimension, in display order. */
export const RECOMMENDED_DIMENSION_KEYS: readonly RecommendedDimensionKey[] = ['cost_pool', 'it_tower', 'purpose', 'priority', 'recurrence'];

/** The ones a new tenant starts with (and the dialog ticks); the rest is the optional pack. */
export const STARTING_DIMENSION_KEYS: readonly RecommendedDimensionKey[] = ['cost_pool', 'it_tower', 'purpose', 'priority'];

/**
 * The code the cost pool takes when it cannot go on the default dimension (an existing tenant
 * whose default dimension already has a name or values). On the default dimension its code stays
 * `default` (DEFAULT_ANALYTICS_AXIS_CODE).
 */
export const COST_POOL_CODE = 'cost_pool';

export interface RecommendedValueSeed {
  /** Stable across languages. */
  key: string;
  name: string;
  description: string;
}

export interface RecommendedDimensionSeed {
  key: RecommendedDimensionKey;
  /** The code of a new dimension (the budget file's `analytics:<code>` column). */
  code: string;
  name: string;
  description: string;
  values: readonly RecommendedValueSeed[];
}

const EN: readonly RecommendedDimensionSeed[] = [
  {
    key: 'cost_pool',
    code: COST_POOL_CODE,
    name: 'Cost pool',
    description: 'What the money pays for. Matches the cost pools of the TBM taxonomy.',
    values: [
      { key: 'hardware', name: 'Hardware', description: 'Equipment bought or leased: servers, storage, network gear, devices.' },
      { key: 'software', name: 'Software', description: 'Licenses, subscriptions, SaaS and their maintenance.' },
      { key: 'internal_labor', name: 'Internal labor', description: 'Salaries and costs of the employees who work on IT.' },
      { key: 'external_labor', name: 'External labor', description: 'Contractors and consultants billed for their time.' },
      { key: 'outside_services', name: 'Outside services', description: 'Services bought for a result: managed services, outsourcing.' },
      { key: 'facilities_power', name: 'Facilities and power', description: 'Data center space, offices, power and cooling.' },
      { key: 'telecom', name: 'Telecom', description: 'Network links, mobile and voice subscriptions.' },
      { key: 'other', name: 'Other', description: 'Costs that fit no other pool, such as travel or training.' },
    ],
  },
  {
    key: 'it_tower',
    code: 'it_tower',
    name: 'IT tower',
    description: 'The part of IT the money serves. Matches the IT towers of the TBM taxonomy.',
    values: [
      { key: 'data_center', name: 'Data center', description: 'The rooms and facilities that host IT equipment.' },
      { key: 'compute', name: 'Compute', description: 'Servers, mainframes and virtualization.' },
      { key: 'storage', name: 'Storage', description: 'Disks, backup and archiving.' },
      { key: 'network', name: 'Network', description: 'LAN, WAN, voice and connectivity.' },
      { key: 'platform', name: 'Platform', description: 'Databases, middleware and integration.' },
      { key: 'output', name: 'Output', description: 'Printing and document output.' },
      { key: 'end_user', name: 'End user', description: 'Workstations, mobile devices and user support.' },
      { key: 'application', name: 'Application', description: 'Business applications: development, support and licenses.' },
      { key: 'delivery', name: 'Delivery', description: 'Service desk, operations and IT service management.' },
      { key: 'security_compliance', name: 'Security and compliance', description: 'Security tools, identities, audit and compliance.' },
      { key: 'it_management', name: 'IT management', description: 'Governance, planning, finance and administration of IT.' },
    ],
  },
  {
    key: 'purpose',
    code: 'purpose',
    name: 'Purpose',
    description: 'Why the money is spent, to weigh the requests against each other.',
    values: [
      { key: 'replacement', name: 'Replacement', description: 'Replaces equipment or software at the end of its life.' },
      { key: 'capacity', name: 'Capacity', description: 'Adds capacity for more users or more volume.' },
      { key: 'productivity', name: 'Productivity', description: 'Saves time or money.' },
      { key: 'security', name: 'Security', description: 'Reduces a security risk.' },
      { key: 'compliance', name: 'Compliance', description: 'Meets a legal or regulatory requirement.' },
      { key: 'business_growth', name: 'Business growth', description: 'Supports new business or more revenue.' },
      { key: 'other', name: 'Other', description: 'Any other reason.' },
    ],
  },
  {
    key: 'priority',
    code: 'priority',
    name: 'Priority',
    description: 'How urgent the spending is, to decide what to fund first.',
    values: [
      { key: 'mandatory', name: 'Mandatory', description: 'Cannot be postponed: a legal, contractual or safety reason.' },
      { key: 'high', name: 'High', description: 'To fund first.' },
      { key: 'medium', name: 'Medium', description: 'To fund if the budget allows.' },
      { key: 'low', name: 'Low', description: 'Can wait.' },
    ],
  },
  {
    key: 'recurrence',
    code: 'recurrence',
    name: 'Recurrence',
    description: 'Whether the spending comes back every year.',
    values: [
      { key: 'recurring', name: 'Recurring', description: 'Comes back every year: subscriptions, maintenance, salaries.' },
      { key: 'one_off', name: 'One-off', description: 'Happens once: a project, a purchase.' },
    ],
  },
];

const FR: readonly RecommendedDimensionSeed[] = [
  {
    key: 'cost_pool',
    code: COST_POOL_CODE,
    name: 'Nature de coût',
    description: 'Ce que la dépense paie. Correspond aux cost pools de la taxonomie TBM.',
    values: [
      { key: 'hardware', name: 'Matériel', description: 'Équipements achetés ou loués : serveurs, stockage, réseau, postes.' },
      { key: 'software', name: 'Logiciel', description: 'Licences, abonnements, SaaS et leur maintenance.' },
      { key: 'internal_labor', name: "Main-d'œuvre interne", description: "Salaires et charges des salariés qui travaillent pour l'IT." },
      { key: 'external_labor', name: "Main-d'œuvre externe", description: 'Prestataires et consultants facturés au temps passé.' },
      { key: 'outside_services', name: 'Services externes', description: 'Services achetés au résultat : infogérance, externalisation.' },
      { key: 'facilities_power', name: 'Locaux et énergie', description: 'Salles informatiques, bureaux, énergie et climatisation.' },
      { key: 'telecom', name: 'Télécoms', description: 'Liens réseau, abonnements mobiles et voix.' },
      { key: 'other', name: 'Autres', description: 'Coûts hors des autres natures, comme les déplacements ou la formation.' },
    ],
  },
  {
    key: 'it_tower',
    code: 'it_tower',
    name: 'Domaine IT',
    description: "La partie de l'IT que la dépense sert. Correspond aux towers IT de la taxonomie TBM.",
    values: [
      { key: 'data_center', name: 'Data center', description: 'Les salles et installations qui hébergent les équipements.' },
      { key: 'compute', name: 'Calcul', description: 'Serveurs, mainframes et virtualisation.' },
      { key: 'storage', name: 'Stockage', description: 'Disques, sauvegarde et archivage.' },
      { key: 'network', name: 'Réseau', description: 'LAN, WAN, voix et connectivité.' },
      { key: 'platform', name: 'Plateforme', description: 'Bases de données, middleware et intégration.' },
      { key: 'output', name: 'Impression', description: 'Impression et éditique.' },
      { key: 'end_user', name: 'Poste de travail', description: 'Postes, mobiles et support aux utilisateurs.' },
      { key: 'application', name: 'Application', description: 'Applications métier : développement, maintenance et licences.' },
      { key: 'delivery', name: 'Support et exploitation', description: 'Centre de services, exploitation et gestion des services IT.' },
      { key: 'security_compliance', name: 'Sécurité et conformité', description: 'Outils de sécurité, identités, audit et conformité.' },
      { key: 'it_management', name: 'Pilotage IT', description: "Gouvernance, planification, finance et administration de l'IT." },
    ],
  },
  {
    key: 'purpose',
    code: 'purpose',
    name: 'Motif',
    description: 'Pourquoi la dépense est engagée, pour comparer les demandes entre elles.',
    values: [
      { key: 'replacement', name: 'Remplacement', description: 'Remplace un équipement ou un logiciel en fin de vie.' },
      { key: 'capacity', name: 'Capacité', description: "Ajoute de la capacité pour plus d'utilisateurs ou de volume." },
      { key: 'productivity', name: 'Productivité', description: "Fait gagner du temps ou de l'argent." },
      { key: 'security', name: 'Sécurité', description: 'Réduit un risque de sécurité.' },
      { key: 'compliance', name: 'Conformité', description: 'Répond à une obligation légale ou réglementaire.' },
      { key: 'business_growth', name: 'Croissance', description: "Soutient une nouvelle activité ou plus de chiffre d'affaires." },
      { key: 'other', name: 'Autre', description: 'Tout autre motif.' },
    ],
  },
  {
    key: 'priority',
    code: 'priority',
    name: 'Priorité',
    description: "L'urgence de la dépense, pour décider quoi financer en premier.",
    values: [
      { key: 'mandatory', name: 'Obligatoire', description: 'Ne peut pas être reportée : raison légale, contractuelle ou de sécurité.' },
      { key: 'high', name: 'Haute', description: 'À financer en premier.' },
      { key: 'medium', name: 'Moyenne', description: 'À financer si le budget le permet.' },
      { key: 'low', name: 'Basse', description: 'Peut attendre.' },
    ],
  },
  {
    key: 'recurrence',
    code: 'recurrence',
    name: 'Récurrence',
    description: 'Si la dépense revient chaque année.',
    values: [
      { key: 'recurring', name: 'Récurrent', description: 'Revient chaque année : abonnements, maintenance, salaires.' },
      { key: 'one_off', name: 'Ponctuel', description: 'Arrive une fois : un projet, un achat.' },
    ],
  },
];

const DE: readonly RecommendedDimensionSeed[] = [
  {
    key: 'cost_pool',
    code: COST_POOL_CODE,
    name: 'Kostenart',
    description: 'Wofür das Geld ausgegeben wird. Entspricht den Cost Pools der TBM-Taxonomie.',
    values: [
      { key: 'hardware', name: 'Hardware', description: 'Gekaufte oder geleaste Geräte: Server, Speicher, Netzwerk, Endgeräte.' },
      { key: 'software', name: 'Software', description: 'Lizenzen, Abonnements, SaaS und deren Wartung.' },
      { key: 'internal_labor', name: 'Internes Personal', description: 'Gehälter und Kosten der Mitarbeitenden, die für die IT arbeiten.' },
      { key: 'external_labor', name: 'Externes Personal', description: 'Dienstleister und Berater, die nach Aufwand abrechnen.' },
      { key: 'outside_services', name: 'Externe Dienstleistungen', description: 'Ergebnisbezogen eingekaufte Leistungen: Managed Services, Outsourcing.' },
      { key: 'facilities_power', name: 'Gebäude und Energie', description: 'Rechenzentrumsflächen, Büros, Strom und Kühlung.' },
      { key: 'telecom', name: 'Telekommunikation', description: 'Netzwerkleitungen, Mobilfunk- und Sprachverträge.' },
      { key: 'other', name: 'Sonstiges', description: 'Kosten, die zu keiner anderen Art passen, etwa Reisen oder Schulungen.' },
    ],
  },
  {
    key: 'it_tower',
    code: 'it_tower',
    name: 'IT-Bereich',
    description: 'Der Teil der IT, dem die Ausgabe dient. Entspricht den IT Towers der TBM-Taxonomie.',
    values: [
      { key: 'data_center', name: 'Rechenzentrum', description: 'Räume und Anlagen, in denen die IT-Geräte stehen.' },
      { key: 'compute', name: 'Rechenleistung', description: 'Server, Mainframes und Virtualisierung.' },
      { key: 'storage', name: 'Speicher', description: 'Festplatten, Sicherung und Archivierung.' },
      { key: 'network', name: 'Netzwerk', description: 'LAN, WAN, Sprache und Konnektivität.' },
      { key: 'platform', name: 'Plattform', description: 'Datenbanken, Middleware und Integration.' },
      { key: 'output', name: 'Druck', description: 'Drucken und Dokumentenausgabe.' },
      { key: 'end_user', name: 'Arbeitsplatz', description: 'Arbeitsplatzrechner, Mobilgeräte und Benutzerunterstützung.' },
      { key: 'application', name: 'Anwendung', description: 'Fachanwendungen: Entwicklung, Wartung und Lizenzen.' },
      { key: 'delivery', name: 'Betrieb und Support', description: 'Service-Desk, Betrieb und IT-Service-Management.' },
      { key: 'security_compliance', name: 'Sicherheit und Compliance', description: 'Sicherheitswerkzeuge, Identitäten, Audit und Compliance.' },
      { key: 'it_management', name: 'IT-Management', description: 'Steuerung, Planung, Finanzen und Verwaltung der IT.' },
    ],
  },
  {
    key: 'purpose',
    code: 'purpose',
    name: 'Zweck',
    description: 'Warum das Geld ausgegeben wird, um Anträge gegeneinander abzuwägen.',
    values: [
      { key: 'replacement', name: 'Ersatz', description: 'Ersetzt Geräte oder Software am Ende ihrer Lebensdauer.' },
      { key: 'capacity', name: 'Kapazität', description: 'Schafft Kapazität für mehr Benutzer oder mehr Volumen.' },
      { key: 'productivity', name: 'Produktivität', description: 'Spart Zeit oder Geld.' },
      { key: 'security', name: 'Sicherheit', description: 'Verringert ein Sicherheitsrisiko.' },
      { key: 'compliance', name: 'Compliance', description: 'Erfüllt eine gesetzliche oder regulatorische Pflicht.' },
      { key: 'business_growth', name: 'Wachstum', description: 'Unterstützt neues Geschäft oder mehr Umsatz.' },
      { key: 'other', name: 'Sonstiges', description: 'Jeder andere Grund.' },
    ],
  },
  {
    key: 'priority',
    code: 'priority',
    name: 'Priorität',
    description: 'Wie dringend die Ausgabe ist, um zu entscheiden, was zuerst finanziert wird.',
    values: [
      { key: 'mandatory', name: 'Zwingend', description: 'Nicht verschiebbar: rechtlicher, vertraglicher oder sicherheitsbezogener Grund.' },
      { key: 'high', name: 'Hoch', description: 'Zuerst zu finanzieren.' },
      { key: 'medium', name: 'Mittel', description: 'Zu finanzieren, wenn das Budget es zulässt.' },
      { key: 'low', name: 'Niedrig', description: 'Kann warten.' },
    ],
  },
  {
    key: 'recurrence',
    code: 'recurrence',
    name: 'Wiederkehr',
    description: 'Ob die Ausgabe jedes Jahr wiederkommt.',
    values: [
      { key: 'recurring', name: 'Wiederkehrend', description: 'Kommt jedes Jahr wieder: Abonnements, Wartung, Gehälter.' },
      { key: 'one_off', name: 'Einmalig', description: 'Fällt einmal an: ein Projekt, ein Kauf.' },
    ],
  },
];

const ES: readonly RecommendedDimensionSeed[] = [
  {
    key: 'cost_pool',
    code: COST_POOL_CODE,
    name: 'Tipo de coste',
    description: 'Lo que paga el gasto. Corresponde a los cost pools de la taxonomía TBM.',
    values: [
      { key: 'hardware', name: 'Hardware', description: 'Equipos comprados o alquilados: servidores, almacenamiento, red, dispositivos.' },
      { key: 'software', name: 'Software', description: 'Licencias, suscripciones, SaaS y su mantenimiento.' },
      { key: 'internal_labor', name: 'Personal interno', description: 'Salarios y cargas de los empleados que trabajan para TI.' },
      { key: 'external_labor', name: 'Personal externo', description: 'Proveedores y consultores facturados por tiempo.' },
      { key: 'outside_services', name: 'Servicios externos', description: 'Servicios comprados por resultado: servicios gestionados, externalización.' },
      { key: 'facilities_power', name: 'Instalaciones y energía', description: 'Salas de servidores, oficinas, energía y refrigeración.' },
      { key: 'telecom', name: 'Telecomunicaciones', description: 'Enlaces de red, líneas móviles y de voz.' },
      { key: 'other', name: 'Otros', description: 'Costes que no encajan en otro tipo, como viajes o formación.' },
    ],
  },
  {
    key: 'it_tower',
    code: 'it_tower',
    name: 'Dominio TI',
    description: 'La parte de TI a la que sirve el gasto. Corresponde a las IT towers de la taxonomía TBM.',
    values: [
      { key: 'data_center', name: 'Centro de datos', description: 'Las salas e instalaciones que alojan los equipos de TI.' },
      { key: 'compute', name: 'Cómputo', description: 'Servidores, mainframes y virtualización.' },
      { key: 'storage', name: 'Almacenamiento', description: 'Discos, copias de seguridad y archivo.' },
      { key: 'network', name: 'Red', description: 'LAN, WAN, voz y conectividad.' },
      { key: 'platform', name: 'Plataforma', description: 'Bases de datos, middleware e integración.' },
      { key: 'output', name: 'Impresión', description: 'Impresión y salida de documentos.' },
      { key: 'end_user', name: 'Puesto de trabajo', description: 'Equipos de usuario, móviles y soporte a los usuarios.' },
      { key: 'application', name: 'Aplicación', description: 'Aplicaciones de negocio: desarrollo, mantenimiento y licencias.' },
      { key: 'delivery', name: 'Soporte y operación', description: 'Centro de servicios, operación y gestión de servicios de TI.' },
      { key: 'security_compliance', name: 'Seguridad y conformidad', description: 'Herramientas de seguridad, identidades, auditoría y conformidad.' },
      { key: 'it_management', name: 'Gestión de TI', description: 'Gobierno, planificación, finanzas y administración de TI.' },
    ],
  },
  {
    key: 'purpose',
    code: 'purpose',
    name: 'Motivo',
    description: 'Por qué se gasta el dinero, para comparar las solicitudes entre sí.',
    values: [
      { key: 'replacement', name: 'Sustitución', description: 'Sustituye equipos o software al final de su vida útil.' },
      { key: 'capacity', name: 'Capacidad', description: 'Añade capacidad para más usuarios o más volumen.' },
      { key: 'productivity', name: 'Productividad', description: 'Ahorra tiempo o dinero.' },
      { key: 'security', name: 'Seguridad', description: 'Reduce un riesgo de seguridad.' },
      { key: 'compliance', name: 'Conformidad', description: 'Cumple una obligación legal o reglamentaria.' },
      { key: 'business_growth', name: 'Crecimiento', description: 'Apoya un nuevo negocio o más ingresos.' },
      { key: 'other', name: 'Otro', description: 'Cualquier otro motivo.' },
    ],
  },
  {
    key: 'priority',
    code: 'priority',
    name: 'Prioridad',
    description: 'La urgencia del gasto, para decidir qué financiar primero.',
    values: [
      { key: 'mandatory', name: 'Obligatoria', description: 'No se puede aplazar: motivo legal, contractual o de seguridad.' },
      { key: 'high', name: 'Alta', description: 'A financiar primero.' },
      { key: 'medium', name: 'Media', description: 'A financiar si el presupuesto lo permite.' },
      { key: 'low', name: 'Baja', description: 'Puede esperar.' },
    ],
  },
  {
    key: 'recurrence',
    code: 'recurrence',
    name: 'Recurrencia',
    description: 'Si el gasto se repite cada año.',
    values: [
      { key: 'recurring', name: 'Recurrente', description: 'Se repite cada año: suscripciones, mantenimiento, salarios.' },
      { key: 'one_off', name: 'Puntual', description: 'Ocurre una vez: un proyecto, una compra.' },
    ],
  },
];

/** The table of each language. */
export const RECOMMENDED_DIMENSIONS: Readonly<Record<SeedLanguage, readonly RecommendedDimensionSeed[]>> = {
  en: EN,
  fr: FR,
  de: DE,
  es: ES,
};

/** The table in one language. */
export function recommendedDimensionTable(language: SeedLanguage = 'en'): readonly RecommendedDimensionSeed[] {
  return RECOMMENDED_DIMENSIONS[language] ?? RECOMMENDED_DIMENSIONS.en;
}

/** The cost pool's name in every language: a default dimension of one of these names is the cost pool. */
export function costPoolNames(): string[] {
  return SEED_LANGUAGES.map((language) => RECOMMENDED_DIMENSIONS[language].find((seed) => seed.key === 'cost_pool')!.name);
}

/** The names a new dimension tries, in order, while another dimension of the tenant holds one: `X`, `X (2)`, `X (3)`… */
export function recommendedDimensionNameCandidate(name: string, attempt: number): string {
  return attempt === 0 ? name : `${name} (${attempt + 1})`;
}

/**
 * The statements of the seed. Every one names its tenant (`$1`) besides row level security.
 * Positions never overflow an int (`LEAST`).
 */
export const RECOMMENDED_DIMENSION_SQL = {
  /** Serialises two runs for one tenant (two clicks, a click during a reset). */
  lock: `SELECT pg_advisory_xact_lock(hashtext('analytics_recommended_dimensions'), hashtext($1::text))`,
  /** The tenant's dimension of a code (unique per tenant, case-insensitive). */
  findAxis: `SELECT id::text AS id, code, name FROM analytics_axes WHERE tenant_id = $1 AND lower(code) = lower($2)`,
  /** The default dimension, locked, with its number of values. */
  lockDefault: `SELECT a.id::text AS id, a.code, a.name, a.description,
            (SELECT count(*)::int FROM analytics_categories c WHERE c.tenant_id = $1 AND c.axis_id = a.id) AS value_count
       FROM analytics_axes a
      WHERE a.tenant_id = $1 AND a.is_default
      FOR UPDATE OF a`,
  /** Whether another dimension of the tenant already has the name (unique per tenant, case-insensitive). */
  nameTaken: `SELECT EXISTS (
       SELECT 1 FROM analytics_axes WHERE tenant_id = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid)
     ) AS taken`,
  /** Names the default dimension. */
  nameDefault: `UPDATE analytics_axes SET name = $3, description = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2::uuid AND is_default`,
  /** A new dimension after the tenant's last one: for OPEX and CAPEX lines, optional, enabled. */
  insertAxis: `INSERT INTO analytics_axes (tenant_id, code, name, description, sort_order, applies_to, required, status)
     SELECT $1, $2, $3, $4, LEAST(coalesce(max(a.sort_order), 0)::bigint + 1, 2147483647)::int, NULL, false, 'enabled'
       FROM analytics_axes a
      WHERE a.tenant_id = $1
     ON CONFLICT DO NOTHING
     RETURNING id::text AS id`,
  /** A value of a dimension the seed has just created or named, at its position, for OPEX and CAPEX lines. */
  insertValue: `INSERT INTO analytics_categories (tenant_id, axis_id, name, description, sort_order, status)
     VALUES ($1, $2::uuid, $3, $4, $5, 'enabled')
     ON CONFLICT DO NOTHING
     RETURNING id::text AS id`,
} as const;

/** What the seed did for one recommended dimension of a tenant. */
export interface RecommendedDimensionOutcome {
  key: RecommendedDimensionKey;
  /** The code of the dimension it found or created (`default` when the cost pool is on the default dimension). */
  code: string;
  axisId: string;
  name: string | null;
  /** True when this run created the dimension, or named and filled the default dimension. */
  created: boolean;
  /** Set when this run named the default dimension: its name and description before. */
  defaultBefore: { name: string | null; description: string | null } | null;
  valueIds: string[];
}

type Query = (sql: string, params: unknown[]) => Promise<any[]>;

/**
 * The dimension of the tenant that already stands for a recommended dimension, or null. The cost
 * pool is the dimension of code `cost_pool`, or the default dimension when its name is the cost
 * pool's in one of the four languages (the seed named it). The others go by their code.
 */
async function findPresent(
  query: Query,
  tenantId: string,
  seed: RecommendedDimensionSeed,
): Promise<{ id: string; code: string; name: string | null } | null> {
  const [byCode] = await query(RECOMMENDED_DIMENSION_SQL.findAxis, [tenantId, seed.code]);
  if (byCode) return byCode;
  if (seed.key !== 'cost_pool') return null;
  const [found] = await query(
    `SELECT id::text AS id, code, name FROM analytics_axes
      WHERE tenant_id = $1 AND is_default AND lower(coalesce(name, '')) = ANY($2::text[])`,
    [tenantId, costPoolNames().map((name) => name.toLowerCase())],
  );
  return found ?? null;
}

/** Each recommended dimension and the dimension of the tenant that stands for it, if any. */
export async function findRecommendedDimensions(
  manager: EntityManager,
  tenantId: string,
): Promise<Array<{ key: RecommendedDimensionKey; axis: { id: string; code: string; name: string | null } | null }>> {
  const query: Query = (sql, params) => manager.query(sql, params);
  const result = [];
  for (const seed of recommendedDimensionTable('en')) {
    result.push({ key: seed.key, axis: await findPresent(query, tenantId, seed) });
  }
  return result;
}

async function freeName(query: Query, tenantId: string, name: string, ownId: string | null): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = recommendedDimensionNameCandidate(name, attempt);
    const [{ taken }] = await query(RECOMMENDED_DIMENSION_SQL.nameTaken, [tenantId, candidate, ownId]);
    if (!taken) return candidate;
  }
}

async function insertValues(query: Query, tenantId: string, axisId: string, seed: RecommendedDimensionSeed): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, value] of seed.values.entries()) {
    const rows = await query(RECOMMENDED_DIMENSION_SQL.insertValue, [tenantId, axisId, value.name, value.description, index + 1]);
    ids.push(...rows.map((row: { id: string }) => row.id));
  }
  return ids;
}

/**
 * Creates the recommended dimensions of `keys` the tenant lacks, in `language`, in the table's
 * order. A dimension already there (`findPresent`) is left exactly as it is, values included.
 * The cost pool goes on the default dimension when it has neither a name nor a value; otherwise
 * it is created as an ordinary dimension of code `cost_pool`. A name another dimension holds gets
 * " (2)", " (3)"… Idempotent. Runs in the caller's transaction, with `app.current_tenant` set to
 * the tenant (the value trigger writes the search index under row level security). Writes no
 * audit entry: the caller does when a person asked for it.
 */
export async function ensureRecommendedDimensions(
  manager: EntityManager,
  tenantId: string,
  language: SeedLanguage = 'en',
  keys: readonly RecommendedDimensionKey[] = STARTING_DIMENSION_KEYS,
): Promise<RecommendedDimensionOutcome[]> {
  const query: Query = (sql, params) => manager.query(sql, params);
  await query(RECOMMENDED_DIMENSION_SQL.lock, [tenantId]);
  const wanted = new Set(keys);
  const outcomes: RecommendedDimensionOutcome[] = [];
  for (const seed of recommendedDimensionTable(language)) {
    if (!wanted.has(seed.key)) continue;
    const present = await findPresent(query, tenantId, seed);
    if (present) {
      outcomes.push({ key: seed.key, code: present.code, axisId: present.id, name: present.name ?? null, created: false, defaultBefore: null, valueIds: [] });
      continue;
    }
    if (seed.key === 'cost_pool') {
      const [fallback] = await query(RECOMMENDED_DIMENSION_SQL.lockDefault, [tenantId]);
      if (fallback && !fallback.name && Number(fallback.value_count) === 0) {
        const name = await freeName(query, tenantId, seed.name, fallback.id);
        await query(RECOMMENDED_DIMENSION_SQL.nameDefault, [tenantId, fallback.id, name, seed.description]);
        outcomes.push({
          key: seed.key,
          code: DEFAULT_ANALYTICS_AXIS_CODE,
          axisId: fallback.id,
          name,
          created: true,
          defaultBefore: { name: fallback.name ?? null, description: fallback.description ?? null },
          valueIds: await insertValues(query, tenantId, fallback.id, seed),
        });
        continue;
      }
    }
    const name = await freeName(query, tenantId, seed.name, null);
    const [inserted] = await query(RECOMMENDED_DIMENSION_SQL.insertAxis, [tenantId, seed.code, name, seed.description]);
    if (!inserted) throw new Error(`The ${seed.code} dimension could not be created.`);
    outcomes.push({
      key: seed.key,
      code: seed.code,
      axisId: inserted.id,
      name,
      created: true,
      defaultBefore: null,
      valueIds: await insertValues(query, tenantId, inserted.id, seed),
    });
  }
  return outcomes;
}
