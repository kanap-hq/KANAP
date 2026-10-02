import React from 'react';
import { Box, Paper, type PaperProps } from '@mui/material';
import { useTranslation } from 'react-i18next';

/** What a lookup picker hands its list (`slotProps.paper`): more matches exist than the page shows. */
export type LookupListPaperProps = PaperProps & { moreResults?: boolean };

const moreResultsSx = { px: '14px', py: '6px', fontSize: 12, lineHeight: 1.35, color: 'kanap.text.tertiary' } as const;

/** The quiet last line of a lookup list whose page does not hold every match. */
export function MoreResultsHint() {
  const { t } = useTranslation('common');
  return (
    <Box
      role="presentation"
      // Keeps the focus in the field, like the list's own "no options" line.
      onMouseDown={(event) => event.preventDefault()}
      sx={moreResultsSx}
    >
      {t('selects.moreResults')}
    </Box>
  );
}

/**
 * The popup of a lookup picker (`PaperComponent`): the list, then the hint to
 * type more when the server holds more matches than the page shows.
 */
const LookupListPaper = React.forwardRef<HTMLDivElement, LookupListPaperProps>(function LookupListPaper(
  { moreResults, children, ...props },
  ref,
) {
  return (
    <Paper ref={ref} {...props}>
      {children}
      {moreResults ? <MoreResultsHint /> : null}
    </Paper>
  );
});

export default LookupListPaper;
