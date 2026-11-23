import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Alert, Box, Checkbox, FormControlLabel, Slider, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Typography, Divider,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { longFormSurfaceFieldSx } from '../../../theme/formSx';
import api from '../../../api';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { getScoreColor } from '../../tasks/theme/taskDetailTokens';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { displayedRequestPriority } from '../requestPriority';

interface CriterionValue {
  id: string;
  label: string;
  position: number;
  triggers_mandatory_bypass: boolean;
}

interface Criterion {
  id: string;
  name: string;
  enabled: boolean;
  inverted: boolean;
  weight: number;
  values: CriterionValue[];
}

interface Props {
  requestId: string;
  criteriaValues: Record<string, string>;
  priorityScore: number | null;
  priorityOverride: boolean;
  overrideValue: number | null;
  overrideJustification: string | null;
  mandatoryBypassEnabled?: boolean;
  readOnly?: boolean;
  onScoreChange?: (newScore: number | null) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export type RequestScoringEditorHandle = {
  isDirty: () => boolean;
  getSnapshot: () => RequestScoringSnapshot;
  save: () => Promise<number | null>;
  reset: () => void;
};

export type RequestScoringSnapshot = {
  criteria_values: Record<string, string>;
  priority_score: number | null;
  priority_override: boolean;
  override_value: number | null;
  override_justification: string | null;
};

export const RequestScoringEditor = forwardRef<RequestScoringEditorHandle, Props>(
  function RequestScoringEditor(
    {
      requestId,
      criteriaValues: initialValues,
      priorityScore,
      priorityOverride: initialOverride,
      overrideValue: initialOverrideValue,
      overrideJustification: initialJustification,
      mandatoryBypassEnabled = false,
      readOnly,
      onScoreChange,
      onDirtyChange,
    },
    ref,
  ) {
    const { t } = useTranslation(['portfolio', 'errors']);
    const theme = useTheme();
    const [criteria, setCriteria] = useState<Criterion[]>([]);
    const [values, setValues] = useState<Record<string, string>>(initialValues || {});
    const [override, setOverride] = useState(initialOverride);
    const [overrideVal, setOverrideVal] = useState(initialOverrideValue ?? 50);
    const [justification, setJustification] = useState(initialJustification || '');
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [bypassActive, setBypassActive] = useState(false);
    const [calculatedScore, setCalculatedScore] = useState<number | null>(priorityScore);

    // Skip one prop sync cycle after save (prevents flicker before refetch completes)
    const skipNextPropSync = useRef(false);

    // Load criteria once on mount
    useEffect(() => {
      const load = async () => {
        try {
          const res = await api.get('/portfolio/criteria');
          const enabledCriteria = (res.data || []).filter((c: Criterion) => c.enabled);
          setCriteria(enabledCriteria);
        } catch (e: any) {
          setError(getApiErrorMessage(e, t, t('editors.scoring.messages.loadCriteriaFailed')));
        }
      };
      load();
    }, [t]);

    // Only sync from props on INITIAL load (not when dirty)
    useEffect(() => {
      // Skip one sync after save to prevent flicker (refetch brings new props next)
      if (skipNextPropSync.current) {
        skipNextPropSync.current = false;
        return;
      }
      if (!dirty) {
        setValues(initialValues || {});
        setOverride(initialOverride);
        setOverrideVal(initialOverrideValue ?? 50);
        setJustification(initialJustification || '');
        setCalculatedScore(priorityScore);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialValues, initialOverride, initialOverrideValue, initialJustification, priorityScore]);

    const checkBypassActive = useCallback((crits: Criterion[], vals: Record<string, string>) => {
      // Only check for bypass if the feature is enabled in settings
      if (!mandatoryBypassEnabled) {
        setBypassActive(false);
        return false;
      }
      for (const c of crits) {
        const selectedId = vals[c.id];
        if (!selectedId) continue;
        const value = c.values.find((v) => v.id === selectedId);
        if (value?.triggers_mandatory_bypass) {
          setBypassActive(true);
          return true;
        }
      }
      setBypassActive(false);
      return false;
    }, [mandatoryBypassEnabled]);

    // Client-side score calculation for live preview
    const calculateLocalScore = useCallback((
      crits: Criterion[],
      vals: Record<string, string>,
    ): number | null => {
      if (crits.length === 0) return null;

      let totalWeightedScore = 0;
      let totalWeight = 0;

      for (const criterion of crits) {
        if (!criterion.values || criterion.values.length < 2) continue;

        const weight = Number(criterion.weight) || 1;
        const selectedValueId = vals[criterion.id];
        const maxPosition = criterion.values.length - 1;

        if (maxPosition === 0) continue;

        let position = 0;
        if (selectedValueId) {
          const selectedValue = criterion.values.find(v => v.id === selectedValueId);
          if (selectedValue && typeof selectedValue.position === 'number') {
            position = selectedValue.position;
          }
        }

        let percentage: number;
        if (criterion.inverted) {
          percentage = ((maxPosition - position) / maxPosition) * 100;
        } else {
          percentage = (position / maxPosition) * 100;
        }

        if (isNaN(percentage)) percentage = 0;

        totalWeightedScore += percentage * weight;
        totalWeight += weight;
      }

      if (totalWeight === 0) return 0;
      const result = Math.round((totalWeightedScore / totalWeight) * 100) / 100;
      return isNaN(result) ? 0 : result;
    }, []);

    // Recalculate when criteria load
    useEffect(() => {
      if (criteria.length > 0) {
        checkBypassActive(criteria, values);
        if (!dirty && priorityScore == null) {
          const score = calculateLocalScore(criteria, values);
          setCalculatedScore(score);
        }
      }
    }, [criteria, values, dirty, priorityScore, checkBypassActive, calculateLocalScore]);

    const handleValueChange = (criterionId: string, valueId: string | null) => {
      const next = { ...values };
      if (valueId) {
        next[criterionId] = valueId;
      } else {
        delete next[criterionId];
      }

      setValues(next);
      setDirty(true);
      onDirtyChange?.(true);

      // Live score calculation
      const isBypass = checkBypassActive(criteria, next);
      if (isBypass) {
        setCalculatedScore(100);
      } else {
        const newScore = calculateLocalScore(criteria, next);
        setCalculatedScore(newScore);
      }
    };

    const handleOverrideChange = (enabled: boolean) => {
      setOverride(enabled);
      setDirty(true);
      onDirtyChange?.(true);
    };

    const handleOverrideValChange = (val: number) => {
      setOverrideVal(val);
      setDirty(true);
      onDirtyChange?.(true);
    };

    const handleJustificationChange = (val: string) => {
      setJustification(val);
      setDirty(true);
      onDirtyChange?.(true);
    };

    // The live figure follows the same rule as the header and the list: no number until an
    // enabled criterion is answered, unless a priority override is on.
    const liveScore = bypassActive ? 100 : calculateLocalScore(criteria, values);
    const displayScore = displayedRequestPriority({
      priorityScore: liveScore,
      priorityOverride: override && !bypassActive,
      overrideValue: overrideVal,
      criteriaValues: values,
      enabledCriterionIds: criteria.map((criterion) => criterion.id),
    });
    const roundedDisplayScore = displayScore != null && !isNaN(displayScore) ? Math.round(displayScore) : null;
    const scoreDotColor = roundedDisplayScore == null
      ? theme.palette.kanap.text.tertiary
      : getScoreColor(roundedDisplayScore, theme.palette.mode);
    const buildSnapshot = useCallback((score: number | null = displayScore): RequestScoringSnapshot => {
      const effectiveOverride = override && !bypassActive;
      return {
        criteria_values: { ...values },
        priority_score: score,
        priority_override: effectiveOverride,
        override_value: effectiveOverride ? overrideVal : null,
        override_justification: effectiveOverride ? justification : null,
      };
    }, [bypassActive, displayScore, justification, override, overrideVal, values]);

    // IMPORTANT: This imperative handle is recreated whenever state changes
    // so the parent always gets a save() function with current values
    useImperativeHandle(ref, () => ({
      isDirty: () => dirty,
      getSnapshot: () => buildSnapshot(),
      save: async (): Promise<number | null> => {
        setError(null);
        try {
          // Save criteria values - uses current state directly (not refs!)
          const res = await api.post(`/portfolio/criteria/requests/${requestId}/score`, {
            criteria_values: values,
          });

          const newScore = res.data?.priority_score;
          setCalculatedScore(newScore);
          onScoreChange?.(newScore);

          // Save override if enabled
          let finalScore = newScore;
          if (override) {
            await api.post(`/portfolio/criteria/requests/${requestId}/override`, {
              enabled: true,
              value: overrideVal,
              justification: justification,
            });
            finalScore = overrideVal;
          } else if (initialOverride && !override) {
            await api.post(`/portfolio/criteria/requests/${requestId}/override`, {
              enabled: false,
            });
          }

          // Skip next prop sync to prevent flicker (wait for refetch with new data)
          skipNextPropSync.current = true;
          setDirty(false);
          onDirtyChange?.(false);

          return finalScore;
        } catch (e: any) {
          setError(getApiErrorMessage(e, t, t('editors.scoring.messages.saveFailed')));
          throw e;
        }
      },
      reset: () => {
        setValues(initialValues || {});
        setOverride(initialOverride);
        setOverrideVal(initialOverrideValue ?? 50);
        setJustification(initialJustification || '');
        setDirty(false);
        onDirtyChange?.(false);
      },
    }), [buildSnapshot, dirty, values, override, overrideVal, justification, requestId, initialOverride, initialValues, initialOverrideValue, initialJustification, onScoreChange, onDirtyChange, t]);

    return (
      <Stack spacing={3}>
        {error && <Alert severity="error">{error}</Alert>}

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            pb: '20px',
            borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
          }}
        >
          <Box
            component="span"
            sx={{ fontSize: 12, fontWeight: 500, lineHeight: 1, color: theme.palette.kanap.text.tertiary }}
          >
            {t('editors.scoring.labels.priorityScore')}
          </Box>
          <Box
            component="span"
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              flexShrink: 0,
              alignSelf: 'center',
              bgcolor: scoreDotColor,
            }}
          />
          <Box
            component="span"
            sx={{
              fontFamily: MONO_FONT_FAMILY,
              fontSize: 36,
              fontWeight: 500,
              color: theme.palette.kanap.text.primary,
              lineHeight: 1,
            }}
          >
            {roundedDisplayScore ?? '-'}
          </Box>
        </Box>

        {/* Criteria Evaluation */}
        <Typography variant="h6">{t('editors.scoring.sections.evaluationCriteria')}</Typography>

        {criteria.length === 0 && (
          <Alert severity="info">{t('editors.scoring.states.noCriteria')}</Alert>
        )}

        {criteria.map((criterion) => (
          <Box key={criterion.id}>
            <Typography variant="subtitle2" gutterBottom>
              {criterion.name}
              {criterion.weight !== 1 && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {t('editors.scoring.values.weight', { weight: criterion.weight })}
                </Typography>
              )}
              {criterion.inverted && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {t('editors.scoring.values.inverted')}
                </Typography>
              )}
            </Typography>
            <ToggleButtonGroup
              value={values[criterion.id] || null}
              exclusive
              onChange={(_, val) => handleValueChange(criterion.id, val)}
              disabled={readOnly}
              size="small"
              sx={{
                flexWrap: 'wrap',
                rowGap: '8px',
                '& .MuiToggleButtonGroup-grouped': {
                  m: 0,
                  mr: '-1px',
                  px: '14px',
                  py: '6px',
                  minWidth: 0,
                  border: `1px solid ${theme.palette.kanap.border.default}`,
                  borderRadius: '0 !important',
                  bgcolor: 'transparent',
                  color: theme.palette.kanap.text.secondary,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: 1.4,
                  textTransform: 'none',
                  '&:first-of-type': {
                    borderRadius: '5px 0 0 5px !important',
                  },
                  '&:not(:first-of-type)': {
                    ml: 0,
                    borderLeft: `1px solid ${theme.palette.kanap.border.default}`,
                  },
                  '&:last-of-type': {
                    mr: 0,
                    borderRadius: '0 5px 5px 0 !important',
                  },
                  '&:hover': {
                    bgcolor: theme.palette.kanap.pill.hoverBg,
                  },
                  '&.Mui-selected': {
                    position: 'relative',
                    zIndex: 1,
                    bgcolor: theme.palette.kanap.text.primary,
                    borderColor: theme.palette.kanap.text.primary,
                    color: theme.palette.kanap.bg.primary,
                    fontWeight: 500,
                    '&:hover': {
                      bgcolor: theme.palette.kanap.text.primary,
                    },
                  },
                  '&.Mui-disabled': {
                    cursor: 'default',
                    color: theme.palette.kanap.text.tertiary,
                  },
                },
              }}
            >
              {criterion.values.map((v) => (
                <ToggleButton
                  key={v.id}
                  value={v.id}
                  sx={v.triggers_mandatory_bypass ? {
                    '&&': {
                      borderColor: theme.palette.kanap.pillDanger.border,
                      color: theme.palette.kanap.danger,
                    },
                    '&&:not(:first-of-type)': {
                      borderLeft: `1px solid ${theme.palette.kanap.pillDanger.border}`,
                    },
                    '&&:hover': {
                      bgcolor: theme.palette.kanap.pillDanger.hoverBg,
                    },
                    '&&.Mui-selected': {
                      position: 'relative',
                      zIndex: 1,
                      bgcolor: theme.palette.kanap.pillDanger.bg,
                      borderColor: theme.palette.kanap.danger,
                      color: theme.palette.kanap.danger,
                      fontWeight: 500,
                    },
                    '&&.Mui-selected:not(:first-of-type)': {
                      borderLeft: `1px solid ${theme.palette.kanap.danger}`,
                    },
                  } : undefined}
                >
                  {v.label}
                  {v.triggers_mandatory_bypass && ' *'}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        ))}

        <Divider />

        {/* Manual Override */}
        <Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={override}
                onChange={(e) => handleOverrideChange(e.target.checked)}
                disabled={readOnly || bypassActive}
              />
            }
            label={t('editors.scoring.fields.enablePriorityOverride')}
          />
          {bypassActive && (
            <Typography variant="caption" color="text.secondary" display="block">
              {t('editors.scoring.messages.overrideDisabled')}
            </Typography>
          )}
        </Box>

        {override && !bypassActive && (
          <Stack spacing={2}>
            <Box>
              <Typography gutterBottom>
                {t('editors.scoring.fields.overrideValue', { value: overrideVal })}
              </Typography>
              <Slider
                value={overrideVal}
                onChange={(_, val) => handleOverrideValChange(val as number)}
                min={0}
                max={100}
                disabled={readOnly}
              />
            </Box>
            <TextField
              label={t('editors.scoring.fields.justification')}
              value={justification}
              onChange={(e) => handleJustificationChange(e.target.value)}
              multiline
              rows={2}
              required
              disabled={readOnly}
              fullWidth
              helperText={t('editors.scoring.helper.justification')}
              sx={[longFormSurfaceFieldSx, { '& .MuiInputBase-root': { minHeight: 0 } }]}
            />
          </Stack>
        )}
      </Stack>
    );
  },
);

export default RequestScoringEditor;
