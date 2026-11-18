import { describe, expect, it } from 'vitest';

const errors = import.meta.glob<{ default: Record<string, string> }>('./*/errors.json', { eager: true });
const common = import.meta.glob<{ default: { statuses: Record<string, string> } }>('./*/common.json', { eager: true });

// Lot I4 of 26.11.9: the contradiction of `disabled` with `-` names the status by the screen's
// label (« Désactivé »), never by the file's code.
describe('the status in an import message', () => {
  it('is the screen label, in every language', () => {
    const files = Object.entries(errors);
    expect(files).toHaveLength(4);
    for (const [path, { default: texts }] of files) {
      const label = common[path.replace('errors.json', 'common.json')].default.statuses.disabled;
      const text = texts.CSV_STATUS_DISABLED_DATE_CLEARED;
      expect(text, path).toContain(label);
      expect(text, path).not.toMatch(/\bdisabled\b/);
    }
  });

  // The two contradictions of a status with a date: the status they describe by its label, the
  // values to write as the file takes them (`-`, `enabled`, `disabled`), quoted.
  it('describes the status by its label and quotes the values to write', () => {
    const quoted = (path: string, value: string) => {
      if (path.includes('/en/')) return `"${value}"`;
      if (path.includes('/fr/')) return `« ${value} »`;
      if (path.includes('/de/')) return `„${value}“`;
      return `«${value}»`;
    };
    for (const [path, { default: texts }] of Object.entries(errors)) {
      const labels = common[path.replace('errors.json', 'common.json')].default.statuses;
      const passed = texts.CSV_STATUS_DATE_PASSED;
      expect(passed, path).toContain(quoted(path, labels.enabled));
      expect(passed, path).toContain(quoted(path, '-'));
      expect(passed, path).toContain(quoted(path, 'disabled'));
      expect(passed.match(/\b(en|dis)abled\b/g), path).toEqual(['disabled']);
      const future = texts.CSV_STATUS_DATE_FUTURE;
      expect(future, path).toContain(quoted(path, labels.disabled));
      expect(future, path).toContain(quoted(path, 'enabled'));
      expect(future.match(/\b(en|dis)abled\b/g), path).toEqual(['enabled']);
    }
  });
});

// The import dialog's line of the clears ends with a period, as the lines above it; Kad's card keeps
// its own line, without one.
describe('the line of the clears in the import dialog', () => {
  it('is the card line with a period, in every language', () => {
    for (const [path, { default: texts }] of Object.entries(common)) {
      const csv = (texts as unknown as { csv: Record<string, string> }).csv;
      for (const form of ['one', 'other']) {
        expect(csv[`valuesWillBeClearedSentence_${form}`], `${path} ${form}`).toBe(`${csv[`valuesWillBeCleared_${form}`]}.`);
      }
    }
  });
});
