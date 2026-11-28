import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, CardContent, Collapse, IconButton, Stack, Switch, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useInvalidateSharedLists } from './sharedLists';
import { SkillEditDialog } from './SkillEditDialog';
import TabActions from './TabActions';
import type { SettingsTabProps, Skill } from './types';
import { useSettingsDelete } from './useSettingsDelete';

/** The skills tab: the skills of the contributors, by category. */
export default function SkillsTab({ canEdit }: SettingsTabProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const invalidate = useInvalidateSharedLists();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsGrouped, setSkillsGrouped] = useState<Record<string, Skill[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  const loadData = useCallback(async () => {
    try {
      const skillsRes = await api.get('/portfolio/skills');
      setSkills(skillsRes.data?.items || []);
      setSkillsGrouped(skillsRes.data?.grouped || {});
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.loadFailed')));
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const skillsChanged = useCallback(() => {
    loadData();
    invalidate('skills');
  }, [invalidate, loadData]);

  const deleteItem = useSettingsDelete({ canEdit, onDeleted: skillsChanged, onError: setError });

  const handleSeedDefaults = useCallback(async () => {
    if (!canEdit) return;
    try {
      const res = await api.post('/portfolio/skills/seed-defaults');
      if (res.data?.created > 0) {
        skillsChanged();
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.skills.messages.seedDefaultsFailed')));
    }
  }, [canEdit, skillsChanged, t]);

  const handleSkillToggle = useCallback(async (skill: Skill) => {
    if (!canEdit) return;
    try {
      await api.patch(`/portfolio/skills/${skill.id}`, { enabled: !skill.enabled });
      skillsChanged();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.skills.messages.updateFailed')));
    }
  }, [canEdit, skillsChanged, t]);

  const handleDeleteSkill = useCallback((id: string) => deleteItem({
    id,
    name: skills.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/skills',
    failed: t('settings.skills.messages.deleteFailed'),
  }), [deleteItem, skills, t]);

  const handleEditSkill = useCallback((skill: Skill) => {
    setEditingSkill(skill);
    setSkillDialogOpen(true);
  }, []);

  const handleCreateSkill = useCallback(() => {
    setEditingSkill(null);
    setSkillDialogOpen(true);
  }, []);

  return (
    <>
      {canEdit && (
        <TabActions>
          <Stack direction="row" spacing={1}>
            {skills.length === 0 && (
              <Button variant="action" startIcon={<PlaylistAddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleSeedDefaults}>
                {t('settings.actions.seedDefaults')}
              </Button>
            )}
            <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateSkill}>
              {t('settings.actions.addSkill')}
            </Button>
          </Stack>
        </TabActions>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <SkillsSection
        skills={skills}
        skillsGrouped={skillsGrouped}
        canEdit={canEdit}
        onToggle={handleSkillToggle}
        onEdit={handleEditSkill}
        onDelete={handleDeleteSkill}
      />

      {/* Edit/Create Skill Dialog */}
      <SkillEditDialog
        open={skillDialogOpen}
        skill={editingSkill}
        existingCategories={Object.keys(skillsGrouped)}
        onClose={() => setSkillDialogOpen(false)}
        onSave={() => {
          setSkillDialogOpen(false);
          skillsChanged();
        }}
      />
    </>
  );
}

// Skills Section Component
function SkillsSection({
  skills,
  skillsGrouped,
  canEdit,
  onToggle,
  onEdit,
  onDelete,
}: {
  skills: Skill[];
  skillsGrouped: Record<string, Skill[]>;
  canEdit: boolean;
  onToggle: (skill: Skill) => void;
  onEdit: (skill: Skill) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  if (skills.length === 0) {
    return (
      <Typography className="kanap-empty-state" sx={{ fontSize: 13, color: 'kanap.text.tertiary', m: 0 }}>
        {t('settings.skills.empty')}
      </Typography>
    );
  }

  const categories = Object.keys(skillsGrouped).sort();

  return (
    <Stack spacing={2}>

      {categories.map((category) => {
        const categorySkills = skillsGrouped[category] || [];
        const enabledCount = categorySkills.filter((s) => s.enabled).length;
        const isExpanded = expandedCategories[category] ?? true;

        return (
          <Card key={category}>
            <CardContent sx={{ pb: isExpanded ? 2 : '16px !important' }}>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ cursor: 'pointer' }}
                onClick={() => toggleCategory(category)}
              >
                <IconButton size="small">
                  {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
                <Typography variant="subtitle1" sx={{ flex: 1 }}>
                  {category}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {`${enabledCount}/${categorySkills.length}`}
                </Typography>
              </Stack>

              <Collapse in={isExpanded}>
                <Stack spacing={1} sx={{ mt: 2 }}>
                  {categorySkills.map((skill) => (
                    <Stack
                      key={skill.id}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{
                        p: 1,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        opacity: skill.enabled ? 1 : 0.6,
                      }}
                    >
                      <Switch
                        checked={skill.enabled}
                        onChange={() => onToggle(skill)}
                        size="small"
                        disabled={!canEdit}
                      />
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        {skill.name}
                      </Typography>
                      {canEdit && (
                        <>
                          <IconButton size="small" onClick={() => onEdit(skill)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => onDelete(skill.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </Stack>
                  ))}
                </Stack>
              </Collapse>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
