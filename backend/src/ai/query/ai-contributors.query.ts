import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { codeLabels } from '../import/ai-import-code-labels';
import { COMPANY_LOOKUP, lookupReference } from '../../common/lookup/reference-lookups';
import { ORGANISATION_LOOKUP_READERS } from '../../common/lookup/lookup-requirements';
import type { PermissionLevel } from '../../permissions/permissions.service';
import type { PortfolioClassificationService } from '../../portfolio/portfolio-classification.service';
import type { PortfolioSkillsService } from '../../portfolio/portfolio-skills.service';
import type { TeamMemberConfigService } from '../../portfolio/team-member-config.service';
import type { AiScreenLanguage } from '../ai-unread-families';
import type { AiWithheldField } from './ai-filter.types';
import { compareText, dateMatch, numberMatch, paged, textMatch } from './ai-support.query';

/**
 * Portfolio › Contributors as the screen shows them, for the assistant and the MCP server: the
 * family `contributors`, one row per contributor (`MEM-n`), read through the services of the screen
 * (`TeamMemberConfigService.list`, `getAllTimeStats`, `getTimeStats`, the skills and the portfolio
 * classification of the drawer, the company lookup of its company field), never a second query.
 * Read with the right of the page, the portfolio settings at reader level.
 *
 * The person is named as the list names them (their name, else their email), with the job title
 * of their profile; the team, the manager and the contract type by the names the list route
 * gives. A manager who is a contributor too carries their `MEM-n`, as the page links them. The
 * skills come by name with their level in the person's language, as the Skills tab. The default
 * company of the drawer is named only for a person who reads the company lookup, as its field
 * (`/companies/lookup`, `ORGANISATION_LOOKUP_READERS`); for the others it is withheld, said so.
 *
 * The list is small (the contributors of a tenant): filtered, grouped, sorted and paged in memory.
 */

/** The levels of a skill, as the Skills tab names them (`portfolio:workspace.contributor.proficiency`). */
export const CONTRIBUTOR_SKILL_LEVEL_LABELS = codeLabels({
  1: ['Basic / theoretical', 'Basique / Théorique', 'Grundlagen / Theoretisch', 'Básico / Teórico'],
  2: ['Can execute with support', 'Peut exécuter avec accompagnement', 'Kann mit Unterstützung ausführen', 'Puede ejecutar con soporte'],
  3: ['Autonomous', 'Autonome', 'Eigenständig', 'Autónomo'],
  4: ['Expert', 'Expert', 'Experte', 'Experto'],
});

const SKILL_LEVEL_MIN = 1;
const SKILL_LEVEL_MAX = 4;

/** What a contributor's figures mean, with every result. */
export const AI_CONTRIBUTOR_NOTE = '`availability_days` is the project availability the contributor declares, in days per month. '
  + '`avg_project_days` is the average of the project days logged per month over the last six months, as the list card shows it; null when nothing was logged. '
  + 'A contributor is a person of the workspace with a portfolio profile: `name` is that person.';

/** Why the default company is withheld from a person who does not read the company lookup. */
export const AI_CONTRIBUTOR_COMPANY_WITHHELD: AiWithheldField = {
  field: 'default_company',
  reason: 'This person does not read the companies: the default company of a contributor is not read here, which does not mean there is none.',
};

export type AiContributorSkill = { skill: string; category: string | null; level: number; level_name: string };

export type AiContributorRow = {
  id: string;
  item_number: number;
  ref: string;
  name: string;
  job_title: string | null;
  team: string | null;
  manager: string | null;
  manager_ref: string | null;
  employment_type: string | null;
  availability_days: number;
  skills: AiContributorSkill[];
  skill_count: number;
  avg_project_days: number | null;
  default_source: string | null;
  default_category: string | null;
  default_stream: string | null;
  default_company: string | null;
  notes: string | null;
  created_at: string | null;
};

export type AiContributorServices = {
  members: Pick<TeamMemberConfigService, 'list' | 'getAllTimeStats' | 'getTimeStats'>;
  skills: Pick<PortfolioSkillsService, 'list'>;
  classification: Pick<PortfolioClassificationService, 'getAll'>;
};

export type AiContributorOpts = {
  manager: EntityManager;
  tenantId: string;
  /** The person's language (`readAiScreenLanguage`); English when their profile sets none. */
  language: AiScreenLanguage | null;
  /** Whether the person reads the company lookup, as the company field of the drawer. */
  readsCompanies: boolean;
};

export type AiContributorList = { items: AiContributorRow[]; total: number; page: number; limit: number };

export const CONTRIBUTOR_SORTS = new Set([
  'name', 'ref', 'team', 'manager', 'employment_type', 'availability_days', 'skill_count', 'avg_project_days', 'created_at',
]);

const RANK: Record<PermissionLevel, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

/** Whether rights in the shape of a request (`AiPolicyService.effectiveAccess`) read the company lookup. */
export function readsCompanyLookup(access: { isAdmin: boolean; permissions: Record<string, PermissionLevel> }): boolean {
  if (access.isAdmin) return true;
  return ORGANISATION_LOOKUP_READERS.some((requirement) => {
    const held = access.permissions[requirement.resource];
    return !!held && RANK[held] >= RANK[requirement.level as PermissionLevel];
  });
}

/** The reference of a contributor (`MEM-4`). */
export function contributorRef(itemNumber: number): string {
  return `MEM-${itemNumber}`;
}

/** The item number a `MEM-n` reference names, or null for another text. */
export function contributorRefNumber(value: string | null | undefined): number | null {
  const match = String(value ?? '').trim().match(/^MEM-?([1-9]\d*)$/i);
  return match ? Number(match[1]) : null;
}

function skillLevel(value: unknown): number {
  const level = Number(value);
  return Math.min(SKILL_LEVEL_MAX, Math.max(SKILL_LEVEL_MIN, Number.isFinite(level) ? level : SKILL_LEVEL_MIN));
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nameOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

/**
 * Every contributor of the tenant, as the list route gives them, with the names of their skills,
 * of their classification defaults and of their default company (for a reader of companies).
 */
export async function readContributors(services: AiContributorServices, opts: AiContributorOpts): Promise<AiContributorRow[]> {
  const serviceOpts = { manager: opts.manager };
  // One after the other: every read shares the request's connection.
  const { items } = await services.members.list(opts.tenantId, serviceOpts) as { items: any[] };
  const { stats } = await services.members.getAllTimeStats(opts.tenantId, serviceOpts);
  const { items: skills } = await services.skills.list(opts.tenantId, serviceOpts);
  const classification = await services.classification.getAll(opts.tenantId, serviceOpts);

  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const sources = new Map(classification.sources.map((source) => [source.id, source.name]));
  const categories = new Map(classification.categories.map((category) => [category.id, category.name]));
  const streams = new Map(classification.streams.map((stream) => [stream.id, stream.name]));
  const refByUser = new Map(items.map((item) => [String(item.user_id), contributorRef(Number(item.item_number))]));

  const companies = new Map<string, string>();
  const companyIds = Array.from(new Set(items.map((item) => item.default_company_id).filter((id): id is string => !!id)));
  if (opts.readsCompanies && companyIds.length > 0) {
    const found = await lookupReference({ manager: opts.manager, tenantId: opts.tenantId }, COMPANY_LOOKUP, { ids: companyIds.join(',') });
    for (const company of found.items as Array<{ id: string; name: string }>) companies.set(company.id, company.name);
  }

  const language = opts.language ?? 'en';
  return items.map((item) => {
    const own: Array<{ skill_id: string; proficiency: number }> = Array.isArray(item.skills) ? item.skills : [];
    const named: AiContributorSkill[] = own.flatMap((entry) => {
      const skill = skillsById.get(entry.skill_id);
      if (!skill) return [];
      const level = skillLevel(entry.proficiency);
      return [{ skill: skill.name, category: skill.category ?? null, level, level_name: CONTRIBUTOR_SKILL_LEVEL_LABELS[language][String(level)] }];
    });
    const average = stats[item.id]?.avgProjectDays;
    return {
      id: String(item.id),
      item_number: Number(item.item_number),
      ref: contributorRef(Number(item.item_number)),
      name: nameOrNull(item.user_display_name) ?? nameOrNull(item.user_email) ?? '',
      job_title: nameOrNull(item.job_title),
      team: nameOrNull(item.team_name),
      manager: nameOrNull(item.manager_name),
      manager_ref: item.manager_user_id ? refByUser.get(String(item.manager_user_id)) ?? null : null,
      employment_type: nameOrNull(item.employment_type_name),
      availability_days: Number.isFinite(Number(item.project_availability)) ? Number(item.project_availability) : 5,
      skills: named,
      skill_count: own.length,
      avg_project_days: average == null ? null : Number(average),
      default_source: item.default_source_id ? sources.get(item.default_source_id) ?? null : null,
      default_category: item.default_category_id ? categories.get(item.default_category_id) ?? null : null,
      default_stream: item.default_stream_id ? streams.get(item.default_stream_id) ?? null : null,
      default_company: opts.readsCompanies && item.default_company_id ? companies.get(item.default_company_id) ?? null : null,
      notes: nameOrNull(item.notes),
      created_at: toIso(item.created_at),
    };
  });
}

/** The skills of a row in words: "SAP (Expert), Network (Autonomous)". */
export function contributorSkillsText(row: AiContributorRow): string | null {
  return row.skills.map((skill) => `${skill.skill} (${skill.level_name})`).join(', ') || null;
}

function filtered(rows: AiContributorRow[], query: Record<string, any>): AiContributorRow[] {
  const filters = query.filters;
  const q = String(query.q ?? '').trim();
  const refNumber = contributorRefNumber(q);
  const refFilter = filters?.ref ? contributorRefNumber(filters.ref.filter) : null;
  const needle = q.toLowerCase();
  return rows.filter((row) => (filters?.ref ? (refFilter != null ? row.item_number === refFilter : textMatch(row.ref, filters.ref)) : true)
    && textMatch(row.name, filters?.name)
    && textMatch(row.job_title, filters?.job_title)
    && textMatch(row.team, filters?.team)
    && textMatch(row.manager, filters?.manager)
    && textMatch(row.employment_type, filters?.employment_type)
    && numberMatch(row.availability_days, filters?.availability_days)
    && textMatch(row.skills.map((skill) => skill.skill).join(', ') || null, filters?.skill)
    && numberMatch(row.skill_count, filters?.skill_count)
    && numberMatch(row.avg_project_days, filters?.avg_project_days)
    && textMatch(row.default_source, filters?.default_source)
    && textMatch(row.default_category, filters?.default_category)
    && textMatch(row.default_stream, filters?.default_stream)
    && textMatch(row.default_company, filters?.default_company)
    && textMatch(row.notes, filters?.notes)
    && dateMatch(row.created_at, filters?.created_at)
    // A reference names one contributor exactly (MEM-1 never keeps MEM-12); a word searches the
    // name, the job title, the team and the skills.
    && (!q || (refNumber != null
      ? row.item_number === refNumber
      : [row.name, row.ref, row.job_title, row.team, ...row.skills.map((skill) => skill.skill)]
        .some((value) => value != null && value.toLowerCase().includes(needle)))));
}

function sortValue(row: AiContributorRow, field: string): string | number | null {
  switch (field) {
    case 'name': return row.name;
    case 'ref': return row.item_number;
    case 'team': return row.team;
    case 'manager': return row.manager;
    case 'employment_type': return row.employment_type;
    case 'availability_days': return row.availability_days;
    case 'skill_count': return row.skill_count;
    case 'avg_project_days': return row.avg_project_days;
    case 'created_at': return row.created_at;
    default: return null;
  }
}

function sortRows(rows: AiContributorRow[], sort: string | undefined): AiContributorRow[] {
  const [requested, requestedDirection] = String(sort ?? '').split(':');
  // Without a sort, the list route's order (first name, last name, email).
  if (!CONTRIBUTOR_SORTS.has(requested)) return rows;
  const descending = String(requestedDirection ?? 'asc').toLowerCase() === 'desc';
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, requested) }))
    .sort((a, b) => {
      if (a.value == null || b.value == null) return a.value == null && b.value == null ? a.index - b.index : a.value == null ? 1 : -1;
      const order = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : compareText(String(a.value), String(b.value));
      if (order === 0) return a.index - b.index;
      return descending ? -order : order;
    })
    .map((entry) => entry.row);
}

export async function listAiContributors(
  services: AiContributorServices,
  query: Record<string, any>,
  opts: AiContributorOpts,
  readAll = false,
): Promise<AiContributorList> {
  const rows = await readContributors(services, opts);
  return paged(sortRows(filtered(rows, query), query.sort), query, readAll);
}

/** The group keys of a row: one per skill for `skill`, one for the other fields. */
export function contributorGroupValues(row: AiContributorRow, groupBy: string): Array<string | null> {
  switch (groupBy) {
    case 'team': return [row.team];
    case 'manager': return [row.manager];
    case 'employment_type': return [row.employment_type];
    case 'job_title': return [row.job_title];
    case 'default_source': return [row.default_source];
    case 'default_category': return [row.default_category];
    case 'default_stream': return [row.default_stream];
    case 'default_company': return [row.default_company];
    case 'skill': return row.skills.length ? Array.from(new Set(row.skills.map((skill) => skill.skill))) : [null];
    default: return [null];
  }
}

/** The contributors of each group of the filtered rows, most first; a contributor counts in each of their skills. */
export function aggregateContributorRows(rows: AiContributorRow[], groupBy: string): Array<{ key: string | null; count: number }> {
  const groups = new Map<string | null, number>();
  for (const row of rows) {
    for (const key of contributorGroupValues(row, groupBy)) groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || compareText(a.key, b.key));
}

/** The distinct values of the discoverable fields, for get_filter_values: the names the rows hold, null when one lacks it. */
export function contributorFieldValues(rows: AiContributorRow[], field: string): Array<string | null> {
  const values = new Set<string>();
  let blank = false;
  for (const row of rows) {
    for (const value of contributorGroupValues(row, field)) {
      if (value == null) blank = true;
      else values.add(value);
    }
  }
  return [...[...values].sort((a, b) => compareText(a, b)), ...(blank ? [null] : [])];
}

/** One contributor, by uuid or `MEM-n`, among the rows of the tenant; not found otherwise. */
export function findContributor(rows: AiContributorRow[], idOrRef: string): AiContributorRow {
  const value = String(idOrRef ?? '').trim();
  const number = contributorRefNumber(value);
  const row = rows.find((entry) => (number != null ? entry.item_number === number : entry.id === value.toLowerCase()));
  if (!row) throw new NotFoundException(`No contributor matches "${value}". Search for it first, then use its id or MEM-n reference.`);
  return row;
}

/**
 * A contributor as its page: the row, its skills with their category and level, and the time it
 * logged as the General tab shows it (`getTimeStats`: the average project days per month over six
 * months, and the project, other and total days of the last twelve months).
 */
export async function contributorDetail(
  services: AiContributorServices,
  opts: AiContributorOpts,
  row: AiContributorRow,
): Promise<Record<string, unknown>> {
  const time = await services.members.getTimeStats(row.id, { manager: opts.manager });
  const { id: _id, item_number: _number, ...rest } = row;
  return {
    ...rest,
    skills: row.skills,
    time_logged: {
      average_project_days: time.averageProjectDays,
      monthly: time.monthly.map((month) => ({
        month: month.yearMonth.slice(0, 7),
        project_days: month.projectDays,
        other_days: month.otherDays,
        total_days: month.totalDays,
      })),
      note: 'Days logged on tasks and projects, 8 hours a day: the average of the project days per month over the last six months, and the last twelve months.',
    },
  };
}
