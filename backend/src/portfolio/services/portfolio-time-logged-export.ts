import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { CsvLanguage } from '../../common/csv-sheet/types';
import { fillLabel, REPORT_EXPORT_LABELS, ReportCell, ReportExport } from '../../common/report-export';
import { TIME_LOGGED_DEFAULT_MONTHS, TIME_LOGGED_MONTHS, TimeLoggedReportResponse } from '../dto/time-logged-report.dto';

/**
 * The table export of the time logged report (`GET portfolio/reports/time-logged/export`), built from
 * `PortfolioTimeLoggedReportService.getReport`'s result for the parameters of the screen: one row per
 * person per month, teams in the report's order then their members, the month as `YYYY-MM` text (a
 * spreadsheet keeps it as the month; a date cell would show its first day), days as numbers, the month's
 * total the one the screen shows (`totalDays` of the cell).
 */

/** Where each label comes from in `frontend/src/locales/<lang>/portfolio.json` (checked by a spec). */
export const TIME_LOGGED_EXPORT_KEYS = {
  sheet: 'reports.timeLogged.title',
  team: 'reports.timeLogged.csv.team',
  person: 'reports.timeLogged.csv.person',
  month: 'reports.timeLogged.csv.month',
  projectDays: 'reports.timeLogged.csv.projectDays',
  otherDays: 'reports.timeLogged.csv.otherDays',
  totalDays: 'reports.timeLogged.csv.totalDays',
  noTeam: 'reports.timeLogged.noTeam',
  unknownUser: 'reports.timeLogged.unknownUser',
  period: 'reports.timeLogged.horizon',
  monthsOne: 'reports.timeLogged.monthOption_one',
  monthsOther: 'reports.timeLogged.monthOption_other',
  projectFilter: 'reports.weekly.filters.project',
  teamFilter: 'reports.weekly.filters.team',
  allProjects: 'reports.weekly.filters.allProjects',
  allTeams: 'reports.weekly.filters.allTeams',
} as const;

export type TimeLoggedExportLabels = Record<keyof typeof TIME_LOGGED_EXPORT_KEYS, string>;

export const TIME_LOGGED_EXPORT_LABELS: Record<CsvLanguage, TimeLoggedExportLabels> = {
  en: {
    sheet: 'Time logged',
    team: 'Team',
    person: 'Person',
    month: 'Month',
    projectDays: 'Project days',
    otherDays: 'Other days',
    totalDays: 'Total days',
    noTeam: 'No team',
    unknownUser: 'Unknown user',
    period: 'Period',
    monthsOne: '{{count}} month',
    monthsOther: '{{count}} months',
    projectFilter: 'Project',
    teamFilter: 'Team',
    allProjects: 'All projects',
    allTeams: 'All teams',
  },
  fr: {
    sheet: 'Temps saisi',
    team: 'Équipe',
    person: 'Personne',
    month: 'Mois',
    projectDays: 'Jours projet',
    otherDays: 'Jours autre',
    totalDays: 'Jours total',
    noTeam: 'Sans équipe',
    unknownUser: 'Utilisateur inconnu',
    period: 'Période',
    monthsOne: '{{count}} mois',
    monthsOther: '{{count}} mois',
    projectFilter: 'Projet',
    teamFilter: 'Équipe',
    allProjects: 'Tous les projets',
    allTeams: 'Toutes les équipes',
  },
  de: {
    sheet: 'Erfasste Zeit',
    team: 'Team',
    person: 'Person',
    month: 'Monat',
    projectDays: 'Projekttage',
    otherDays: 'Andere Tage',
    totalDays: 'Tage gesamt',
    noTeam: 'Kein Team',
    unknownUser: 'Unbekannter Benutzer',
    period: 'Zeitraum',
    monthsOne: '{{count}} Monat',
    monthsOther: '{{count}} Monate',
    projectFilter: 'Projekt',
    teamFilter: 'Team',
    allProjects: 'Alle Projekte',
    allTeams: 'Alle Teams',
  },
  es: {
    sheet: 'Tiempo registrado',
    team: 'Equipo',
    person: 'Persona',
    month: 'Mes',
    projectDays: 'Días de proyecto',
    otherDays: 'Otros días',
    totalDays: 'Días totales',
    noTeam: 'Sin equipo',
    unknownUser: 'Usuario desconocido',
    period: 'Periodo',
    monthsOne: '{{count}} mes',
    monthsOther: '{{count}} meses',
    projectFilter: 'Proyecto',
    teamFilter: 'Equipo',
    allProjects: 'Todos los proyectos',
    allTeams: 'Todos los equipos',
  },
};

/** The export's `months`: absent is the screen's default, anything but an offered horizon is a 400. */
export function timeLoggedExportMonths(raw: unknown): number {
  if (raw === undefined || raw === '') return TIME_LOGGED_DEFAULT_MONTHS;
  const value = Number(String(raw).trim());
  if (!(TIME_LOGGED_MONTHS as readonly number[]).includes(value)) {
    throw new BadRequestException(`months must be one of ${TIME_LOGGED_MONTHS.join(', ')}.`);
  }
  return value;
}

/** The table rows: one per person per month, in the report's team and member order. */
export function timeLoggedExportRows(report: TimeLoggedReportResponse, labels: TimeLoggedExportLabels): ReportCell[][] {
  const rows: ReportCell[][] = [];
  for (const team of report.teams) {
    const teamName = team.teamName ?? labels.noTeam;
    for (const member of team.members) {
      const name = member.userId ? member.name : labels.unknownUser;
      for (const cell of member.cells) {
        rows.push([
          teamName,
          name,
          cell.month,
          { kind: 'number', value: cell.projectDays },
          { kind: 'number', value: cell.otherDays },
          { kind: 'number', value: cell.totalDays },
        ]);
      }
    }
  }
  return rows;
}

export function timeLoggedExport(
  report: TimeLoggedReportResponse,
  language: CsvLanguage,
  applied: { months: number; timeZone: string; projectNames: string[] | null; teamNames: string[] | null },
): ReportExport {
  const labels = TIME_LOGGED_EXPORT_LABELS[language];
  const months = fillLabel(applied.months === 1 ? labels.monthsOne : labels.monthsOther, 'count', String(applied.months));
  return {
    fileBase: 'time-logged',
    limited: false,
    parameters: [
      [labels.period, months],
      [REPORT_EXPORT_LABELS[language].timeZone, applied.timeZone],
      [labels.projectFilter, applied.projectNames ? applied.projectNames.join(', ') : labels.allProjects],
      [labels.teamFilter, applied.teamNames ? applied.teamNames.join(', ') : labels.allTeams],
    ],
    tables: [
      {
        key: 'time-logged',
        sheet: labels.sheet,
        columns: [
          { header: labels.team, kind: 'text' },
          { header: labels.person, kind: 'text' },
          { header: labels.month, kind: 'text' },
          { header: labels.projectDays, kind: 'number' },
          { header: labels.otherDays, kind: 'number' },
          { header: labels.totalDays, kind: 'number' },
        ],
        rows: timeLoggedExportRows(report, labels),
      },
    ],
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The export's `projectIds` or `teamIds`: ids only, a value that is not one is a 400 (the data route is lenient). */
export function timeLoggedExportIds(param: 'projectIds' | 'teamIds', ids: string[]): string[] {
  if (ids.some((id) => !UUID.test(id))) throw new BadRequestException(`${param} must be ${param === 'teamIds' ? 'team' : 'project'} ids.`);
  return ids;
}

/**
 * The names of the projects and teams a filter names, for the Parameters sheet, in name order;
 * null when the filter is empty. An id that names no project (team) of the tenant is a 400: the
 * file would otherwise list a filter it never applied.
 */
export async function filterNames(
  manager: EntityManager,
  tenantId: string,
  param: 'projectIds' | 'teamIds',
  ids: string[],
): Promise<string[] | null> {
  if (ids.length === 0) return null;
  const table = param === 'teamIds' ? 'portfolio_teams' : 'portfolio_projects';
  const rows: Array<{ id: string; name: string | null }> = await manager.query(
    `SELECT id::text AS id, name FROM ${table} WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY name`,
    [tenantId, ids],
  );
  const found = new Set(rows.map((row) => row.id.toLowerCase()));
  const unknown = ids.filter((id) => !found.has(id.toLowerCase()));
  if (unknown.length > 0) {
    throw new BadRequestException(`${param}: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not ${param === 'teamIds' ? 'a team' : 'a project'} of this tenant.`);
  }
  return rows.map((row) => row.name ?? '').filter(Boolean);
}
