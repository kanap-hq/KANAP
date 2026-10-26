import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import PublicIcon from '@mui/icons-material/Public';
import { useTranslation } from 'react-i18next';
import CompanySelect from '../fields/CompanySelect';
import CostCenterSelect from '../fields/CostCenterSelect';
import { useCostCenterTree } from '../../hooks/useCostCenterTree';
import type { CostCenterNode } from '../../services/costCenters';
import type { AccessNode, DataAccessLevel } from './dataAccess';

type Props = {
  onPick: (node: AccessNode) => void;
  /** The add picker offers "Everything"; the node filter of the administration page does not. */
  allowEverything?: boolean;
  /** The cost centers the person owns, offered in one click. */
  ownerCenters?: ReadonlyArray<{ id: string; code: string; name: string }>;
  onPickOwnerCenters?: () => void;
};

const sectionLabelSx = {
  fontSize: 11,
  fontWeight: 500,
  color: 'kanap.text.tertiary',
  mb: 0.5,
} as const;

/**
 * The three sections of the "Add" picker (spec §7.1): companies, cost centers as the tree, and
 * Everything. Without cost centers in the workspace, only companies and Everything are offered.
 * Used inline in the data-access dialog and inside the node-filter dialog of the admin page.
 */
export default function DataAccessNodePicker({
  onPick,
  allowEverything = false,
  ownerCenters = [],
  onPickOwnerCenters,
}: Props) {
  const { t } = useTranslation(['admin', 'common']);
  const tree = useCostCenterTree();

  const pickCenter = (id: string | null, node: CostCenterNode | null, access: DataAccessLevel = 'read') => {
    if (!id || !node) return;
    onPick({
      type: 'cost_center',
      id,
      name: node.name,
      code: node.code,
      kind: node.kind,
      access,
    });
  };

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography sx={sectionLabelSx}>{t('admin:dataAccess.sections.companies')}</Typography>
        <CompanySelect
          hideLabel
          label={t('admin:dataAccess.sections.companies')}
          value={null}
          size="small"
          placeholder={t('admin:dataAccess.placeholders.company')}
          onChange={(id, company) => {
            if (id && company) onPick({ type: 'company', id, name: company.name, access: 'read' });
          }}
        />
      </Box>
      {tree.hasAny && (
        <Box>
          <Typography sx={sectionLabelSx}>{t('admin:dataAccess.sections.costCenters')}</Typography>
          <CostCenterSelect
            hideLabel
            label={t('admin:dataAccess.sections.costCenters')}
            selectable="all"
            value={null}
            placeholder={t('admin:dataAccess.placeholders.costCenter')}
            onChange={(id, node) => pickCenter(id, node)}
          />
        </Box>
      )}
      {allowEverything && (
        <Box>
          <Typography sx={sectionLabelSx}>{t('admin:dataAccess.sections.everything')}</Typography>
          <Button
            size="small"
            variant="text"
            startIcon={<PublicIcon />}
            onClick={() => onPick({ type: 'all', id: null, name: null, access: 'read' })}
          >
            {t('admin:dataAccess.types.everything')}
          </Button>
        </Box>
      )}
      {ownerCenters.length > 0 && onPickOwnerCenters && (
        <Box>
          <Button size="small" variant="text" onClick={onPickOwnerCenters}>
            {t('admin:dataAccess.addTheirCenters', { count: ownerCenters.length })}
          </Button>
        </Box>
      )}
    </Stack>
  );
}
