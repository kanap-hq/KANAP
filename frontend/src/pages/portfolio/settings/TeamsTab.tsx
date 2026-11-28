import { Box, Card, CardContent, IconButton, Stack, Switch, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import type { PortfolioTeam } from './types';

// Teams Section Component
export function TeamsSection({
  teams,
  canEdit,
  onEdit,
  onDelete,
  onToggle,
}: {
  teams: PortfolioTeam[];
  canEdit: boolean;
  onEdit: (team: PortfolioTeam) => void;
  onDelete: (id: string) => void;
  onToggle: (team: PortfolioTeam) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  if (teams.length === 0) {
    return (
      <Typography className="kanap-empty-state" sx={{ fontSize: 13, color: 'kanap.text.tertiary', m: 0 }}>
        {t('settings.teams.empty')}
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>

      <Card>
        <CardContent sx={{ p: 2 }}>
          <Stack spacing={1}>
            {teams.map((team) => (
              <Stack
                key={team.id}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  p: 1,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  opacity: team.is_active ? 1 : 0.6,
                }}
              >
                <Switch
                  checked={team.is_active}
                  onChange={() => onToggle(team)}
                  size="small"
                  disabled={!canEdit}
                />
                <Box sx={{ flex: 1 }}>
                  <Typography>{team.name}</Typography>
                  {team.description && (
                    <Typography variant="caption" color="text.secondary">
                      {team.description}
                    </Typography>
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                  {t('settings.teams.memberCount', { count: team.member_count })}
                </Typography>
                {team.is_system && (
                  <Typography variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                    {t('settings.labels.system')}
                  </Typography>
                )}
                {canEdit && (
                  <>
                    <IconButton size="small" onClick={() => onEdit(team)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => onDelete(team.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
