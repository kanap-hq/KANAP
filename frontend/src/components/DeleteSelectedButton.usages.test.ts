import { describe, expect, it } from 'vitest';

// Every component of the app as text, tests left out.
const files = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });

/** Each `<DeleteSelectedButton ... />` of the app, with the file it is in. */
function usages(): Array<{ file: string; element: string }> {
  return Object.entries(files).flatMap(([file, text]) => {
    const found: Array<{ file: string; element: string }> = [];
    let at = text.indexOf('<DeleteSelectedButton');
    while (at >= 0) {
      const end = text.indexOf('/>', at);
      found.push({ file, element: text.slice(at, end) });
      at = text.indexOf('<DeleteSelectedButton', end);
    }
    return found;
  });
}

describe('DeleteSelectedButton usages', () => {
  it('finds the lists that delete a selection', () => {
    expect(usages().length).toBeGreaterThan(15);
  });

  // The generic warning ("if the item is referenced elsewhere, the delete is blocked") is for no
  // list: each asks the check before its confirmation, or says what goes with its items.
  it('each asks the check before the confirmation or gives its own warning', () => {
    const generic = usages()
      .filter(({ element }) => (!/\bcheckDelete=\{/.test(element) && !/\bwarning=\{/.test(element)) || element.includes('warningMessage'))
      .map(({ file }) => file);
    expect(generic).toEqual([]);
  });
});
