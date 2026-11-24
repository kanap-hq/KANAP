import React from 'react';
import { Box, Tab, Tabs, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useTranslation } from 'react-i18next';
import { attentionDotSx } from '../../theme/formSx';

interface YearTabsProps {
  currentYear: number;
  availableYears?: number[];
  onYearChange: (year: number) => void;
  disabled?: boolean;
  /** An orange dot on the years that hold something to check, its text in a tooltip and as the tab's description (the tab's name stays the year). */
  marks?: Partial<Record<number, string>>;
}

export default function YearTabs({
  currentYear,
  availableYears = [],
  onYearChange,
  disabled = false,
  marks,
}: YearTabsProps) {
  const { t } = useTranslation('common');
  const markId = React.useId();
  // The year whose mark shows its sentence: under the pointer, or its tab under the keyboard focus.
  const [hoveredMark, setHoveredMark] = React.useState<number | null>(null);
  const [focusedTab, setFocusedTab] = React.useState<number | null>(null);
  // Generate years around current year if no availableYears provided. The current year is always one
  // of them: a page opened on a year outside the list still shows it selected.
  const allYears = availableYears.length > 0
    ? [...availableYears, currentYear]
    : Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const sortedYears = [...new Set(allYears)].sort((a, b) => a - b);
  const currentIndex = sortedYears.indexOf(currentYear);

  // Show 5 tabs centered around current year
  const getVisibleYears = () => {
    if (sortedYears.length <= 5) return sortedYears;

    let start = Math.max(0, currentIndex - 2);
    let end = Math.min(sortedYears.length, start + 5);

    // Adjust if we can't show 5 years
    if (end - start < 5) {
      start = Math.max(0, end - 5);
    }

    return sortedYears.slice(start, end);
  };

  const visibleYears = getVisibleYears();

  const handlePrevYear = () => {
    if (currentIndex > 0) {
      onYearChange(sortedYears[currentIndex - 1]);
    }
  };

  const handleNextYear = () => {
    if (currentIndex < sortedYears.length - 1) {
      onYearChange(sortedYears[currentIndex + 1]);
    }
  };

  const handleTabChange = (_: React.SyntheticEvent, newYear: number) => {
    onYearChange(newYear);
  };

  if (sortedYears.length <= 1) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 1 }}>
        <Typography variant="subtitle1" color="text.secondary">
          {t('yearTabs.single', { year: currentYear })}
        </Typography>
      </Box>
    );
  }

  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%', justifyContent: 'center' }}>
      <IconButton
        onClick={handlePrevYear}
        disabled={disabled || currentIndex <= 0}
        size="small"
        sx={{ minWidth: 'auto' }}
        aria-label={t('yearTabs.previous')}
      >
        <ArrowBackIcon />
      </IconButton>

      <Tabs
        value={currentYear}
        onChange={handleTabChange}
        variant="standard"
        sx={{
          minHeight: 40,
          '& .MuiTab-root': {
            minHeight: 40,
            minWidth: 60,
            fontSize: '0.875rem'
          }
        }}
      >
        {visibleYears.map((year) => {
          const mark = marks?.[year];
          return (
            <Tab
              key={year}
              label={mark ? (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  {year}
                  <Tooltip
                    title={mark}
                    describeChild
                    // Above the tabs, where nothing shows: below, it covered the column cards' titles.
                    placement="top"
                    open={hoveredMark === year || focusedTab === year}
                    onOpen={() => setHoveredMark(year)}
                    onClose={() => setHoveredMark((y) => (y === year ? null : y))}
                  >
                    <Box component="span" aria-hidden data-testid={`year-mark-${year}`} sx={attentionDotSx} />
                  </Tooltip>
                </Box>
              ) : year.toString()}
              aria-describedby={mark ? `${markId}-${year}` : undefined}
              onFocusVisible={mark ? () => setFocusedTab(year) : undefined}
              onBlur={mark ? () => setFocusedTab((y) => (y === year ? null : y)) : undefined}
              value={year}
              disabled={disabled}
            />
          );
        })}
      </Tabs>
      {/* The marks as the tabs' descriptions: read by a screen reader with the tab, never part of its name. */}
      {visibleYears.filter((year) => marks?.[year]).map((year) => (
        <Box key={year} component="span" id={`${markId}-${year}`} hidden>{marks?.[year]}</Box>
      ))}

      <IconButton
        onClick={handleNextYear}
        disabled={disabled || currentIndex >= sortedYears.length - 1}
        size="small"
        sx={{ minWidth: 'auto' }}
        aria-label={t('yearTabs.next')}
      >
        <ArrowForwardIcon />
      </IconButton>
    </Stack>
  );
}