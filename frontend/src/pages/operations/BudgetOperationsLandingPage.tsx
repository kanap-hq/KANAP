import React from 'react';
import { Grid, Card, CardContent, CardActionArea, Typography, Box } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth/AuthContext';
import { canUseOperation } from './operationAccess';

type OperationCard = {
  title: string;
  description: string;
  to: string;
};

type OperationSection = {
  key: string;
  title: string;
  cards: OperationCard[];
};

const sectionTitleSx = { fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' } as const;

export default function BudgetOperationsLandingPage() {
  const { t } = useTranslation(['ops']);
  const { hasLevel } = useAuth();

  const sections: OperationSection[] = [
    {
      key: 'settings',
      title: t('operations.sections.settings'),
      cards: [
        { title: t('operations.cards.currencyTitle'), description: t('operations.cards.currencyDesc'), to: '/ops/operations/currency' },
        { title: t('operations.cards.budgetColumnsTitle'), description: t('operations.cards.budgetColumnsDesc'), to: '/ops/operations/columns' },
        { title: t('operations.cards.allocationDefaultTitle'), description: t('operations.cards.allocationDefaultDesc'), to: '/ops/operations/allocation-default' },
      ],
    },
    {
      key: 'operations',
      title: t('operations.sections.operations'),
      cards: [
        { title: t('operations.cards.freezeTitle'), description: t('operations.cards.freezeDesc'), to: '/ops/operations/freeze' },
        { title: t('operations.cards.copyBudgetTitle'), description: t('operations.cards.copyBudgetDesc'), to: '/ops/operations/copy-budget-columns' },
        { title: t('operations.cards.copyAllocTitle'), description: t('operations.cards.copyAllocDesc'), to: '/ops/operations/copy-allocations' },
        { title: t('operations.cards.resetColumnTitle'), description: t('operations.cards.resetColumnDesc'), to: '/ops/operations/column-reset' },
        { title: t('operations.cards.masterDataFreezeTitle'), description: t('operations.cards.masterDataFreezeDesc'), to: '/ops/operations/master-data-freeze' },
        { title: t('operations.cards.metricsCopyTitle'), description: t('operations.cards.metricsCopyDesc'), to: '/ops/operations/metrics-copy' },
      ],
    },
  ];

  // A tile shows only when the user can use its page; a section left without a tile is not shown.
  const visibleSections = sections
    .map((section) => ({
      ...section,
      cards: section.cards.filter((card) => canUseOperation(card.to.split('/').pop() ?? '', hasLevel)),
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
