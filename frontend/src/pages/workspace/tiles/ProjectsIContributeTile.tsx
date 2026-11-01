import { useNavigate } from 'react-router-dom';
import {
  List,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  Button,
  Badge,
} from '@mui/material';
import TaskIcon from '@mui/icons-material/Task';
import { useQuery } from '@tanstack/react-query';
import api from '../../../api';
import { useTranslation } from 'react-i18next';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import { projectStatusLabel } from './tileLabels';
import { getDotColor, getPillBg, PROJECT_STATUS_COLORS } from '../../../utils/statusColors';

interface MyContributionProject {
  id: string;
  name: string;
  status: string;
  team: 'it_team' | 'business_team';
  my_tasks_count: number;
}

interface ProjectsIContributeTileProps {
  config: Record<string, unknown>;
}



export default function ProjectsIContributeTile({ config }: ProjectsIContributeTileProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const limit = Math.min((config.limit as number) || 5, 10);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'my-contribution-projects', limit],
    queryFn: async () => {
      const res = await api.get<MyContributionProject[]>('/dashboard/my-contribution-projects', {
        params: { limit },
      });
      return res.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  const projects = data || [];

  return (
    <DashboardTile
      title={t('dashboard.tiles.projectsIContribute')}
      icon="Groups"
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
          message={t('dashboard.tiles.notTeamMember')}
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
              sx={{ py: 0.5 }}
            >
              <ListItemText
                primary={project.name}
                secondary={
                  <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography variant="caption" color="text.disabled">
                      {project.team === 'it_team' ? t('dashboard.tiles.itTeam') : project.team === 'business_team' ? t('dashboard.tiles.businessTeam') : project.team}
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
                }
                primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                secondaryTypographyProps={{ component: 'div' }}
              />
              {project.my_tasks_count > 0 && (
                <Badge badgeContent={project.my_tasks_count} color="default" sx={{ ml: 1 }}>
                  <TaskIcon fontSize="small" color="action" />
                </Badge>
              )}
            </ListItemButton>
          ))}
        </List>
      )}
    </DashboardTile>
  );
}
