import { beforeAll, describe, expect, it } from 'vitest';
import i18n, { i18nReady } from '../../i18n';
import { formatFigure, formatLocaleFigure } from './figures';

const NBSP = '\u00a0';

describe('formatFigure', () => {
  it('writes a decimal comma in French, German and Spanish, and a point in English', () => {
    expect(formatFigure(6.5, 'fr', 1)).toBe('6,5');
    expect(formatFigure(0.3, 'de', 1)).toBe('0,3');
    expect(formatFigure(0.3, 'es', 1)).toBe('0,3');
    expect(formatFigure(6.5, 'en', 1)).toBe('6.5');
    expect(formatFigure(20, 'fr', 1)).toBe('20');
    expect(formatFigure(2, 'en', 2)).toBe('2');
  });

  it('keeps the English fixed decimals and drops trailing zeros in the other languages', () => {
    expect(formatLocaleFigure(2, 'en', 2)).toBe('2.00');
    expect(formatLocaleFigure(2, 'en-GB', 2)).toBe('2.00');
    expect(formatLocaleFigure(1.5, 'en', 1)).toBe('1.5');
    expect(formatLocaleFigure(2, 'fr', 2)).toBe('2');
    expect(formatLocaleFigure(1.5, 'fr', 1)).toBe('1,5');
    expect(formatLocaleFigure(1.25, 'de', 2)).toBe('1,25');
    expect(formatLocaleFigure(1.5, 'es', 1)).toBe('1,5');
  });
});

describe('portfolio figures in the interface language', () => {
  beforeAll(async () => {
    await i18nReady;
  });

  function text(locale: string, key: string, values: Record<string, unknown>): string {
    return i18n.t(key, { lng: locale, ...values });
  }

  it('writes the contributor and effort figures in French and English', () => {
    expect(text('fr', 'portfolio:workspace.contributor.values.daysPerMonthShort', {
      count: formatFigure(6.5, 'fr', 1),
    })).toBe(`6,5${NBSP}j/mois`);
    expect(text('en', 'portfolio:workspace.contributor.values.daysPerMonthShort', {
      count: formatFigure(6.5, 'en', 1),
    })).toBe('6.5 d/mo');

    expect(text('fr', 'portfolio:workspace.contributor.values.averageMonthlyProjectEffort', {
      value: formatFigure(0.3, 'fr', 1),
    })).toBe(`Charge projet mensuelle moyenne (6 derniers mois)${NBSP}: 0,3${NBSP}j/mois`);
    expect(text('en', 'portfolio:workspace.contributor.values.averageMonthlyProjectEffort', {
      value: formatFigure(0.3, 'en', 1),
    })).toBe('Average monthly project effort (last 6 months): 0.3 d/mo');

    expect(text('fr', 'portfolio:workspace.project.effort.values.actualOfEstimated', {
      actual: formatFigure(0.3, 'fr', 1),
      estimated: formatFigure(20, 'fr', 1),
    })).toBe(`0,3 / 20${NBSP}JH`);
    expect(text('en', 'portfolio:workspace.project.effort.values.actualOfEstimated', {
      actual: formatFigure(0.3, 'en', 1),
      estimated: formatFigure(20, 'en', 1),
    })).toBe('0.3 / 20 MD');

    expect(text('fr', 'portfolio:workspace.project.effort.values.actualSplit', {
      project: formatFigure(1, 'fr', 1),
      task: formatFigure(0.3, 'fr', 1),
    })).toBe('(Projet 1 · Tâche 0,3)');

    expect(text('fr', 'portfolio:workspace.project.effort.values.hoursValue', {
      hours: formatLocaleFigure(2, 'fr', 2),
    })).toBe(`2${NBSP}h`);
    expect(text('en', 'portfolio:workspace.project.effort.values.hoursValue', {
      hours: formatLocaleFigure(2, 'en', 2),
    })).toBe('2.00h');

    expect(text('fr', 'portfolio:workspace.task.activity.actions.logHours', {
      hours: formatFigure(1.5, 'fr', 1),
    })).toBe(`Saisir 1,5${NBSP}h`);
    expect(text('en', 'portfolio:workspace.task.activity.actions.logHours', {
      hours: formatFigure(1.5, 'en', 1),
    })).toBe('Log 1.5h');

    expect(text('fr', 'portfolio:workspace.task.workLog.duration.hoursOnly', {
      hours: formatLocaleFigure(1.5, 'fr', 1),
    })).toBe(`1,5${NBSP}h`);
    expect(text('en', 'portfolio:workspace.task.workLog.duration.hoursOnly', {
      hours: formatLocaleFigure(1.5, 'en', 1),
    })).toBe('1.5h');
    expect(text('fr', 'portfolio:workspace.task.workLog.duration.daysHours', { days: 2, hours: 4 })).toBe(`2${NBSP}j 4${NBSP}h`);
    expect(text('en', 'portfolio:workspace.task.workLog.duration.daysHours', { days: 2, hours: 4 })).toBe('2d 4h');
  });

  it('writes the same figures with a decimal comma in German and Spanish', () => {
    expect(text('de', 'portfolio:workspace.contributor.values.daysPerMonthShort', {
      count: formatFigure(6.5, 'de', 1),
    })).toBe(`6,5${NBSP}T/Monat`);
    expect(text('es', 'portfolio:workspace.contributor.values.daysPerMonthShort', {
      count: formatFigure(6.5, 'es', 1),
    })).toBe(`6,5${NBSP}d/mes`);

    expect(text('de', 'portfolio:workspace.project.effort.values.actualOfEstimated', {
      actual: formatFigure(0.3, 'de', 1),
      estimated: formatFigure(20, 'de', 1),
    })).toBe(`0,3 / 20${NBSP}PT`);
    expect(text('es', 'portfolio:workspace.project.effort.values.actualOfEstimated', {
      actual: formatFigure(0.3, 'es', 1),
      estimated: formatFigure(20, 'es', 1),
    })).toBe(`0,3 / 20${NBSP}DP`);

    expect(text('de', 'portfolio:workspace.project.effort.values.hoursValue', {
      hours: formatLocaleFigure(2, 'de', 2),
    })).toBe(`2${NBSP}Std.`);
    expect(text('es', 'portfolio:workspace.task.activity.actions.logHours', {
      hours: formatFigure(1.5, 'es', 1),
    })).toBe(`Registrar 1,5${NBSP}h`);
    expect(text('de', 'portfolio:workspace.task.workLog.duration.daysHours', { days: 2, hours: 4 })).toBe(`2${NBSP}T 4${NBSP}Std.`);
  });
});
