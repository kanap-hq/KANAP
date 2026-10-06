import React from 'react';
import { useTranslation } from 'react-i18next';
import { Grid, Card, CardContent, CardActionArea, Typography, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';

const CARD_ROUTES = [
  { key: 'companies', to: '/master-data/companies' },
  { key: 'departments', to: '/master-data/departments' },
  { key: 'costCenters', to: '/master-data/cost-centers' },
  { key: 'suppliers', to: '/master-data/suppliers' },
  { key: 'coa', to: '/master-data/coa' },
  { key: 'analyticsDimensions', to: '/master-data/analytics' },
  { key: 'workingDayCalendars', to: '/master-data/working-day-calendars' },
  { key: 'businessProcesses', to: '/master-data/business-processes' },
] as const;

export default function MasterDataHomePage() {
  const { t } = useTranslation(['master-data']);
  const navigate = useNavigate();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t('home.title')} />
      <Typography variant="body1" sx={{ color: 'text.secondary' }}>
        {t('home.subtitle')}
      </Typography>
      <Grid container spacing={2}>
        {CARD_ROUTES.map((card) => (
          <Grid key={card.to} item xs={12} sm={6} md={4} lg={3}>
            <Card variant="outlined">
              <CardActionArea onClick={() => navigate(card.to)}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t(`home.cards.${card.key}Title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {t(`home.cards.${card.key}Description`)}
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
