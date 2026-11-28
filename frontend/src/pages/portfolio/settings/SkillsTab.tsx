import { useState } from 'react';
import { Card, CardContent, Collapse, IconButton, Stack, Switch, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useTranslation } from 'react-i18next';
import type { Skill } from './types';

// Skills Section Component
export function SkillsSection({
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
