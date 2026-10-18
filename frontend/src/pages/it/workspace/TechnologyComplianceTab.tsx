import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { PropertyRow } from '../../../components/design';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import { classificationText } from '../../../utils/applicationClassification';
import { HelpLabel, LevelSelect } from '../components/ApplicationClassificationPanel';
import DurationEditor from '../components/DurationEditor';
import type { TechnologyDetail, TechnologyPatch } from './TechnologyOverviewTab';

// The rows and titles of the application's classification panel, so both read the same.
const rowSx = { display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', columnGap: '18px', alignItems: 'start' } as const;
const valueSx = { maxWidth: 520 } as const;
const sectionTitleSx = (theme: any) => ({ fontSize: 16, fontWeight: 500, color: theme.palette.kanap.text.primary, mb: 1.25 });

/**
 * The continuity classification of a technology: cyber criticality, recovery wave, RTO and RPO,
 * with the controls, labels and catalog of the application's classification. A technology has no
 * review circuit: each value is saved on change.
 */
export default function TechnologyComplianceTab({ technology, canManage, onPatch }: {
  technology: TechnologyDetail;
  canManage: boolean;
  onPatch: (patch: TechnologyPatch) => void;
}) {
  const { data: catalog } = useApplicationClassificationCatalog();
  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h2" sx={sectionTitleSx}>{classificationText('Criticality')}</Typography>
        <PropertyRow label={<HelpLabel text="Cyber criticality" help="Cyber help" />} sx={rowSx} valueSx={valueSx}>
          <LevelSelect
            value={technology.cyber_criticality ?? null}
            ariaLabel={classificationText('Cyber criticality')}
            options={catalog?.cyberCriticalityLevels || []}
            placeholder={classificationText('Choose cyber criticality')}
            disabled={!canManage}
            onChange={(value) => onPatch({ cyber_criticality: value })}
          />
        </PropertyRow>
      </Box>
      <Box>
        <Typography component="h2" sx={sectionTitleSx}>{classificationText('Continuity and recovery')}</Typography>
        <Stack spacing={1.25}>
          <PropertyRow label={<HelpLabel text="Recovery wave" help="Recovery help" />} sx={rowSx} valueSx={valueSx}>
            <LevelSelect
              value={technology.recovery_wave ?? null}
              ariaLabel={classificationText('Recovery wave')}
              options={catalog?.recoveryWaves || []}
              placeholder={classificationText('Choose a recovery wave')}
              disabled={!canManage}
              onChange={(value) => onPatch({ recovery_wave: value })}
            />
          </PropertyRow>
          <PropertyRow label={<HelpLabel text="Recovery time objective (RTO)" help="RTO help" />} sx={rowSx} valueSx={valueSx}>
            <DurationEditor
              value={technology.rto_minutes ?? null}
              onCommit={(value) => onPatch({ rto_minutes: value })}
              disabled={!canManage}
              placeholder={classificationText('Choose a duration')}
              ariaLabel={classificationText('Recovery time objective')}
            />
          </PropertyRow>
          <PropertyRow label={<HelpLabel text="Recovery point objective (RPO)" help="RPO help" />} sx={rowSx} valueSx={valueSx}>
            <DurationEditor
              value={technology.rpo_minutes ?? null}
              onCommit={(value) => onPatch({ rpo_minutes: value })}
              allowZero
              disabled={!canManage}
              placeholder={classificationText('Choose a duration')}
              ariaLabel={classificationText('Recovery point objective')}
            />
          </PropertyRow>
        </Stack>
      </Box>
    </Stack>
  );
}
