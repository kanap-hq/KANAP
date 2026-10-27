import { BadRequestException } from '@nestjs/common';
import type { CsvLanguage } from '../../common/csv-sheet/types';
import type { ReportCell, ReportColumn, ReportExport } from '../../common/report-export';
import { filterContributorsByEmploymentType, UNASSIGNED_GROUP } from '../shared/contributorsOrdering';
import {
  buildSkillsMatrix,
  contributorSummary,
  orientSkillsMatrix,
  SKILLS_MATRIX_ORIENTATIONS,
  type SkillsMatrixAxis,
  type SkillsMatrixContributor,
  type SkillsMatrixOrientation,
  type SkillsMatrixSkill,
  type SkillsMatrixTeam,
} from '../shared/skillsMatrix';

/**
 * The export of the contributors' skills matrix (`GET /portfolio/team-members/skills-matrix/export`): the
 * grid the screen draws, from the same three answers (`GET /portfolio/team-members`, `/portfolio/teams`,
 * `/portfolio/skills`) and the same code (`../shared/skillsMatrix.ts`, a copy of the screen's module).
 * Levels are numbers (1 to 4, empty when none is declared); the summary column is the contributor's
 * `autonomous/declared` text or the skill's count of autonomous people; the footer row holds the summaries
 * of the column entries (text under the levels when the contributors hold the columns).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The query keys of the export besides `format`, `language` and `tz`. */
export const SKILLS_MATRIX_EXPORT_QUERY_KEYS = ['teamId', 'employmentTypeId', 'orientation', 'showUnused', 'hiddenCategories'] as const;

/** Where each label comes from in `frontend/src/locales/<lang>/portfolio.json` (checked by a spec). */
export const SKILLS_MATRIX_EXPORT_KEYS = {
  sheet: 'contributors.matrix.sheetName',
  contributor: 'contributors.matrix.export.contributor',
  reference: 'contributors.matrix.export.reference',
  team: 'contributors.matrix.export.team',
  category: 'contributors.matrix.export.category',
  skill: 'contributors.matrix.export.skill',
  summaryColumn: 'contributors.matrix.summaryColumn',
  coverageRow: 'contributors.matrix.coverageRow',
  unassigned: 'contributors.filters.unassigned',
  unknownTeam: 'contributors.teams.unknown',
  allTeams: 'contributors.filters.allTeams',
  allEmploymentTypes: 'contributors.filters.allEmploymentTypes',
  employmentType: 'workspace.contributor.fields.employmentType',
  orientation: 'contributors.matrix.orientation.label',
  orientationContributors: 'contributors.matrix.orientation.contributors',
  orientationSkills: 'contributors.matrix.orientation.skills',
  showUnused: 'contributors.matrix.showUnused',
  yes: 'activity.history.values.yes',
  no: 'activity.history.values.no',
} as const;

/** The words only the file has (the Parameters sheet), kept here in the four languages. */
type FileOnlyLabels = { hiddenCategories: string; none: string };

export type SkillsMatrixExportLabels = Record<keyof typeof SKILLS_MATRIX_EXPORT_KEYS, string> & FileOnlyLabels;

export const SKILLS_MATRIX_EXPORT_LABELS: Record<CsvLanguage, SkillsMatrixExportLabels> = {
  en: {
    sheet: 'Skills matrix',
    contributor: 'Contributor',
    reference: 'Reference',
    team: 'Team',
    category: 'Category',
    skill: 'Skill',
    summaryColumn: 'Skills',
    coverageRow: 'Autonomous or expert',
    unassigned: 'Unassigned',
    unknownTeam: 'Unknown team',
    allTeams: 'All teams',
    allEmploymentTypes: 'All contract types',
    employmentType: 'Contract type',
    orientation: 'Columns',
    orientationContributors: 'Contributors',
    orientationSkills: 'Skills',
    showUnused: 'Show unused skills',
    yes: 'Yes',
    no: 'No',
    hiddenCategories: 'Hidden categories',
    none: 'None',
  },
  fr: {
    sheet: 'Matrice de compétences',
    contributor: 'Contributeur',
    reference: 'Référence',
    team: 'Équipe',
    category: 'Catégorie',
    skill: 'Compétence',
    summaryColumn: 'Compétences',
    coverageRow: 'Autonome ou expert',
    unassigned: 'Non affectés',
    unknownTeam: 'Équipe inconnue',
    allTeams: 'Toutes les équipes',
    allEmploymentTypes: 'Tous les types de contrat',
    employmentType: 'Type de contrat',
    orientation: 'Colonnes',
    orientationContributors: 'Contributeurs',
    orientationSkills: 'Compétences',
    showUnused: 'Afficher les compétences non utilisées',
    yes: 'Oui',
    no: 'Non',
    hiddenCategories: 'Catégories masquées',
    none: 'Aucune',
  },
  de: {
    sheet: 'Kompetenzmatrix',
    contributor: 'Mitwirkender',
    reference: 'Referenz',
    team: 'Team',
    category: 'Kategorie',
    skill: 'Kompetenz',
    summaryColumn: 'Kompetenzen',
    coverageRow: 'Eigenständig oder Experte',
    unassigned: 'Nicht zugeordnet',
    unknownTeam: 'Unbekanntes Team',
    allTeams: 'Alle Teams',
    allEmploymentTypes: 'Alle Vertragsarten',
    employmentType: 'Vertragsart',
    orientation: 'Spalten',
    orientationContributors: 'Mitwirkende',
    orientationSkills: 'Kompetenzen',
    showUnused: 'Nicht genutzte Kompetenzen anzeigen',
    yes: 'Ja',
    no: 'Nein',
    hiddenCategories: 'Ausgeblendete Kategorien',
    none: 'Keine',
  },
  es: {
    sheet: 'Matriz de competencias',
    contributor: 'Colaborador',
    reference: 'Referencia',
    team: 'Equipo',
    category: 'Categoría',
    skill: 'Competencia',
    summaryColumn: 'Competencias',
    coverageRow: 'Autónomo o experto',
    unassigned: 'Sin asignar',
    unknownTeam: 'Equipo desconocido',
    allTeams: 'Todos los equipos',
    allEmploymentTypes: 'Todos los tipos de contrato',
    employmentType: 'Tipo de contrato',
    orientation: 'Columnas',
    orientationContributors: 'Colaboradores',
    orientationSkills: 'Competencias',
    showUnused: 'Mostrar competencias sin uso',
    yes: 'Sí',
    no: 'No',
    hiddenCategories: 'Categorías ocultas',
    none: 'Ninguna',
  },
};

export interface SkillsMatrixExportQuery {
  /** 'all', 'unassigned' or a team id. */
  teamId: string;
  /** 'all' or a contract type id. */
  employmentTypeId: string;
  orientation: SkillsMatrixOrientation;
  showUnused: boolean;
  hiddenCategories: string[];
}

/** The matrix parameters of the request; a value the screen cannot send is a 400. */
export function skillsMatrixExportQuery(query: Record<string, unknown> | null | undefined): SkillsMatrixExportQuery {
  const source = query ?? {};
  const text = (key: string): string | undefined => {
    const value = source[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new BadRequestException(`${key} must be given once.`);
    return value.trim();
  };

  const teamId = text('teamId') || 'all';
  if (teamId !== 'all' && teamId !== UNASSIGNED_GROUP && !UUID.test(teamId)) {
    throw new BadRequestException("teamId must be 'all', 'unassigned' or a team id.");
  }
  const employmentTypeId = text('employmentTypeId') || 'all';
  if (employmentTypeId !== 'all' && !UUID.test(employmentTypeId)) {
    throw new BadRequestException("employmentTypeId must be 'all' or a contract type id.");
  }
  const orientation = (text('orientation') || 'contributors') as SkillsMatrixOrientation;
  if (!SKILLS_MATRIX_ORIENTATIONS.includes(orientation)) {
    throw new BadRequestException(`orientation must be one of ${SKILLS_MATRIX_ORIENTATIONS.join(', ')}.`);
  }
  const showUnusedText = text('showUnused') || 'false';
  if (showUnusedText !== 'true' && showUnusedText !== 'false') throw new BadRequestException('showUnused must be true or false.');

  // Category names may hold commas: the list comes as one JSON-encoded array of strings.
  const hiddenText = text('hiddenCategories');
  let hiddenCategories: string[] = [];
  if (hiddenText) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(hiddenText);
    } catch {
      throw new BadRequestException('hiddenCategories must be a JSON list of category names.');
    }
    if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== 'string')) {
      throw new BadRequestException('hiddenCategories must be a JSON list of category names.');
    }
    hiddenCategories = parsed as string[];
  }

  return { teamId, employmentTypeId, orientation, showUnused: showUnusedText === 'true', hiddenCategories };
}

export type SkillsMatrixExportContributor = SkillsMatrixContributor & { employment_type_id?: string | null };

export interface SkillsMatrixExportData {
  contributors: SkillsMatrixExportContributor[];
  teams: SkillsMatrixTeam[];
  skills: SkillsMatrixSkill[];
  /** The name of the contract type of the filter, when it names one. */
  employmentTypeName: string | null;
}

export function skillsMatrixExport(
  data: SkillsMatrixExportData,
  parsed: SkillsMatrixExportQuery,
  language: CsvLanguage,
): ReportExport {
  const labels = SKILLS_MATRIX_EXPORT_LABELS[language];
  const matrix = buildSkillsMatrix({
    contributors: filterContributorsByEmploymentType(data.contributors, parsed.employmentTypeId),
    teams: data.teams,
    skills: data.skills,
    teamId: parsed.teamId,
    showUnused: parsed.showUnused,
    hiddenCategories: parsed.hiddenCategories,
    words: { unassigned: labels.unassigned, unknownTeam: labels.unknownTeam },
    compare: new Intl.Collator(language).compare,
  });
  const { columns, rows, levelAt } = orientSkillsMatrix(matrix, parsed.orientation);

  const summaryLabel = (axis: SkillsMatrixAxis) => (axis.kind === 'contributor' ? labels.summaryColumn : labels.coverageRow);
  // A contributor's summary is `autonomous/declared` text, a skill's the count of autonomous people.
  const summaryCell = (axis: SkillsMatrixAxis, index: number): ReportCell => {
    if (axis.kind === 'contributor') return contributorSummary(axis.entries[index].counts) || null;
    return { kind: 'number', value: axis.entries[index].counts.autonomous };
  };
  const leadHeaders = rows.kind === 'contributor' ? [labels.contributor, labels.reference, labels.team] : [labels.category, labels.skill];

  const tableColumns: ReportColumn[] = [
    ...leadHeaders.map((header): ReportColumn => ({ header, kind: 'text' })),
    ...columns.entries.map((entry): ReportColumn => ({ header: entry.label, kind: 'number' })),
    { header: summaryLabel(rows), kind: rows.kind === 'contributor' ? 'text' : 'number' },
  ];

  const leadCells = (index: number): ReportCell[] => {
    if (rows.kind === 'contributor') {
      const entry = rows.entries[index];
      return [entry.label, `CTR-${entry.itemNumber}`, entry.teamLabel];
    }
    const entry = rows.entries[index];
    return [entry.category, entry.label];
  };

  const tableRows: ReportCell[][] = rows.entries.map((rowEntry, index) => [
    ...leadCells(index),
    ...columns.entries.map((columnEntry): ReportCell => {
      const level = levelAt(rowEntry.id, columnEntry.id);
      return level ? { kind: 'number', value: level } : null;
    }),
    summaryCell(rows, index),
  ]);

  const footer: ReportCell[][] = columns.entries.length === 0 ? [] : [[
    summaryLabel(columns),
    ...leadHeaders.slice(1).map(() => null),
    ...columns.entries.map((_, index) => summaryCell(columns, index)),
    null,
  ]];

  const teamValue = parsed.teamId === 'all'
    ? labels.allTeams
    : parsed.teamId === UNASSIGNED_GROUP
      ? labels.unassigned
      : data.teams.find((team) => team.id === parsed.teamId)?.name || labels.unknownTeam;
  const employmentValue = parsed.employmentTypeId === 'all'
    ? labels.allEmploymentTypes
    : data.employmentTypeName ?? parsed.employmentTypeId;

  return {
    fileBase: 'skills-matrix',
    limited: false,
    tables: [{ key: 'matrix', sheet: labels.sheet, columns: tableColumns, rows: tableRows, footer }],
    parameters: [
      [labels.team, teamValue],
      [labels.employmentType, employmentValue],
      [labels.orientation, parsed.orientation === 'contributors' ? labels.orientationContributors : labels.orientationSkills],
      [labels.showUnused, parsed.showUnused ? labels.yes : labels.no],
      [labels.hiddenCategories, parsed.hiddenCategories.length > 0 ? parsed.hiddenCategories.join(', ') : labels.none],
    ],
  };
}
