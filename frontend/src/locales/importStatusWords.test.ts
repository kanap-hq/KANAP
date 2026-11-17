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
