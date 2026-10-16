import type { TFunction } from 'i18next';

/** The editor library names each of its texts with a key ("toolbar.bold") and an English default.
 *  Its texts live in `common:markdownEditor.mdx`, so the toolbar, dialogs and tooltips follow the
 *  reader's language. A key the locale files lack still shows the library's English. */
export function markdownEditorTranslation(t: TFunction) {
  return (key: string, defaultValue: string, interpolations?: Record<string, unknown>): string =>
    t(`markdownEditor.mdx.${key}`, { ns: 'common', defaultValue, ...interpolations });
}
