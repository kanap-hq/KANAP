import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { CsvLanguage } from '../../common/csv-sheet/types';
import type { ReportCell, ReportExport, ReportTable } from '../../common/report-export';
import type { CapacityGroupBy, CapacityHeatmapResponse, CapacityMode } from '../dto/capacity-heatmap.dto';
import { ProjectStatuses } from '../dto/create-project.dto';
import type { ProjectStatus } from '../portfolio-project.entity';

/**
 * The table export of the capacity heatmap (`GET portfolio/reports/capacity-heatmap/export`), built from
 * `PortfolioCapacityReportService.getHeatmap`'s result for the parameters of the screen: the contributor
 * table and the team table as the screen shows them, in its order. A value the screen shows as "N/A" is an
 * empty cell; days and months are numbers, shown with two decimals in the workbook. The workbook holds both groupings (the one asked by `groupBy`
 * first), a CSV the one asked by `groupBy`.
 */

/** The pseudo team of the people without a team, as the data route takes it. */
export const NO_TEAM_ID = 'no-team';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where each label comes from in `frontend/src/locales/<lang>/portfolio.json` (checked by a spec). */
export const CAPACITY_HEATMAP_EXPORT_KEYS = {
  contributorSheet: 'reports.capacityHeatmap.sections.contributorCapacity',
  teamSheet: 'reports.capacityHeatmap.sections.teamCapacity',
  contributor: 'reports.capacityHeatmap.columns.contributor',
  team: 'reports.capacityHeatmap.columns.team',
  remainingDays: 'reports.capacityHeatmap.columns.remainingDays',
  capacityPerMonth: 'reports.capacityHeatmap.columns.capacityPerMonth',
  source: 'reports.capacityHeatmap.columns.source',
  monthsOfWork: 'reports.capacityHeatmap.columns.monthsOfWork',
  members: 'reports.capacityHeatmap.columns.members',
  noTeam: 'reports.capacityHeatmap.values.noTeam',
  noContributorProfile: 'reports.capacityHeatmap.values.noContributorProfile',
  historical: 'reports.capacityHeatmap.values.historical',
  theoretical: 'reports.capacityHeatmap.values.theoretical',
  teamsFilter: 'reports.capacityHeatmap.filters.teams',
  allTeams: 'reports.capacityHeatmap.filters.allTeams',
  statusFilter: 'reports.capacityHeatmap.filters.status',
  status_waiting_list: 'statuses.project.waiting_list',
  status_planned: 'statuses.project.planned',
  status_in_progress: 'statuses.project.in_progress',
  status_in_testing: 'statuses.project.in_testing',
  status_on_hold: 'statuses.project.on_hold',
  status_done: 'statuses.project.done',
  status_cancelled: 'statuses.project.cancelled',
} as const;

export type CapacityHeatmapExportLabels = Record<keyof typeof CAPACITY_HEATMAP_EXPORT_KEYS, string>;

export const CAPACITY_HEATMAP_EXPORT_LABELS: Record<CsvLanguage, CapacityHeatmapExportLabels> = {
  en: {
    contributorSheet: 'Contributor capacity',
    teamSheet: 'Team capacity',
    contributor: 'Contributor',
    team: 'Team',
    remainingDays: 'Remaining days',
    capacityPerMonth: 'Capacity / mo',
    source: 'Source',
    monthsOfWork: 'Months of work',
    members: 'Members',
    noTeam: 'No team',
    noContributorProfile: 'No contributor profile',
    historical: 'Historical',
    theoretical: 'Theoretical',
    teamsFilter: 'Teams',
    allTeams: 'All teams',
    statusFilter: 'Status',
    status_waiting_list: 'Waiting list',
    status_planned: 'Planned',
    status_in_progress: 'In progress',
    status_in_testing: 'In testing',
    status_on_hold: 'On hold',
    status_done: 'Done',
    status_cancelled: 'Cancelled',
  },
  fr: {
    contributorSheet: 'Capacité du contributeur',
    teamSheet: "Capacité de l'équipe",
    contributor: 'Contributeur',
    team: 'Équipe',
    remainingDays: 'Jours restants',
    capacityPerMonth: 'Capacité / mois',
    source: 'Source',
    monthsOfWork: 'Mois de travail',
    members: 'Membres',
    noTeam: 'Sans équipe',
    noContributorProfile: 'Sans fiche contributeur',
    historical: 'Historique',
    theoretical: 'Théorique',
    teamsFilter: 'Équipes',
    allTeams: 'Toutes les équipes',
    statusFilter: 'Statut',
    status_waiting_list: "Liste d'attente",
    status_planned: 'Planifié',
    status_in_progress: 'En cours',
    status_in_testing: 'En test',
    status_on_hold: 'Suspendu',
    status_done: 'Terminé',
    status_cancelled: 'Annulé',
  },
  de: {
    contributorSheet: 'Kapazität der Mitwirkenden',
    teamSheet: 'Teamkapazität',
    contributor: 'Mitwirkender',
    team: 'Team',
    remainingDays: 'Verbleibende Tage',
    capacityPerMonth: 'Kapazität / Mon.',
    source: 'Quelle',
    monthsOfWork: 'Arbeitsmonate',
    members: 'Mitglieder',
    noTeam: 'Kein Team',
    noContributorProfile: 'Kein Mitwirkendenprofil',
    historical: 'Historisch',
    theoretical: 'Theoretisch',
    teamsFilter: 'Teams',
    allTeams: 'Alle Teams',
    statusFilter: 'Status',
    status_waiting_list: 'Warteliste',
    status_planned: 'Geplant',
    status_in_progress: 'In Bearbeitung',
    status_in_testing: 'Im Test',
    status_on_hold: 'Pausiert',
    status_done: 'Erledigt',
    status_cancelled: 'Abgebrochen',
  },
  es: {
    contributorSheet: 'Capacidad del colaborador',
    teamSheet: 'Capacidad del equipo',
    contributor: 'Colaborador',
    team: 'Equipo',
    remainingDays: 'Días restantes',
    capacityPerMonth: 'Capacidad / mes',
    source: 'Origen',
    monthsOfWork: 'Meses de trabajo',
    members: 'Miembros',
    noTeam: 'Sin equipo',
    noContributorProfile: 'Sin ficha de colaborador',
    historical: 'Histórico',
    theoretical: 'Teórico',
    teamsFilter: 'Equipos',
    allTeams: 'Todos los equipos',
    statusFilter: 'Estado',
    status_waiting_list: 'Lista de espera',
    status_planned: 'Planificado',
    status_in_progress: 'En curso',
    status_in_testing: 'En pruebas',
    status_on_hold: 'En pausa',
    status_done: 'Completado',
    status_cancelled: 'Cancelado',
  },
};

const listOf = (raw: unknown): string[] =>
  raw === undefined ? [] : String(raw).split(',').map((part) => part.trim()).filter(Boolean);

/**
 * The export's parameters, stricter than the data route's: an unknown value is a 400 where the data route
 * drops it (a status) or fails on it (a team id that is not an id). Absent values take the screen's defaults.
 */
export function capacityHeatmapExportQuery(query: Record<string, unknown>): {
  capacityMode: CapacityMode;
  groupBy: CapacityGroupBy;
  statuses: ProjectStatus[] | undefined;
  teamFilter: { isActive: boolean; teamIds: string[]; includeNoTeam: boolean };
} {
  const capacityMode = query.capacityMode === undefined || query.capacityMode === '' ? 'historical' : query.capacityMode;
  if (capacityMode !== 'historical' && capacityMode !== 'theoretical') {
    throw new BadRequestException('capacityMode must be historical or theoretical.');
  }
  const groupBy = query.groupBy === undefined || query.groupBy === '' ? 'contributor' : query.groupBy;
  if (groupBy !== 'contributor' && groupBy !== 'team') throw new BadRequestException('groupBy must be contributor or team.');
  const statuses = listOf(query.statuses);
  const unknownStatus = statuses.filter((status) => !(ProjectStatuses as readonly string[]).includes(status));
  if (unknownStatus.length > 0) throw new BadRequestException(`statuses must be among ${ProjectStatuses.join(', ')}.`);
  const ids = listOf(query.teamIds);
  if (ids.some((id) => id !== NO_TEAM_ID && !UUID.test(id))) throw new BadRequestException(`teamIds must be team ids or ${NO_TEAM_ID}.`);
  const teamIds = [...new Set(ids.filter((id) => id !== NO_TEAM_ID))];
  return {
    capacityMode,
    groupBy,
    statuses: statuses.length > 0 ? (statuses as ProjectStatus[]) : undefined,
    teamFilter: { isActive: ids.length > 0, teamIds, includeNoTeam: ids.includes(NO_TEAM_ID) },
  };
}

const days = (value: number | null | undefined): ReportCell =>
  value == null || !Number.isFinite(value) ? null : { kind: 'number', value };

/** The two tables, in the screen's order and words. */
export function capacityHeatmapTables(heatmap: CapacityHeatmapResponse, labels: CapacityHeatmapExportLabels): ReportTable[] {
  const contributors: ReportTable = {
    key: 'contributor',
    sheet: labels.contributorSheet,
    columns: [
      { header: labels.contributor, kind: 'text' },
      { header: labels.team, kind: 'text' },
      { header: labels.remainingDays, kind: 'number', decimals: 2 },
      { header: labels.capacityPerMonth, kind: 'number', decimals: 2 },
      { header: labels.source, kind: 'text' },
      { header: labels.monthsOfWork, kind: 'number', decimals: 2 },
    ],
    rows: heatmap.contributors.map((row) => [
      row.contributorName,
      row.hasContributorProfile === false ? labels.noContributorProfile : row.teamName || labels.noTeam,
      days(row.remainingDays),
      days(row.capacityDaysPerMonth),
      row.capacitySource === 'historical' ? labels.historical : row.capacitySource === 'theoretical' ? labels.theoretical : null,
      days(row.monthsOfWork),
    ]),
  };
  const teams: ReportTable = {
    key: 'team',
    sheet: labels.teamSheet,
    columns: [
      { header: labels.team, kind: 'text' },
      { header: labels.members, kind: 'number' },
      { header: labels.remainingDays, kind: 'number', decimals: 2 },
      { header: labels.capacityPerMonth, kind: 'number', decimals: 2 },
      { header: labels.monthsOfWork, kind: 'number', decimals: 2 },
    ],
    rows: heatmap.teams.map((row) => [
      row.teamId === NO_TEAM_ID ? labels.noTeam : row.teamName,
      days(row.memberCount),
      days(row.remainingDays),
      days(row.capacityDaysPerMonth),
      days(row.monthsOfWork),
    ]),
  };
  return [contributors, teams];
}

export function capacityHeatmapExport(
  heatmap: CapacityHeatmapResponse,
  language: CsvLanguage,
  applied: { teamNames: string[] | null },
): ReportExport {
  const labels = CAPACITY_HEATMAP_EXPORT_LABELS[language];
  const statusLabel = (status: ProjectStatus) => labels[`status_${status}` as keyof CapacityHeatmapExportLabels];
  const statuses = ProjectStatuses.filter((status) => heatmap.filters.statuses.includes(status)).map(statusLabel);
  return {
    fileBase: 'capacity-heatmap',
    limited: false,
    parameters: [
      [labels.teamsFilter, applied.teamNames ? applied.teamNames.join(', ') : labels.allTeams],
      [labels.statusFilter, statuses.join(', ')],
      [labels.source, heatmap.filters.capacityMode === 'theoretical' ? labels.theoretical : labels.historical],
    ],
    tables: capacityHeatmapTables(heatmap, labels),
  };
}

/** The names of the filtered teams, "No team" included, for the Parameters sheet; null without a filter. */
export async function capacityTeamNames(
  manager: EntityManager,
  tenantId: string,
  filter: { isActive: boolean; teamIds: string[]; includeNoTeam: boolean },
  language: CsvLanguage,
): Promise<string[] | null> {
  if (!filter.isActive) return null;
  const rows: Array<{ name: string | null }> = filter.teamIds.length
    ? await manager.query(`SELECT name FROM portfolio_teams WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY name`, [tenantId, filter.teamIds])
    : [];
  const names = rows.map((row) => row.name ?? '').filter(Boolean);
  if (filter.includeNoTeam) names.push(CAPACITY_HEATMAP_EXPORT_LABELS[language].noTeam);
  return names;
}
