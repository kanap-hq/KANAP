import React from 'react';
import { Grid, Card, CardContent, CardActionArea, Typography, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';

type OperationCard = {
  title: string;
  description: string;
  to: string;
};

// cards defined inside component for i18n

export default function BudgetOperationsLandingPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(['ops']);
  const cards: OperationCard[] = [
    { title: t('operations.cards.freezeTitle'), description: t('operations.cards.freezeDesc'), to: '/ops/operations/freeze' },
    { title: t('operations.cards.copyBudgetTitle'), description: t('operations.cards.copyBudgetDesc'), to: '/ops/operations/copy-budget-columns' },
    { title: t('operations.cards.copyAllocTitle'), description: t('operations.cards.copyAllocDesc'), to: '/ops/operations/copy-allocations' },
    { title: t('operations.cards.resetColumnTitle'), description: t('operations.cards.resetColumnDesc'), to: '/ops/operations/column-reset' },
    { title: t('operations.cards.allocationDefaultTitle'), description: t('operations.cards.allocationDefaultDesc'), to: '/ops/operations/allocation-default' },
    { title: t('operations.cards.budgetRowsTitle'), description: t('operations.cards.budgetRowsDesc'), to: '/ops/operations/budget-rows' },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t("operations.title")} />
      <Typography variant="body1" sx={{ color: 'text.secondary' }}>
        {t('operations.subtitle')}
      </Typography>
      <Grid container spacing={2}>
        {cards.map((c) => (
          <Grid key={c.to} item xs={12} sm={6} md={4} lg={3}>
            <Card variant="outlined">
              <CardActionArea onClick={() => navigate(c.to)}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{c.title}</Typography>
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
  );
}
