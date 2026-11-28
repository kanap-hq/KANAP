import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, IconButton, Stack, Switch, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { TeamEditDialog } from './TeamEditDialog';
import { useInvalidateSharedLists } from './sharedLists';
import TabActions from './TabActions';
import type { PortfolioTeam, SettingsTabProps } from './types';
import { useSettingsDelete } from './useSettingsDelete';

/** The teams tab: the teams contributors belong to. */
export default function TeamsTab({ canEdit }: SettingsTabProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const invalidate = useInvalidateSharedLists();
  const [teams, setTeams] = useState<PortfolioTeam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<PortfolioTeam | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await api.get('/portfolio/teams');
      setTeams(res.data || []);
      setLoadError(null);
      setLoaded(true);
    } catch (e: any) {
      setLoadError(getApiErrorMessage(e, t, t('settings.messages.loadFailed')));
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const teamsChanged = useCallback(() => {
    loadData();
    invalidate('teams');
  }, [invalidate, loadData]);

  const deleteItem = useSettingsDelete({ canEdit, onDeleted: teamsChanged, onError: setError });

  const handleEditTeam = useCallback((team: PortfolioTeam) => {
    setEditingTeam(team);
    setTeamDialogOpen(true);
  }, []);

  const handleCreateTeam = useCallback(() => {
    setEditingTeam(null);
    setTeamDialogOpen(true);
  }, []);

  const handleDeleteTeam = useCallback((id: string) => deleteItem({
    id,
    name: teams.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/teams',
    check: true,
    failed: t('settings.teams.messages.deleteFailed'),
  }), [deleteItem, teams, t]);

  const handleToggleTeam = useCallback(async (team: PortfolioTeam) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/teams/${team.id}`, { is_active: !team.is_active });
      teamsChanged();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.teams.messages.updateFailed')));
    }
  }, [canEdit, teamsChanged, t]);

  const handleSeedTeams = useCallback(async () => {
    if (!canEdit) return;
    try {
      const res = await api.post('/portfolio/teams/seed-defaults');
      if (res.data?.created > 0) {
        teamsChanged();
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.teams.messages.seedDefaultsFailed')));
    }
  }, [canEdit, teamsChanged, t]);

  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!loaded) return null;

  return (
    <>
      {canEdit && (
        <TabActions>
          <Stack direction="row" spacing={1}>
            {teams.length === 0 && (
              <Button variant="action" startIcon={<PlaylistAddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleSeedTeams}>
                {t('settings.actions.seedDefaults')}
              </Button>
            )}
            <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateTeam}>
              {t('settings.actions.addTeam')}
            </Button>
          </Stack>
        </TabActions>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TeamsSection
        teams={teams}
        canEdit={canEdit}
        onEdit={handleEditTeam}
        onDelete={handleDeleteTeam}
        onToggle={handleToggleTeam}
      />

      <TeamEditDialog
        open={teamDialogOpen}
        team={editingTeam}
        onClose={() => setTeamDialogOpen(false)}
        onSave={() => {
          setTeamDialogOpen(false);
          teamsChanged();
        }}
      />
    </>
  );
}

// Teams Section Component
function TeamsSection({
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
