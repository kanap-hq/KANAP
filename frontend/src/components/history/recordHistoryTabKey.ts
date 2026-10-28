/**
 * The route and tab key of a record page's History tab: last in the tab row, and the value
 * `routeTab` takes when the history shows. Kept in its own module so a page can name the key
 * without loading the history itself.
 */
export const RECORD_HISTORY_TAB_KEY = 'history';

export type RecordHistoryTabKey = typeof RECORD_HISTORY_TAB_KEY;
