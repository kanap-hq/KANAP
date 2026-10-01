import React from 'react';
import { Box, Tab, Tabs, IconButton, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useTranslation } from 'react-i18next';

interface YearTabsProps {
  currentYear: number;
  availableYears?: number[];
  onYearChange: (year: number) => void;
  disabled?: boolean;
}

export default function YearTabs({
  currentYear,
  availableYears = [],
  onYearChange,
  disabled = false
}: YearTabsProps) {
  const { t } = useTranslation('common');
  // Generate years around current year if no availableYears provided
  const allYears = availableYears.length > 0
    ? availableYears
    : Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const sortedYears = [...allYears].sort((a, b) => a - b);
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
        {visibleYears.map((year) => (
          <Tab
            key={year}
            label={year.toString()}
            value={year}
            disabled={disabled}
          />
        ))}
      </Tabs>

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