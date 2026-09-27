import { Avatar, Box, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PortfolioMetadataItem } from '../../pages/portfolio/workspace/PortfolioMetadataBar';
import { metaItemSx, taskDetailAvatarSizes } from '../../pages/tasks/theme/taskDetailTokens';
import { useCostCenterTree } from '../../hooks/useCostCenterTree';
import { getInitials } from '../../utils/userDisplay';

type Props = {
  /** The line's current cost center. */
  costCenterId: string | null | undefined;
};

/**
 * The budget holder of an OPEX or CAPEX line: the owner of its cost center,
 * read from the tree (nothing is stored on the line), so it follows the line's
 * cost center and the cost center's owner. Read only; rendered only when the
 * line has a cost center whose budget holder is set.
 */
export default function BudgetHolderMetadataItem({ costCenterId }: Props) {
  const { t } = useTranslation(['ops']);
  const { byId } = useCostCenterTree({ enabled: !!costCenterId });
  const node = costCenterId ? byId.get(costCenterId) : undefined;
  if (!node?.owner_user_id) return null;
  const name = node.owner_name || '';

  return (
    <Tooltip title={t('shared.budgetHolderSource', { code: node.code, name: node.name })}>
      <Box component="span" data-testid="budget-holder" sx={{ display: 'inline-flex', minWidth: 0 }}>
        <PortfolioMetadataItem label={t('shared.budgetHolder')}>
          <Box component="span" sx={{ ...metaItemSx, minWidth: 0 }}>
            <Avatar
              sx={(theme) => ({
                width: taskDetailAvatarSizes.metadata,
                height: taskDetailAvatarSizes.metadata,
                fontSize: 9,
                fontWeight: 500,
                bgcolor: theme.palette.primary.main,
                color: theme.palette.primary.contrastText,
              })}
            >
              {getInitials(name)}
            </Avatar>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </Box>
          </Box>
        </PortfolioMetadataItem>
      </Box>
    </Tooltip>
  );
}
