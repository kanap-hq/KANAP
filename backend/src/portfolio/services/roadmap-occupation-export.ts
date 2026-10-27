import type { CsvLanguage } from '../../common/csv-sheet/types';
import { fillLabel, type ReportCell, type ReportColumn, type ReportExport } from '../../common/report-export';
import type { RoadmapGenerateDto, RoadmapResponse } from '../dto/roadmap.dto';
import { buildRoadmapOccupation, isoWeekParts, roundedMean } from '../shared/roadmapOccupation';

/**
 * The export of the roadmap occupation (`POST /portfolio/reports/roadmap/occupation/export`, the generate
 * payload as body): the two tables the screen draws, from the answer of the same generation and the same
 * code (`../shared/roadmapOccupation.ts`, a copy of the screen's module). Contributors grouped by team, then
 * teams; one column per week, the row's average last; an average row as the footer. Occupation values are
 * `percent` cells (the screen's rounded whole percent as a fraction, `0.85`), averages too.
 */

/** The query keys of the export besides `format`, `language` and `tz`: `table` picks the CSV table. */
export const ROADMAP_OCCUPATION_EXPORT_QUERY_KEYS = ['table'] as const;

/** Where each label comes from in `frontend/src/locales/<lang>/portfolio.json` (checked by a spec). */
export const ROADMAP_OCCUPATION_EXPORT_KEYS = {
  contributorsSheet: 'planning.roadmap.occupation.contributors',
  teamsSheet: 'planning.roadmap.occupation.teams',
  team: 'planning.roadmap.occupation.team',
  contributor: 'planning.roadmap.occupation.contributor',
  average: 'planning.roadmap.occupation.average',
  avg: 'planning.roadmap.occupation.avg',
  weekYear: 'planning.roadmap.occupation.weekYear',
  noTeam: 'planning.roadmap.occupation.noTeam',
  startDate: 'planning.roadmap.fields.startDate',
  statuses: 'planning.roadmap.fields.statuses',
  capacityMode: 'planning.roadmap.fields.capacityMode',
  constraintScope: 'planning.roadmap.fields.constraintScope',
  parallelLimit: 'planning.roadmap.fields.parallelLimit',
  recalculateScheduled: 'planning.roadmap.fields.recalculateScheduled',
  contextSwitchGrace: 'planning.roadmap.fields.contextSwitchGrace',
  capacityTheoretical: 'planning.roadmap.capacityModes.theoretical',
  capacityHistorical: 'planning.roadmap.capacityModes.historical',
  scopeFull: 'planning.roadmap.constraintScopes.full',
  scopeItOnly: 'planning.roadmap.constraintScopes.itOnly',
  priorityFocused: 'planning.roadmap.optimization.priorityFocused',
  completionFocused: 'planning.roadmap.optimization.completionFocused',
  percent: 'planning.roadmap.values.percent',
  scenario: 'planning.roadmap.overrides.title',
  statusWaitingList: 'statuses.project.waiting_list',
  statusPlanned: 'statuses.project.planned',
  statusInProgress: 'statuses.project.in_progress',
  statusInTesting: 'statuses.project.in_testing',
  yes: 'activity.history.values.yes',
  no: 'activity.history.values.no',
} as const;

/** The words only the file has (the Parameters sheet), kept here in the four languages. */
type FileOnlyLabels = { optimization: string; contextSwitchPenalty: string; excludedProjects: string };

export type RoadmapOccupationExportLabels = Record<keyof typeof ROADMAP_OCCUPATION_EXPORT_KEYS, string> & FileOnlyLabels;

export const ROADMAP_OCCUPATION_EXPORT_LABELS: Record<CsvLanguage, RoadmapOccupationExportLabels> = {
  en: {
    contributorsSheet: 'Contributors',
    teamsSheet: 'Teams',
    team: 'Team',
    contributor: 'Contributor',
    average: 'Average',
    avg: 'Avg',
    weekYear: 'W{{week}} {{year}}',
    noTeam: 'No team',
    startDate: 'Start date',
    statuses: 'Statuses',
    capacityMode: 'Capacity mode',
    constraintScope: 'Constraint scope',
    parallelLimit: 'Parallel limit',
    recalculateScheduled: 'Recalculate already scheduled projects',
    contextSwitchGrace: 'Context-switch grace',
    capacityTheoretical: 'Theoretical',
    capacityHistorical: 'Historical',
    scopeFull: 'Full portfolio',
    scopeItOnly: 'IT only',
    priorityFocused: 'Priority focused',
    completionFocused: 'Completion focused',
    percent: '{{value}}%',
    scenario: 'Scenario overrides',
    statusWaitingList: 'Waiting list',
    statusPlanned: 'Planned',
    statusInProgress: 'In progress',
    statusInTesting: 'In testing',
    yes: 'Yes',
    no: 'No',
    optimization: 'Optimization',
    contextSwitchPenalty: 'Context-switch penalty',
    excludedProjects: 'Excluded projects',
  },
  fr: {
    contributorsSheet: 'Contributeurs',
    teamsSheet: 'Équipes',
    team: 'Équipe',
    contributor: 'Contributeur',
    average: 'Moyenne',
    avg: 'Moy.',
    weekYear: 'S{{week}} {{year}}',
    noTeam: 'Aucune équipe',
    startDate: 'Date de début',
    statuses: 'Statuts',
    capacityMode: 'Mode de capacité',
    constraintScope: 'Périmètre des contraintes',
    parallelLimit: 'Limite de parallélisme',
    recalculateScheduled: 'Recalculer les projets déjà planifiés',
    contextSwitchGrace: 'Tolérance de changement de contexte',
    capacityTheoretical: 'Théorique',
    capacityHistorical: 'Historique',
    scopeFull: 'Portefeuille complet',
    scopeItOnly: 'IT uniquement',
    priorityFocused: "Priorité d'abord",
    completionFocused: "Achèvement d'abord",
    percent: '{{value}} %',
    scenario: 'Ajustements du scénario',
    statusWaitingList: "Liste d'attente",
    statusPlanned: 'Planifié',
    statusInProgress: 'En cours',
    statusInTesting: 'En test',
    yes: 'Oui',
    no: 'Non',
    optimization: 'Optimisation',
    contextSwitchPenalty: 'Pénalité de changement de contexte',
    excludedProjects: 'Projets exclus',
  },
  de: {
    contributorsSheet: 'Mitwirkende',
    teamsSheet: 'Teams',
    team: 'Team',
    contributor: 'Mitwirkender',
    average: 'Durchschnitt',
    avg: 'Ø',
    weekYear: 'KW{{week}} {{year}}',
    noTeam: 'Kein Team',
    startDate: 'Startdatum',
    statuses: 'Status',
    capacityMode: 'Kapazitätsmodus',
    constraintScope: 'Umfang der Einschränkungen',
    parallelLimit: 'Parallelitätsgrenze',
    recalculateScheduled: 'Bereits geplante Projekte neu berechnen',
    contextSwitchGrace: 'Kontextwechsel-Toleranz',
    capacityTheoretical: 'Theoretisch',
    capacityHistorical: 'Historisch',
    scopeFull: 'Gesamtes Portfolio',
    scopeItOnly: 'Nur IT',
    priorityFocused: 'Priorität zuerst',
    completionFocused: 'Fertigstellung zuerst',
    percent: '{{value}} %',
    scenario: 'Szenario-Anpassungen',
    statusWaitingList: 'Warteliste',
    statusPlanned: 'Geplant',
    statusInProgress: 'In Bearbeitung',
    statusInTesting: 'Im Test',
    yes: 'Ja',
    no: 'Nein',
    optimization: 'Optimierung',
    contextSwitchPenalty: 'Kontextwechsel-Abzug',
    excludedProjects: 'Ausgeschlossene Projekte',
  },
  es: {
    contributorsSheet: 'Colaboradores',
    teamsSheet: 'Equipos',
    team: 'Equipo',
    contributor: 'Colaborador',
    average: 'Promedio',
    avg: 'Prom.',
    weekYear: 'S{{week}} {{year}}',
    noTeam: 'Sin equipo',
    startDate: 'Fecha de inicio',
    statuses: 'Estados',
    capacityMode: 'Modo de capacidad',
    constraintScope: 'Alcance de las restricciones',
    parallelLimit: 'Límite de paralelismo',
    recalculateScheduled: 'Recalcular los proyectos ya planificados',
    contextSwitchGrace: 'Tolerancia de cambio de contexto',
    capacityTheoretical: 'Teórica',
    capacityHistorical: 'Histórica',
    scopeFull: 'Cartera completa',
    scopeItOnly: 'Solo IT',
    priorityFocused: 'Prioridad primero',
    completionFocused: 'Finalización primero',
    percent: '{{value}} %',
    scenario: 'Ajustes del escenario',
    statusWaitingList: 'Lista de espera',
    statusPlanned: 'Planificado',
    statusInProgress: 'En curso',
    statusInTesting: 'En pruebas',
    yes: 'Sí',
    no: 'No',
    optimization: 'Optimización',
    contextSwitchPenalty: 'Penalización por cambio de contexto',
    excludedProjects: 'Proyectos excluidos',
  },
};

/** The occupation tables of a generation, in the words of `language`. */
export function roadmapOccupationExport(
  response: Pick<RoadmapResponse, 'occupation' | 'teamOccupation'>,
  options: RoadmapGenerateDto,
  language: CsvLanguage,
): ReportExport {
  const labels = ROADMAP_OCCUPATION_EXPORT_LABELS[language];
  const tables = buildRoadmapOccupation(
    response.occupation,
    response.teamOccupation,
    { noTeam: labels.noTeam },
    new Intl.Collator(language).compare,
  );
  const { weekKeys } = tables;
  const percent = (value: number | null | undefined): ReportCell => (value == null ? null : { kind: 'percent', value: value / 100 });
  const weekColumns = weekKeys.map((weekKey): ReportColumn => {
    const parts = isoWeekParts(weekKey);
    const header = fillLabel(fillLabel(labels.weekYear, 'week', String(parts.week).padStart(2, '0')), 'year', String(parts.year));
    return { header, kind: 'percent' };
  });
  const weekCells = (weekOccupation: Map<string, number | null>): ReportCell[] => [
    ...weekKeys.map((weekKey) => percent(weekOccupation.get(weekKey))),
    percent(roundedMean(weekKeys.map((weekKey) => weekOccupation.get(weekKey)))),
  ];
  const averageCells = (averages: Map<string, number | null>): ReportCell[] => weekCells(averages);

  const contributorRows: ReportCell[][] = tables.contributorGroups.flatMap((group) => group.rows.map((row) => [
    group.teamName,
    row.contributorName,
    ...weekCells(row.weekOccupation),
  ]));
  const teamRows: ReportCell[][] = tables.teamRows.map((row) => [row.teamName, ...weekCells(row.weekOccupation)]);
  const average: ReportColumn = { header: labels.average, kind: 'percent' };

  const statusLabel: Record<string, string> = {
    waiting_list: labels.statusWaitingList,
    planned: labels.statusPlanned,
    in_progress: labels.statusInProgress,
    in_testing: labels.statusInTesting,
  };
  const scenarioApplies = !!options.scenario
    && (options.scenario.projectOverrides.length > 0 || options.scenario.scenarioProjects.length > 0);

  return {
    fileBase: 'roadmap-occupation',
    limited: false,
    tables: [
      {
        key: 'contributors',
        sheet: labels.contributorsSheet,
        columns: [{ header: labels.team, kind: 'text' }, { header: labels.contributor, kind: 'text' }, ...weekColumns, average],
        rows: contributorRows,
        footer: weekKeys.length === 0 ? [] : [[labels.avg, null, ...averageCells(tables.contributorAverages)]],
      },
      {
        key: 'teams',
        sheet: labels.teamsSheet,
        columns: [{ header: labels.team, kind: 'text' }, ...weekColumns, average],
        rows: teamRows,
        footer: weekKeys.length === 0 ? [] : [[labels.avg, ...averageCells(tables.teamAverages)]],
      },
    ],
    parameters: [
      [labels.startDate, options.startDate],
      [labels.statuses, options.statuses.map((status) => statusLabel[status] ?? status).join(', ')],
      [labels.capacityMode, options.capacityMode === 'historical' ? labels.capacityHistorical : labels.capacityTheoretical],
      [labels.constraintScope, options.capacityConstraintMode === 'it_only' ? labels.scopeItOnly : labels.scopeFull],
      [labels.parallelLimit, String(options.parallelizationLimit)],
      [labels.optimization, options.optimizationMode === 'completion_focused' ? labels.completionFocused : labels.priorityFocused],
      [labels.recalculateScheduled, options.includeAlreadyScheduled ? labels.yes : labels.no],
      [labels.contextSwitchPenalty, fillLabel(labels.percent, 'value', String(Math.round(options.contextSwitchPenaltyPct * 100)))],
      [labels.contextSwitchGrace, String(options.contextSwitchGrace)],
      [labels.excludedProjects, String(options.excludedProjectIds.length)],
      [labels.scenario, scenarioApplies ? labels.yes : labels.no],
    ],
  };
}
