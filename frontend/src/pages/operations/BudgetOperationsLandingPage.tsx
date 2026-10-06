import React from 'react';
import { Grid, Card, CardContent, CardActionArea, Typography, Box } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth/AuthContext';

type OperationCard = {
  title: string;
  description: string;
  to: string;
  /** Shown to a reader of any of these resources, like the sidebar's `anyResource`. */
  anyResource: string[];
};

type OperationSection = {
  key: string;
  title: string;
  cards: OperationCard[];
};

/** Every `/ops/operations/*` route opens for OPEX readers (ProtectedRoute). */
const OPS_ROUTE_RESOURCES = ['opex'];
/** The currency settings follow the currency API: budget, OPEX or CAPEX readers. */
const CURRENCY_RESOURCES = ['budget_ops', 'opex', 'capex'];

const sectionTitleSx = { fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' } as const;

export default function BudgetOperationsLandingPage() {
  const { t } = useTranslation(['ops']);
  const { hasLevel } = useAuth();

  const sections: OperationSection[] = [
    {
      key: 'settings',
      title: t('operations.sections.settings'),
      cards: [
        { title: t('operations.cards.currencyTitle'), description: t('operations.cards.currencyDesc'), to: '/ops/operations/currency', anyResource: CURRENCY_RESOURCES },
        { title: t('operations.cards.budgetColumnsTitle'), description: t('operations.cards.budgetColumnsDesc'), to: '/ops/operations/columns', anyResource: OPS_ROUTE_RESOURCES },
        { title: t('operations.cards.allocationDefaultTitle'), description: t('operations.cards.allocationDefaultDesc'), to: '/ops/operations/allocation-default', anyResource: OPS_ROUTE_RESOURCES },
      ],
    },
    {
      key: 'operations',
      title: t('operations.sections.operations'),
      cards: [
        { title: t('operations.cards.freezeTitle'), description: t('operations.cards.freezeDesc'), to: '/ops/operations/freeze', anyResource: OPS_ROUTE_RESOURCES },
        { title: t('operations.cards.copyBudgetTitle'), description: t('operations.cards.copyBudgetDesc'), to: '/ops/operations/copy-budget-columns', anyResource: OPS_ROUTE_RESOURCES },
        { title: t('operations.cards.copyAllocTitle'), description: t('operations.cards.copyAllocDesc'), to: '/ops/operations/copy-allocations', anyResource: OPS_ROUTE_RESOURCES },
        { title: t('operations.cards.resetColumnTitle'), description: t('operations.cards.resetColumnDesc'), to: '/ops/operations/column-reset', anyResource: OPS_ROUTE_RESOURCES },
        { title: t('operations.cards.masterDataFreezeTitle'), description: t('operations.cards.masterDataFreezeDesc'), to: '/ops/operations/master-data-freeze', anyResource: OPS_ROUTE_RESOURCES },
        { title: t('operations.cards.metricsCopyTitle'), description: t('operations.cards.metricsCopyDesc'), to: '/ops/operations/metrics-copy', anyResource: OPS_ROUTE_RESOURCES },
      ],
    },
  ];

  // Tiles follow the reader's rights; a section left without a tile is not shown.
  const visibleSections = sections
    .map((section) => ({
      ...section,
      cards: section.cards.filter((card) => card.anyResource.some((resource) => hasLevel(resource, 'reader'))),
    }))
    .filter((section) => section.cards.length > 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t('operations.title')} />
      <Typography variant="body1" sx={{ color: 'text.secondary' }}>
        {t('operations.subtitle')}
      </Typography>
      {visibleSections.map((section) => (
        <Box key={section.key} component="section" aria-labelledby={`ops-section-${section.key}`} sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
          <Typography id={`ops-section-${section.key}`} component="h2" sx={sectionTitleSx}>
            {section.title}
          </Typography>
          <Grid container spacing={2}>
            {section.cards.map((c) => (
              <Grid key={c.to} item xs={12} sm={6} md={4} lg={3}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardActionArea component={RouterLink} to={c.to} sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{c.title}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {c.description}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Box>
  );
}
