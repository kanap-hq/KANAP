import { Box } from '@mui/material';
import RecordHistory, { type RecordHistoryProps } from './RecordHistory';
import { RECORD_HISTORY_TAB_KEY } from './recordHistoryTabKey';

export { RECORD_HISTORY_TAB_KEY };
export type { RecordHistoryTabKey } from './recordHistoryTabKey';

/**
 * The body of a record page's History tab: the shared record history, inset as the tab row leaves
 * the other tabs. A page with a tab row declares the tab last and renders this component when its
 * route tab is `RECORD_HISTORY_TAB_KEY`; a page without a tab row uses `RecordHistory` in its
 * header panel (`PortfolioDetailWorkspaceShell`).
 */
export function RecordHistoryTab({ table, recordId }: RecordHistoryProps) {
  return (
    <Box sx={{ pt: 1 }}>
      <RecordHistory table={table} recordId={recordId} />
    </Box>
  );
}

export default RecordHistoryTab;
