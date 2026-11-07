import { Box, Card, CardActionArea, CardContent, Grid, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import ClassificationGapsStrip, { ClassificationGaps } from './components/ClassificationGapsStrip';
import SteeringStrip from './components/SteeringStrip';

/**
 * Charter card: 8px radius, 1px border, no shadow at rest, a subtle lift on hover,
 * 16px padding, 160ms transition.
 */
const reportCardSx: SxProps<Theme> = {
  height: '100%',
  bgcolor: 'kanap.bg.primary',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  boxShadow: 'none',
  transition: 'box-shadow 160ms ease, transform 160ms ease',
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: (theme) =>
      theme.palette.mode === 'dark' ? '0 4px 12px rgba(0,0,0,0.25)' : '0 4px 12px rgba(0,0,0,0.05)',
  },
};

function ReportCard({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <Card variant="outlined" sx={reportCardSx}>
      <CardActionArea
        onClick={onClick}
        sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}
      >
        <CardContent sx={{ p: 2 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary' }}>{title}</Typography>
          <Typography sx={{ mt: 0.5, fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary' }}>
            {description}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

type ReportCardEntry = { key: string; to: string; titleKey: string; descriptionKey: string };
type ReportSection = { key: string; titleKey: string; cards: ReportCardEntry[] };

/**
 * The hub reads by horizon: what happened, what is in progress, what comes next. A new report
 * is one more entry in the row it answers.
 */
const REPORT_SECTIONS: ReportSection[] = [
  {
    key: 'past',
    titleKey: 'reports.sections.past',
    cards: [
      {
        key: 'weekly',
        to: '/portfolio/reports/weekly',
        titleKey: 'reports.cards.weekly.title',
        descriptionKey: 'reports.cards.weekly.description',
      },
      {
        // Same page as the period review, opened on its by-person reading.
        key: 'byPerson',
        to: '/portfolio/reports/weekly?groupBy=person',
        titleKey: 'reports.cards.byPerson.title',
        descriptionKey: 'reports.cards.byPerson.description',
      },
      {
        key: 'timeLogged',
        to: '/portfolio/reports/time-logged',
        titleKey: 'reports.cards.timeLogged.title',
        descriptionKey: 'reports.cards.timeLogged.description',
      },
    ],
  },
  {
    key: 'current',
    titleKey: 'reports.sections.current',
    cards: [
      {
        key: 'flow',
        to: '/portfolio/reports/flow',
        titleKey: 'reports.cards.flow.title',
        descriptionKey: 'reports.cards.flow.description',
      },
      {
        key: 'byAssignee',
        to: '/portfolio/reports/by-assignee',
        titleKey: 'reports.cards.byAssignee.title',
        descriptionKey: 'reports.cards.byAssignee.description',
      },
    ],
  },
  {
    key: 'upcoming',
    titleKey: 'reports.sections.upcoming',
    cards: [
      {
        key: 'upcoming',
        to: '/portfolio/reports/upcoming',
        titleKey: 'reports.cards.upcoming.title',
        descriptionKey: 'reports.cards.upcoming.description',
      },
      {
        key: 'capacityHeatmap',
        to: '/portfolio/reports/capacity-heatmap',
        titleKey: 'reports.cards.capacityHeatmap.title',
        descriptionKey: 'reports.cards.capacityHeatmap.description',
      },
    ],
  },
];

export default function ReportsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation('portfolio');
  const { data: gaps } = useQuery({
    queryKey: ['portfolio-classification-gaps'],
    queryFn: async () => (await api.get<ClassificationGaps>('/portfolio/reports/classification-gaps')).data,
    staleTime: 2 * 60 * 1000,
  });
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t('reports.title')} />
      {/*
        One header row: steering and to classify side by side, each as wide as its own figures.
        Both strips hold a few short rows, so sharing the page width would only stretch them
        and push the second one to the far edge. When the two do not fit on one line, the
        second wraps under the first; on a narrow screen they stack full width.
      */}
      <Box
        data-testid="reports-header-strips"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          flexWrap: 'wrap',
          gap: 2,
          '& > *': { minWidth: 0, flex: { md: '0 1 auto' } },
        }}
      >
        <SteeringStrip />
        <ClassificationGapsStrip data={gaps} />
      </Box>
      {REPORT_SECTIONS.map((section) => (
        <Box key={section.key} component="section" aria-labelledby={`reports-section-${section.key}`}>
          <Typography
            id={`reports-section-${section.key}`}
            component="h2"
            sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 }}
          >
            {t(section.titleKey)}
          </Typography>
          <Grid container spacing={2}>
            {section.cards.map((card) => (
              <Grid key={card.key} item xs={12} sm={6} md={4} lg={3}>
                <ReportCard
                  title={t(card.titleKey)}
                  description={t(card.descriptionKey)}
                  onClick={() => navigate(card.to)}
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Box>
  );
}
