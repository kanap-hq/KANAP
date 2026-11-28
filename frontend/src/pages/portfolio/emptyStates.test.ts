import { describe, expect, it } from 'vitest';
import dePortfolio from '../../locales/de/portfolio.json';
import enPortfolio from '../../locales/en/portfolio.json';
import esPortfolio from '../../locales/es/portfolio.json';
import frPortfolio from '../../locales/fr/portfolio.json';

const EMPTY_LINES: Array<[string, Record<string, string>]> = [
  ['settings.skills.empty', {
    en: 'No skills yet.',
    fr: 'Aucune compétence pour le moment.',
    de: 'Noch keine Kompetenzen.',
    es: 'Aún no hay competencias.',
  }],
  ['settings.teams.empty', {
    en: 'No teams yet.',
    fr: 'Aucune équipe pour le moment.',
    de: 'Noch keine Teams.',
    es: 'Aún no hay equipos.',
  }],
  ['workspace.project.effort.states.noTimeLogged', {
    en: 'No time logged yet.',
    fr: 'Aucun temps enregistré pour le moment.',
    de: 'Noch keine Zeit erfasst.',
    es: 'Aún no se ha registrado tiempo.',
  }],
  ['workspace.project.timeline.states.noMilestones', {
    en: 'No milestones yet.',
    fr: 'Aucun jalon pour le moment.',
    de: 'Noch keine Meilensteine.',
    es: 'Aún no hay hitos.',
  }],
  ['contributors.states.empty', {
    en: 'No contributors yet.',
    fr: 'Aucun contributeur pour le moment.',
    de: 'Noch keine Mitwirkenden.',
    es: 'Aún no hay colaboradores.',
  }],
];

const portfolios = { en: enPortfolio, fr: frPortfolio, de: dePortfolio, es: esPortfolio };

function readLocale(root: unknown, path: string): unknown {
  return path.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), root);
}

describe('portfolio empty states', () => {
  it('keeps the five empty states to one short line in each language', () => {
    for (const [path, expected] of EMPTY_LINES) {
      for (const [lang, sentence] of Object.entries(expected)) {
        expect(readLocale(portfolios[lang as keyof typeof portfolios], path), `${lang} ${path}`).toBe(sentence);
      }
    }
  });
});
