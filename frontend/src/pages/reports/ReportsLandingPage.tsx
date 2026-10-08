import React from 'react';
import { Grid, Card, CardContent, CardActionArea, Typography, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';

type ReportCard = {
  title: string;
  description: string;
  to: string;
};

export default function ReportsLandingPage() {
  const { t } = useTranslation(["ops"]);
  const navigate = useNavigate();

  const cards: ReportCard[] = [
    { title: t('reports.landing.cards.globalChargeback.title'), description: t('reports.landing.cards.globalChargeback.description'), to: '/ops/reports/chargeback/global' },
    { title: t('reports.landing.cards.companyChargeback.title'), description: t('reports.landing.cards.companyChargeback.description'), to: '/ops/reports/chargeback/company' },
    { title: t('reports.landing.cards.topOpex.title'), description: t('reports.landing.cards.topOpex.description'), to: '/ops/reports/top-opex' },
    { title: t('reports.landing.cards.opexDelta.title'), description: t('reports.landing.cards.opexDelta.description'), to: '/ops/reports/opex-delta' },
    { title: t('reports.landing.cards.budgetTrendOpex.title'), description: t('reports.landing.cards.budgetTrendOpex.description'), to: '/ops/reports/comparison' },
    { title: t('reports.landing.cards.budgetTrendCapex.title'), description: t('reports.landing.cards.budgetTrendCapex.description'), to: '/ops/reports/capex/trend' },
    { title: t('reports.landing.cards.budgetColumnsCompare.title'), description: t('reports.landing.cards.budgetColumnsCompare.description'), to: '/ops/reports/budget-columns-compare' },
    { title: t('reports.landing.cards.consolidation.title'), description: t('reports.landing.cards.consolidation.description'), to: '/ops/reports/consolidation' },
    { title: t('reports.landing.cards.analytics.title'), description: t('reports.landing.cards.analytics.description'), to: '/ops/reports/analytics' },
    { title: t('reports.landing.cards.staffing.title'), description: t('reports.landing.cards.staffing.description'), to: '/ops/reports/staffing' },
    { title: t('reports.landing.cards.costPerFte.title'), description: t('reports.landing.cards.costPerFte.description'), to: '/ops/reports/cost-per-fte' },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t("reports.landing.title")} />
      <Typography variant="body1" sx={{ color: 'text.secondary' }}>
        {t("reports.landing.description")}
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
