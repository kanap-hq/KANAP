import type { PermissionLevel, Resource } from '../permissions/permissions.service';
import { AI_SCREEN_LANGUAGES, type AiScreenLanguage } from './ai-unread-families';

/**
 * The words of Admin › Roles for the rights and their levels, copied from
 * `frontend/src/locales/<lang>/admin.json` (`roles.resources.*`, `roles.levels.*`; a spec compares
 * them). The results of `roles` and `role_permissions` carry them next to the codes, in the
 * person's language, so that an answer names a right as the screen does and never invents a name.
 */

/**
 * The rights the screen shows. `projects`, a right of before the portfolio rights, has no line on
 * the screen and no word: its label is null.
 */
export type AiScreenResource = Exclude<Resource, 'projects'>;

/** Each right as the Roles screen names it (`roles.resources.<code>`). */
export const AI_RESOURCE_LABELS: Record<AiScreenLanguage, Record<AiScreenResource, string>> = {
  en: {
    budget: 'Budget', contracts: 'Contracts', applications: 'Applications', infrastructure: 'Infrastructure',
    tasks: 'Tasks', suppliers: 'Suppliers', contacts: 'Contacts', companies: 'Companies',
    departments: 'Departments', cost_centers: 'Cost centers', working_day_profiles: 'Working-day calendars',
    accounts: 'Accounts', analytics: 'Analytics', business_processes: 'Business processes',
    knowledge: 'Knowledge', users: 'Users', reporting: 'Reporting', settings: 'Settings',
    budget_ops: 'Budget ops', billing: 'Billing', locations: 'Locations', incidents: 'Incidents',
    portfolio_requests: 'Portfolio requests', portfolio_projects: 'Portfolio projects',
    portfolio_planning: 'Portfolio planning', portfolio_reports: 'Portfolio reports',
    portfolio_settings: 'Portfolio settings', ai_chat: 'AI chat', ai_mcp: 'AI MCP', ai_agents: 'AI agents',
    ai_settings: 'AI settings',
  },
  fr: {
    budget: 'Budget', contracts: 'Contrats', applications: 'Applications', infrastructure: 'Infrastructure',
    tasks: 'Tâches', suppliers: 'Fournisseurs', contacts: 'Contacts', companies: 'Sociétés',
    departments: 'Départements', cost_centers: 'Centres de coûts',
    working_day_profiles: 'Calendriers de jours ouvrés', accounts: 'Comptes', analytics: 'Analytique',
    business_processes: 'Processus métier', knowledge: 'Base de connaissances', users: 'Utilisateurs',
    reporting: 'Reporting', settings: 'Paramètres', budget_ops: 'Opérations budgétaires',
    billing: 'Facturation', locations: 'Sites', incidents: 'Incidents',
    portfolio_requests: 'Demandes du portefeuille', portfolio_projects: 'Projets du portefeuille',
    portfolio_planning: 'Planification du portefeuille', portfolio_reports: 'Rapports du portefeuille',
    portfolio_settings: 'Paramètres du portefeuille', ai_chat: 'Chat IA', ai_mcp: 'MCP IA',
    ai_agents: 'Agents IA', ai_settings: 'Paramètres IA',
  },
  de: {
    budget: 'Budget', contracts: 'Verträge', applications: 'Anwendungen', infrastructure: 'Infrastruktur',
    tasks: 'Aufgaben', suppliers: 'Lieferanten', contacts: 'Kontakte', companies: 'Unternehmen',
    departments: 'Abteilungen', cost_centers: 'Kostenstellen', working_day_profiles: 'Arbeitstagekalender',
    accounts: 'Konten', analytics: 'Analytik', business_processes: 'Geschäftsprozesse',
    knowledge: 'Wissensdatenbank', users: 'Benutzer', reporting: 'Berichtswesen', settings: 'Einstellungen',
    budget_ops: 'Budget-Operationen', billing: 'Abrechnung', locations: 'Standorte', incidents: 'Vorfälle',
    portfolio_requests: 'Portfolioanfragen', portfolio_projects: 'Portfolioprojekte',
    portfolio_planning: 'Portfolioplanung', portfolio_reports: 'Portfolioberichte',
    portfolio_settings: 'Portfolioeinstellungen', ai_chat: 'KI-Chat', ai_mcp: 'KI MCP',
    ai_agents: 'KI-Agenten', ai_settings: 'KI-Einstellungen',
  },
  es: {
    budget: 'Presupuesto', contracts: 'Contratos', applications: 'Aplicaciones',
    infrastructure: 'Infraestructura', tasks: 'Tareas', suppliers: 'Proveedores', contacts: 'Contactos',
    companies: 'Empresas', departments: 'Departamentos', cost_centers: 'Centros de coste',
    working_day_profiles: 'Calendarios laborales', accounts: 'Cuentas', analytics: 'Analítica',
    business_processes: 'Procesos de negocio', knowledge: 'Base de conocimiento', users: 'Usuarios',
    reporting: 'Informes', settings: 'Configuración', budget_ops: 'Operaciones presupuestarias',
    billing: 'Facturación', locations: 'Ubicaciones', incidents: 'Incidentes',
    portfolio_requests: 'Solicitudes de portafolio', portfolio_projects: 'Proyectos de portafolio',
    portfolio_planning: 'Planificación de portafolio', portfolio_reports: 'Informes de portafolio',
    portfolio_settings: 'Configuración de portafolio', ai_chat: 'Chat IA', ai_mcp: 'MCP IA',
    ai_agents: 'Agentes IA', ai_settings: 'Configuración IA',
  },
};

/** Each level as the Roles screen names it (`roles.levels.<level>`). */
export const AI_PERMISSION_LEVEL_LABELS: Record<AiScreenLanguage, Record<PermissionLevel, string>> = {
  en: {
    reader: 'Reader', contributor: 'Contributor', member: 'Member', admin: 'Admin',
  },
  fr: {
    reader: 'Lecteur', contributor: 'Contributeur', member: 'Membre', admin: 'Administrateur',
  },
  de: {
    reader: 'Leser', contributor: 'Mitwirkender', member: 'Mitglied', admin: 'Administrator',
  },
  es: {
    reader: 'Lector', contributor: 'Colaborador', member: 'Miembro', admin: 'Administrador',
  },
};

/** A word in the person's language, or in the four languages (`en: …; fr: …`) when it is not known. */
function inLanguages<K extends string>(
  labels: Record<AiScreenLanguage, Record<K, string>>,
  key: K,
  language: AiScreenLanguage | null,
): string {
  if (language) return labels[language][key];
  return AI_SCREEN_LANGUAGES.map((code) => `${code}: ${labels[code][key]}`).join('; ');
}

/** A right as the Roles screen names it ("Budget", "Projets du portefeuille"); null for a right it does not show. */
export function aiResourceLabel(resource: Resource, language: AiScreenLanguage | null): string | null {
  if (!Object.prototype.hasOwnProperty.call(AI_RESOURCE_LABELS.en, resource)) return null;
  return inLanguages(AI_RESOURCE_LABELS, resource as AiScreenResource, language);
}

/** A level as the Roles screen names it: "Reader", "Lecteur". */
export function aiPermissionLevelLabel(level: PermissionLevel, language: AiScreenLanguage | null): string {
  return inLanguages(AI_PERMISSION_LEVEL_LABELS, level, language);
}
