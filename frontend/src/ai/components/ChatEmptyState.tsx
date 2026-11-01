import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import type { OnboardingAngle } from '../../components/onboarding/onboardingApi';
import { useOnboarding } from '../../components/onboarding/useOnboarding';

type ChatEmptyStateProps = {
  onSuggestion: (prompt: string) => void;
  disabled?: boolean;
};

export const SUGGESTION_KEYS = [
  'budgetLines',
  'overdueTasks',
  'myProjects',
  'applicationMention',
  'knowledgeSearch',
] as const;

/** The two questions of each onboarding path, with the module each one reads. */
export const ANGLE_SUGGESTIONS: Record<OnboardingAngle, Array<{ key: string; resource: string }>> = {
  budget: [{ key: 'budgetLines', resource: 'budget' }, { key: 'noOwner', resource: 'budget' }],
  cartography: [{ key: 'endOfSupport', resource: 'applications' }, { key: 'noRecovery', resource: 'applications' }],
  portfolio: [{ key: 'overBudget', resource: 'portfolio_projects' }, { key: 'awaitingDecision', resource: 'portfolio_requests' }],
};

const MAX_SUGGESTIONS = 5;

/**
 * The chip explains the @ ("type @ to pick one"). The composer keeps the request,
 * the words before the colon, and ends on @APP- so the mention picker opens on
 * applications, the same token the old "Summarize @APP-" template used.
 */
export function suggestionPrompt(label: string): string {
  const at = label.lastIndexOf('@');
  if (at < 0) return label;
  if (!/\s/.test(label.slice(at + 1))) return label;
  const head = label.slice(0, at);
  const colon = head.lastIndexOf(':');
  const lead = (colon === -1 ? head : head.slice(0, colon)).trim();
  return `${lead} @APP-`;
}

export default function ChatEmptyState({ onSuggestion, disabled }: ChatEmptyStateProps) {
  const { t } = useTranslation(['ai']);
  const { hasLevel } = useAuth();
  const { state: onboarding } = useOnboarding();
  const canReadBudget = hasLevel('budget', 'reader');
  // The questions of the workspace's path come first, those the person may read.
  const angleKeys = onboarding?.angle
    ? ANGLE_SUGGESTIONS[onboarding.angle].filter(({ resource }) => hasLevel(resource, 'reader')).map(({ key }) => key)
    : [];
  const suggestionKeys = [
    ...angleKeys,
    ...SUGGESTION_KEYS.filter((key) => !angleKeys.includes(key) && (key !== 'budgetLines' || canReadBudget)),
  ].slice(0, MAX_SUGGESTIONS);

  return (
    <Stack
      alignItems="center"
      spacing={3}
      sx={{
        textAlign: 'center',
        width: '100%',
        maxWidth: 640,
        mx: 'auto',
      }}
    >
      <Stack alignItems="center" spacing={1.5}>
        <Box
          sx={(theme) => ({
            width: 44,
            height: 44,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: theme.palette.primary.light,
            color: theme.palette.primary.main,
          })}
        >
          <AutoAwesomeOutlinedIcon sx={{ fontSize: 22 }} />
        </Box>
        <Typography
          component="div"
          sx={(theme) => ({
            fontSize: 22,
            fontWeight: 500,
            lineHeight: 1.3,
            color: theme.palette.kanap.text.primary,
          })}
        >
          {t('workspace.empty.title')}
        </Typography>
        <Typography
          component="div"
          sx={(theme) => ({
            fontSize: 14,
            color: theme.palette.kanap.text.secondary,
            maxWidth: 460,
          })}
        >
          {t('workspace.empty.subtitle')}
        </Typography>
      </Stack>

      <Stack spacing={1} sx={{ width: '100%' }}>
        <Typography
          component="div"
          sx={(theme) => ({
            fontSize: 11,
            fontWeight: 500,
            color: theme.palette.kanap.text.secondary,
            letterSpacing: 0.2,
            textAlign: 'left',
          })}
        >
          {t('workspace.empty.suggestionsTitle')}
        </Typography>
        <Stack spacing={0.75} sx={{ width: '100%' }}>
          {suggestionKeys.map((key) => {
            const text = t(`workspace.suggestions.${key}`);
            const prompt = suggestionPrompt(text);
            return (
              <Box
                key={key}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onClick={() => !disabled && onSuggestion(prompt)}
                onKeyDown={(e) => {
                  if (disabled) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSuggestion(prompt);
                  }
                }}
                sx={(theme) => ({
                  textAlign: 'left',
                  px: 1.5,
                  py: 1,
                  borderRadius: '8px',
                  border: `1px solid ${theme.palette.kanap.border.default}`,
                  bgcolor: theme.palette.kanap.bg.primary,
                  color: theme.palette.kanap.text.primary,
                  fontSize: 13,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                  transition: 'background-color 120ms ease, border-color 120ms ease',
                  '&:hover': disabled ? undefined : {
                    bgcolor: theme.palette.kanap.bg.hover,
                    borderColor: theme.palette.primary.main,
                  },
                  '&:focus-visible': {
                    outline: 'none',
                    borderColor: theme.palette.primary.main,
                    boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
                  },
                })}
              >
                {text}
              </Box>
            );
          })}
        </Stack>
      </Stack>
    </Stack>
  );
}
