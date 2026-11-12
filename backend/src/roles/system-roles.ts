import { BadRequestException } from '@nestjs/common';

/**
 * The two system roles, Administrator and Contact. Their names are reserved: a system role cannot be
 * renamed, and no other role takes the name of one of them, whatever its case or surrounding spaces.
 */
export const SYSTEM_ROLE_KEYS = ['administrator', 'contact'] as const;

/** A role name as the reserved names compare it: trimmed, in lower case. */
export function roleNameKey(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase();
}

/** Whether `name` is, whatever its case or surrounding spaces, the name of a system role. */
export function isSystemRoleName(name: string | null | undefined): boolean {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(roleNameKey(name));
}

/**
 * The Administrator role, recognised by its name as `PermissionGuard` and the other checks
 * recognise it: the name is reserved (see above), so only the system role carries it.
 */
export function isAdministratorRole(role: { role_name?: string | null } | null | undefined): boolean {
  return roleNameKey(role?.role_name) === 'administrator';
}

/**
 * The names the screen shows for the system and built-in roles, in each language: a copy of
 * `roles.builtIn.<slug>.name` in `frontend/src/locales/<lang>/admin.json` (`roleLabel` shows a
 * shipped role by these words). The English names are the stored names. Checked against the
 * locale files by `roles/__tests__/shipped-role-names.spec.ts`.
 */
export const SHIPPED_ROLE_NAMES: Record<'en' | 'fr' | 'de' | 'es', Record<string, string>> = {
  en: {
    administrator: 'Administrator',
    agentAdmin: 'Agent Admin',
    agentContributor: 'Agent Contributor',
    agentReader: 'Agent Reader',
    aiAdministrator: 'AI Administrator',
    aiChatOperator: 'AI Chat Operator',
    aiChatUser: 'AI Chat User',
    aiMcpUser: 'AI MCP User',
    budgetAdministrator: 'Budget Administrator',
    budgetMember: 'Budget Member',
    budgetReader: 'Budget Reader',
    businessContributor: 'Business Contributor',
    contact: 'Contact',
    itLandscapeAdministrator: 'IT Landscape Administrator',
    itLandscapeMember: 'IT Landscape Member',
    itLandscapeReader: 'IT Landscape Reader',
    knowledgeAdministrator: 'Knowledge Administrator',
    knowledgeMember: 'Knowledge Member',
    knowledgeReader: 'Knowledge Reader',
    masterDataAdministrator: 'Master Data Administrator',
    masterDataMember: 'Master Data Member',
    masterDataReader: 'Master Data Reader',
    portfolioAdministrator: 'Portfolio Administrator',
    portfolioMember: 'Portfolio Member',
    portfolioReader: 'Portfolio Reader',
    tasksAdministrator: 'Tasks Administrator',
    tasksMember: 'Tasks Member',
    tasksReader: 'Tasks Reader',
  },
  fr: {
    administrator: 'Administrateur',
    agentAdmin: 'Administrateur des Agents IA',
    agentContributor: 'Contributeur des Agents IA',
    agentReader: 'Lecteur des Agents IA',
    aiAdministrator: 'Administrateur IA',
    aiChatOperator: 'Opérateur du chat IA',
    aiChatUser: 'Utilisateur du chat IA',
    aiMcpUser: 'Utilisateur MCP IA',
    budgetAdministrator: 'Administrateur budget',
    budgetMember: 'Membre budget',
    budgetReader: 'Lecteur budget',
    businessContributor: 'Contributeur métier',
    contact: 'Contact',
    itLandscapeAdministrator: 'Administrateur Cartographie SI',
    itLandscapeMember: 'Membre Cartographie SI',
    itLandscapeReader: 'Lecteur Cartographie SI',
    knowledgeAdministrator: 'Administrateur base de connaissances',
    knowledgeMember: 'Membre base de connaissances',
    knowledgeReader: 'Lecteur base de connaissances',
    masterDataAdministrator: 'Administrateur données de référence',
    masterDataMember: 'Membre données de référence',
    masterDataReader: 'Lecteur données de référence',
    portfolioAdministrator: 'Administrateur portefeuille',
    portfolioMember: 'Membre portefeuille',
    portfolioReader: 'Lecteur portefeuille',
    tasksAdministrator: 'Administrateur tâches',
    tasksMember: 'Membre tâches',
    tasksReader: 'Lecteur tâches',
  },
  de: {
    administrator: 'Administrator',
    agentAdmin: 'KI-Agenten-Administrator',
    agentContributor: 'KI-Agenten-Mitwirkender',
    agentReader: 'KI-Agenten-Leser',
    aiAdministrator: 'KI-Administrator',
    aiChatOperator: 'KI-Chat-Operator',
    aiChatUser: 'KI-Chat-Benutzer',
    aiMcpUser: 'KI-MCP-Benutzer',
    budgetAdministrator: 'Budget-Administrator',
    budgetMember: 'Budget-Mitglied',
    budgetReader: 'Budget-Leser',
    businessContributor: 'Fachbereichs-Mitwirkender',
    contact: 'Kontakt',
    itLandscapeAdministrator: 'IT-Landschaft-Administrator',
    itLandscapeMember: 'IT-Landschaft-Mitglied',
    itLandscapeReader: 'IT-Landschaft-Leser',
    knowledgeAdministrator: 'Wissensdatenbank-Administrator',
    knowledgeMember: 'Wissensdatenbank-Mitglied',
    knowledgeReader: 'Wissensdatenbank-Leser',
    masterDataAdministrator: 'Stammdaten-Administrator',
    masterDataMember: 'Stammdaten-Mitglied',
    masterDataReader: 'Stammdaten-Leser',
    portfolioAdministrator: 'Portfolio-Administrator',
    portfolioMember: 'Portfolio-Mitglied',
    portfolioReader: 'Portfolio-Leser',
    tasksAdministrator: 'Aufgaben-Administrator',
    tasksMember: 'Aufgaben-Mitglied',
    tasksReader: 'Aufgaben-Leser',
  },
  es: {
    administrator: 'Administrador',
    agentAdmin: 'Administrador de Agentes IA',
    agentContributor: 'Colaborador de Agentes IA',
    agentReader: 'Lector de Agentes IA',
    aiAdministrator: 'Administrador IA',
    aiChatOperator: 'Operador de chat IA',
    aiChatUser: 'Usuario de chat IA',
    aiMcpUser: 'Usuario de MCP IA',
    budgetAdministrator: 'Administrador de presupuesto',
    budgetMember: 'Miembro de presupuesto',
    budgetReader: 'Lector de presupuesto',
    businessContributor: 'Colaborador de negocio',
    contact: 'Contacto',
    itLandscapeAdministrator: 'Administrador de panorama IT',
    itLandscapeMember: 'Miembro de panorama IT',
    itLandscapeReader: 'Lector de panorama IT',
    knowledgeAdministrator: 'Administrador de base de conocimiento',
    knowledgeMember: 'Miembro de base de conocimiento',
    knowledgeReader: 'Lector de base de conocimiento',
    masterDataAdministrator: 'Administrador de datos maestros',
    masterDataMember: 'Miembro de datos maestros',
    masterDataReader: 'Lector de datos maestros',
    portfolioAdministrator: 'Administrador de portafolio',
    portfolioMember: 'Miembro de portafolio',
    portfolioReader: 'Lector de portafolio',
    tasksAdministrator: 'Administrador de tareas',
    tasksMember: 'Miembro de tareas',
    tasksReader: 'Lector de tareas',
  },
};

const RESERVED_ROLE_NAME_KEYS = new Set(
  Object.values(SHIPPED_ROLE_NAMES).flatMap((names) => Object.values(names).map((name) => roleNameKey(name))),
);

/**
 * Whether `name`, whatever its case or surrounding spaces, is a name of a system or built-in role
 * in one of the four languages of the screen. A new or renamed role does not take one.
 */
export function isReservedRoleName(name: string | null | undefined): boolean {
  return RESERVED_ROLE_NAME_KEYS.has(roleNameKey(name));
}

/** A role name refused because a system or built-in role has it (400). */
export function roleNameReserved(): BadRequestException {
  return new BadRequestException({ code: 'ROLE_NAME_RESERVED', message: 'This name belongs to a system or built-in role.' });
}

/** A role name refused because another role of the workspace has it (400). */
export function roleNameTaken(): BadRequestException {
  return new BadRequestException({ code: 'ROLE_NAME_TAKEN', message: 'A role already has this name.' });
}
