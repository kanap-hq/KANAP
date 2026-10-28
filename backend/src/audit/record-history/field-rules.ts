import type { FamilyKey } from './families';

/**
 * The allow-lists of the history, and the two ways a field is declared.
 *
 * A record file (`records/<table>.ts`) owns the allow-list of its own audit labels and of its
 * children's labels. A field is shown (optionally as a reference of a family), or hidden with the
 * reason a reader will never see it. A field absent from a label's list is dropped, so a payload
 * key the history does not know never comes out.
 */
export type HistoryFieldRule = {
  family?: FamilyKey;
  hidden?: string;
  /**
   * The word that stands for the change of a hidden field, in the reader's language: a document
   * body says "Content changed" and never its text. Absent, the field never becomes a change.
   */
  changedWord?: string;
};

/** The allow-list of one audit label: a field absent from it is never copied from a payload. */
export type HistoryFields = Readonly<Record<string, HistoryFieldRule>>;

/** A field the record shows, resolved as a reference of `family` when it names another record. */
export const shown = (family?: FamilyKey): HistoryFieldRule => (family ? { family } : {});

/** A field the history never presents, with the reason written for the next reader. */
export const hidden = (reason: string): HistoryFieldRule => ({ hidden: reason });

/**
 * A field whose value is never presented but whose change is: the fixed word `word` stands for it
 * (the history reads `auditLogs.history.texts.<word>`). A document body has its versions for the
 * text; the history only says that the content changed.
 */
export const hiddenChanged = (reason: string, word: string): HistoryFieldRule => ({ hidden: reason, changedWord: word });
