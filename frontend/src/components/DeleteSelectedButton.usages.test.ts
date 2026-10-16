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
  // "Delete the selected item" names nothing: a single item is named ("Delete Acme?"), several
  // are counted. Only the shared button words a selection, and it names a single item.
  it('words the generic selection title in the shared button only, never for one item', () => {
    const users = Object.entries(files).filter(([, text]) => text.includes('deleteSelectedTitle')).map(([file]) => file);
    expect(users).toEqual(['./DeleteSelectedButton.tsx']);
    const button = files['./DeleteSelectedButton.tsx'];
    expect(button.split('deleteSelectedTitle').length - 1).toBe(1);
    expect(button).toMatch(/named\.length === 1\s*\?\s*t\('delete\.recordTitle', \{ name: named\[0\]\.name \}\)\s*:\s*t\('delete\.deleteSelectedTitle'/);
  });

  // A record page's delete window names the record ("Delete Acme?"); its unnamed title is only the
  // fallback while the name is unknown.
  it('names the record in the title of each record delete window', () => {
    const unnamed = ['workspace.connection.deleteDialog.title', 'workspace.location.deleteTitle', 'roles.dialogs.deleteTitle',
      'workspace.request.deleteDialog.title', 'dialogs.deleteLibrary.title', 'typesManager.dialogs.delete.title'];
    const lines = Object.entries(files).flatMap(([file, text]) => text.split('\n')
      .filter((line) => unnamed.some((key) => line.includes(`${key}'`)))
      .map((line) => ({ file, line: line.trim() })));
    expect(lines.length).toBe(unnamed.length);
    for (const { file, line } of lines) expect(line, file).toContain("t('common:delete.recordTitle', { name:");
  });

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
