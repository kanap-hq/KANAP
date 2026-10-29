import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  CircularProgress,
  Alert,
  SelectChangeEvent,
  ButtonGroup,
  Button,
  Typography,
  FormControlLabel,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import PageHeader from '../../components/PageHeader';
import LightModeIsland from '../../components/LightModeIsland';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { PortfolioGantt } from './components/PortfolioGantt';
import RoadmapGenerator from './components/RoadmapGenerator';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useLocale } from '../../i18n/useLocale';

interface TimelineData {
  projects: Array<{
    id: string;
    name: string;
    status: string;
    category_id: string | null;
    planned_start: string | null;
    planned_end: string | null;
    execution_progress: number;
  }>;
  dependencies: Array<{
    id: string;
    project_id: string;
    depends_on_project_id: string;
    dependency_type: string;
  }>;
  milestones: Array<{
    id: string;
    project_id: string;
    name: string;
    target_date: string;
    status: string;
    project_name: string;
  }>;
  viewStart: string;
}

interface Category {
  id: string;
  name: string;
}

// Helper to format the current view period
const formatViewPeriod = (monthOffset: number, months: number, locale: string): string => {
  const now = new Date();
  const pastMonths = Math.max(0, Math.round(months * 0.25));
  const start = new Date(now);
  start.setMonth(start.getMonth() + monthOffset - pastMonths);
  start.setDate(1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);
  end.setDate(0);

  const startStr = start.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
  const endStr = end.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
  return `${startStr} - ${endStr}`;
};

export default function PlanningPage() {
  const { t } = useTranslation(['portfolio', 'errors']);
  const { hasLevel } = useAuth();
  const canEditProjectDates = hasLevel('portfolio_projects', 'contributor');
  const locale = useLocale();
  const [planningView, setPlanningView] = useState<'timeline' | 'roadmap'>('timeline');
  const [months, setMonths] = useState(3);
  const [monthOffset, setMonthOffset] = useState(0); // Offset from current month
  const [category, setCategory] = useState<string>('');
  const [status, setStatus] = useState<string[]>(['planned', 'in_progress', 'in_testing']);
  const [showMilestones, setShowMilestones] = useState(true);

  const statusOptions = [
    { value: 'waiting_list', label: t('statuses.project.waiting_list') },
    { value: 'planned', label: t('statuses.project.planned') },
    { value: 'in_progress', label: t('statuses.project.in_progress') },
    { value: 'in_testing', label: t('statuses.project.in_testing') },
    { value: 'on_hold', label: t('statuses.project.on_hold') },
    { value: 'done', label: t('statuses.project.done') },
  ];

  const monthOptions = [
    { value: 1, label: t('planning.timeRanges.oneMonth') },
    { value: 3, label: t('planning.timeRanges.threeMonths') },
    { value: 6, label: t('planning.timeRanges.sixMonths') },
    { value: 12, label: t('planning.timeRanges.oneYear') },
  ];

  // Fetch timeline data
  const { data: timelineData, isLoading, error, refetch } = useQuery({
    queryKey: ['portfolio-timeline', months, category, status],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('months', String(months));
      if (category) params.append('category', category);
      status.forEach(s => params.append('status', s));

      const res = await api.get(`/portfolio/projects/planning/timeline?${params.toString()}`);
      return res.data as TimelineData;
    },
    enabled: planningView === 'timeline',
  });

  // Fetch categories for filter - correct endpoint path
  const { data: categories } = useQuery({
    queryKey: ['portfolio-categories'],
    queryFn: async () => {
      const res = await api.get('/portfolio/classification/categories');
      return (res.data || []) as Category[];
    },
    enabled: planningView === 'timeline',
  });

  const handleRefetch = useCallback(() => {
    refetch();
  }, [refetch]);

  const loadErrorMessage = error
    ? getApiErrorMessage(error, t, t('planning.messages.loadFailed'))
    : null;

  const handleMonthsChange = (e: SelectChangeEvent<number>) => {
    setMonths(Number(e.target.value));
  };

  const handleCategoryChange = (e: SelectChangeEvent<string>) => {
    setCategory(e.target.value);
  };

  const handleStatusChange = (e: SelectChangeEvent<string[]>) => {
    const value = e.target.value;
    setStatus(typeof value === 'string' ? value.split(',') : value);
  };

  return (
    <Box>
      <PageHeader title={t('planning.title')} />

      <Stack direction="row" spacing={2} sx={{ px: 3, pb: 2 }}>
        <ToggleButtonGroup
          size="small"
          value={planningView}
          exclusive
          onChange={(_, value) => {
            if (value) setPlanningView(value);
          }}
        >
          <ToggleButton value="timeline">{t('planning.views.timeline')}</ToggleButton>
          <ToggleButton value="roadmap">{t('planning.views.roadmap')}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {planningView === 'timeline' && (
        <>
          {/* Filters and Navigation */}
          <Stack
            direction="row"
            spacing={2}
            sx={{ px: 3, pb: 2 }}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            {/* Time Navigation */}
            <ButtonGroup size="small" variant="outlined">
              <Button onClick={() => setMonthOffset(o => o - 1)} title={t('planning.navigation.backOneMonth')}>
                <ChevronLeftIcon fontSize="small" />
              </Button>
              <Button
                onClick={() => setMonthOffset(0)}
                disabled={monthOffset === 0}
                title={t('planning.navigation.today')}
              >
                <TodayIcon fontSize="small" />
              </Button>
              <Button onClick={() => setMonthOffset(o => o + 1)} title={t('planning.navigation.forwardOneMonth')}>
                <ChevronRightIcon fontSize="small" />
              </Button>
            </ButtonGroup>

            <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: 140 }}>
              {formatViewPeriod(monthOffset, months, locale)}
            </Typography>

            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>{t('planning.filters.timeRange')}</InputLabel>
              <Select
                value={months}
                label={t('planning.filters.timeRange')}
                onChange={handleMonthsChange}
              >
                {monthOptions.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t('planning.filters.category')}</InputLabel>
              <Select
                value={category}
                label={t('planning.filters.category')}
                onChange={handleCategoryChange}
              >
                <MenuItem value="">{t('planning.filters.allCategories')}</MenuItem>
                {(categories || []).map(cat => (
                  <MenuItem key={cat.id} value={cat.id}>{cat.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>{t('planning.filters.status')}</InputLabel>
              <Select
                multiple
                value={status}
                label={t('planning.filters.status')}
                onChange={handleStatusChange}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((value) => {
                      const opt = statusOptions.find(o => o.value === value);
                      return (
                        <Box component="span" key={value} sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
                          {opt?.label || value}
                        </Box>
                      );
                    })}
                  </Box>
                )}
              >
                {statusOptions.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch
                  checked={showMilestones}
                  onChange={(e) => setShowMilestones(e.target.checked)}
                  size="small"
                />
              }
              label={t('planning.filters.milestones')}
              sx={{ ml: 1 }}
            />
          </Stack>

          {/* Content */}
          <Box sx={{ px: 3 }}>
            {isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress />
              </Box>
            )}

            {loadErrorMessage && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {loadErrorMessage}
              </Alert>
            )}

            {!isLoading && !error && timelineData && (
              <LightModeIsland sx={{ height: 'calc(100vh - 320px)', minHeight: 320, overflow: 'hidden' }}>
                <PortfolioGantt
                  projects={timelineData.projects ?? []}
                  dependencies={timelineData.dependencies ?? []}
                  milestones={showMilestones ? (timelineData.milestones ?? []) : []}
                  onUpdate={handleRefetch}
                  months={months}
                  monthOffset={monthOffset}
                  readOnly={!canEditProjectDates}
                />
              </LightModeIsland>
            )}
          </Box>
        </>
      )}

      {planningView === 'roadmap' && (
        <Box sx={{ px: 3, pb: 2 }}>
          <RoadmapGenerator onApplied={handleRefetch} />
        </Box>
      )}
    </Box>
  );
}
