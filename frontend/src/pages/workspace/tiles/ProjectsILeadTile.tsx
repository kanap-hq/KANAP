import { useNavigate } from 'react-router-dom';
import {
  List,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  Button,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../../../api';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../i18n/useLocale';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import { projectStatusLabel } from './tileLabels';
import { getDotColor, getPillBg, PROJECT_STATUS_COLORS } from '../../../utils/statusColors';

interface MyLeadershipProject {
  id: string;
  name: string;
  status: string;
  role: 'it_lead' | 'business_lead' | 'it_sponsor' | 'business_sponsor';
  planned_end: string | null;
  next_milestone: {
    id: string;
    name: string;
    target_date: string | null;
  } | null;
}

interface ProjectsILeadTileProps {
  config: Record<string, unknown>;
}



export default function ProjectsILeadTile({ config }: ProjectsILeadTileProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const limit = Math.min((config.limit as number) || 5, 10);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'my-leadership-projects', limit],
    queryFn: async () => {
      const res = await api.get<MyLeadershipProject[]>('/dashboard/my-leadership-projects', {
        params: { limit },
      });
      return res.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  const projects = data || [];

  const formatDate = (date: string | null) => {
    if (!date) return null;
    return new Date(date).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  };

  return (
    <DashboardTile
      title={t('dashboard.tiles.projectsILead')}
      icon="Leaderboard"
      isEmpty={projects.length === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={
        <Button size="small" onClick={() => navigate('/portfolio/projects?projectScope=my')}>
          {t('buttons.viewAll')}
        </Button>
      }
    >
      {projects.length === 0 ? (
        <TileEmptyState
          message={t('dashboard.tiles.notLeading')}
          action={
            <Button size="small" onClick={() => navigate('/portfolio/projects')}>
              {t('dashboard.tiles.browseProjects')}
            </Button>
          }
        />
      ) : (
        <List dense disablePadding>
          {projects.map((project) => (
            <ListItemButton
              key={project.id}
              onClick={() => navigate(`/portfolio/projects/${project.id}`)}
              sx={{ py: 0.5, alignItems: 'flex-start' }}
            >
              <ListItemText
                primary={project.name}
                secondary={
                  <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Typography variant="caption" color="text.disabled">
                        {({'it_lead': t('dashboard.tiles.itLead'), 'business_lead': t('dashboard.tiles.businessLead'), 'it_sponsor': t('dashboard.tiles.itSponsor'), 'business_sponsor': t('dashboard.tiles.businessSponsor')} as Record<string, string>)[project.role] || project.role}
                      </Typography>
                      <Box component="span" sx={(theme) => {
                        const muiColor = PROJECT_STATUS_COLORS[project.status] || 'default';
                        const textColor = getDotColor(muiColor, theme.palette.mode);
                        const bgColor = getPillBg(muiColor, theme.palette.mode);
                        return { display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, borderRadius: 9999, fontSize: '0.75rem', fontWeight: 500, color: textColor, bgcolor: bgColor };
                      }}>
                        {projectStatusLabel(t, project.status)}
                      </Box>
                    </Box>
                    {project.next_milestone && (
                      <Typography variant="caption" color="text.secondary">
                        {project.next_milestone.target_date
                          ? t('dashboard.tiles.nextMilestoneWithDate', { name: project.next_milestone.name, date: formatDate(project.next_milestone.target_date) })
                          : t('dashboard.tiles.nextMilestone', { name: project.next_milestone.name })
                        }{project.next_milestone.target_date && false && (
                          <></>
                        )}
                      </Typography>
                    )}
                  </Box>
                }
                primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                secondaryTypographyProps={{ component: 'div' }}
              />
            </ListItemButton>
          ))}
        </List>
      )}
    </DashboardTile>
  );
}
