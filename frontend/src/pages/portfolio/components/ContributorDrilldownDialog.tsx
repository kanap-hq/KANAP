import React, { useCallback, useMemo, useRef } from 'react';
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { AgGridReact } from 'ag-grid-react';
import { useAgGridLocaleText } from '../../../components/grid/useAgGridLocaleText';
import type { ColDef } from 'ag-grid-community';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import AgGridBox from '../../../components/AgGridBox';
import { useLocale } from '../../../i18n/useLocale';
import { getProjectStatusLabel } from '../../../utils/portfolioI18n';

type ProjectBreakdownRow = {
  projectId: string;
  projectName: string;
  status: string;
  estimatedEffort: number;
  executionProgress: number;
  remainingEffort: number;
  allocationPct: number;
  contributorDays: number;
};

const formatNumber = (value: number | null | undefined, locale: string, notAvailable: string): string => {
  if (value == null || !Number.isFinite(value)) return notAvailable;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
};

const formatPercent = (value: number | null | undefined, notAvailable: string): string => {
  if (value == null || !Number.isFinite(value)) return notAvailable;
  return `${value.toFixed(1)}%`;
};

type ContributorDrilldownDialogProps = {
  open: boolean;
  contributorId: string | null;
  contributorName?: string | null;
  statuses: string[];
  onClose: () => void;
};

export default function ContributorDrilldownDialog({
  open,
  contributorId,
  contributorName,
  statuses,
  onClose,
}: ContributorDrilldownDialogProps) {
  const { t } = useTranslation('portfolio');
  const locale = useLocale();
  const gridLocaleText = useAgGridLocaleText();
  const gridApiRef = useRef<any>(null);
  const navigate = useNavigate();
  const queryKey = ['portfolio-capacity-drilldown', contributorId, statuses];
  const { data, isLoading } = useQuery<{ projects: ProjectBreakdownRow[] }>({
    queryKey,
    enabled: open && Boolean(contributorId),
    queryFn: async () => {
      if (!contributorId) return { projects: [] };
      const params: any = {};
      if (statuses?.length) params.statuses = statuses.join(',');
      const res = await api.get(`/portfolio/reports/capacity-heatmap/contributor/${contributorId}`, { params });
      return res.data;
    },
  });

  const rows = data?.projects ?? [];
  const notAvailable = t('reports.capacityHeatmap.values.notAvailable');

  const openProject = useCallback((projectId?: string) => {
    if (!projectId) return;
    onClose();
    navigate(`/portfolio/projects/${projectId}/effort`);
  }, [navigate, onClose]);

  const columns = useMemo<ColDef[]>(() => ([
    {
      field: 'projectName',
      headerName: t('dialogs.contributorDrilldown.columns.project'),
      flex: 1,
      minWidth: 220,
      cellRenderer: (p: any) => (
        <Box
          component="span"
          sx={{ cursor: 'pointer', color: 'text.primary', '&:hover': { textDecoration: 'underline' } }}
          onClick={() => openProject(p.data?.projectId)}
        >
          {p.value}
        </Box>
      ),
    },
    {
      field: 'status',
      headerName: t('dialogs.contributorDrilldown.columns.status'),
      width: 140,
      valueFormatter: (p) => getProjectStatusLabel(t, p.value),
    },
    {
      field: 'estimatedEffort',
      headerName: t('dialogs.contributorDrilldown.columns.estimatedEffort'),
      width: 130,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumber(p.value, locale, notAvailable),
    },
    {
      field: 'executionProgress',
      headerName: t('dialogs.contributorDrilldown.columns.progress'),
      width: 120,
      type: 'rightAligned',
      valueFormatter: (p) => formatPercent(p.value, notAvailable),
    },
    {
      field: 'remainingEffort',
      headerName: t('dialogs.contributorDrilldown.columns.remaining'),
      width: 130,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumber(p.value, locale, notAvailable),
    },
    {
      field: 'allocationPct',
      headerName: t('dialogs.contributorDrilldown.columns.allocationPct'),
      width: 130,
      type: 'rightAligned',
      valueFormatter: (p) => formatPercent(p.value, notAvailable),
    },
    {
      field: 'contributorDays',
      headerName: t('dialogs.contributorDrilldown.columns.contributorDays'),
      width: 120,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumber(p.value, locale, notAvailable),
    },
  ]), [locale, openProject, t]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pr: 6, fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' }}>
        {contributorName
          ? t('dialogs.contributorDrilldown.titleWithName', { name: contributorName })
          : t('dialogs.contributorDrilldown.title')}
        <IconButton
          aria-label={t('dialogs.contributorDrilldown.actions.close')}
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 1.5 }}>
        <Box component={AgGridBox} sx={{ height: '60vh', minHeight: 320, width: '100%' }}>
          <AgGridReact
            localeText={gridLocaleText}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={(e) => { gridApiRef.current = e.api; }}
            suppressNoRowsOverlay={false}
          />
        </Box>
        {isLoading && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('dialogs.contributorDrilldown.states.loadingProjects')}
          </Typography>
        )}
        {!isLoading && rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('dialogs.contributorDrilldown.states.noMatchingProjects')}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
