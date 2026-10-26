import React from 'react';
import { Alert, Box, CircularProgress, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import AccessPeopleTable, { type AccessPersonRow } from '../../components/dataAccess/AccessPeopleTable';
import AccessPersonAdd from '../../components/dataAccess/AccessPersonAdd';
import { usePersonAccessActions } from '../../components/dataAccess/usePersonAccessActions';
import {
  accessNodeReference,
  type AccessNode,
  type CostCenterAccessView,
} from '../../components/dataAccess/dataAccess';

const sectionLabelSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.tertiary',
  mb: 1,
} as const;

type Props = {
  costCenterId: string;
  /** The company of the center: an access inherited from it links to the company's Access tab. */
  companyId?: string | null;
  /** The center or group as the tab labels its nodes ("Infrastructure (INF)"). */
  nodeLabel: string;
};

/** The "Access" tab of a cost center or group (spec §7.2): direct access, then what covers it. */
export default function CostCenterAccessTab({ costCenterId, companyId = null, nodeLabel }: Props) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(() => ['cost-center-data-access', costCenterId] as const, [costCenterId]);
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => (await api.get<CostCenterAccessView>(`/cost-centers/${costCenterId}/data-access`)).data,
  });
  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ['data-access'] });
  }, [queryClient, queryKey]);
  const actions = usePersonAccessActions(refresh);

  const centerNode: AccessNode = { type: 'cost_center', id: costCenterId, name: null, access: 'read' };

  const directRows: AccessPersonRow[] = (data?.direct ?? []).map((row) => ({
    key: row.person.id,
    name: row.person.name,
    access: row.access,
    onRemove: () => actions.removeNode(row.person.id, centerNode),
  }));

  const inheritedRows: AccessPersonRow[] = (data?.inherited ?? []).map((row) => {
    let via: React.ReactNode;
    if (row.via.type === 'cost_center') {
      via = (
        <Link
          component={RouterLink}
          to={`/master-data/cost-centers/${row.via.id ?? ''}/access`}
          underline="hover"
          sx={{ fontSize: 13, color: 'kanap.text.secondary' }}
        >
          {accessNodeReference(row.via, t)}
        </Link>
      );
    } else if (row.via.type === 'company' && companyId) {
      via = (
        <Link
          component={RouterLink}
          to={`/master-data/companies/${companyId}/access`}
          underline="hover"
          sx={{ fontSize: 13, color: 'kanap.text.secondary' }}
        >
          {accessNodeReference(row.via, t)}
        </Link>
      );
    } else {
      via = accessNodeReference(row.via, t);
    }
    return { key: row.person.id, name: row.person.name, access: row.access, via };
  });

  if (isLoading) {
    return <CircularProgress size={20} />;
  }
  if (error) {
    return <Alert severity="error">{getApiErrorMessage(error, t, t('admin:dataAccess.accessTab.loadFailed'))}</Alert>;
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      {actions.error && <Alert severity="error">{actions.error}</Alert>}
      <Box>
        <Typography sx={sectionLabelSx}>{t('admin:dataAccess.accessTab.direct')}</Typography>
        <AccessPeopleTable rows={directRows} busyPersonId={actions.pending} />
        <Box sx={{ mt: 1.5 }}>
          <AccessPersonAdd
            busy={!!actions.pending}
            onAdd={(personId, access, personName) => actions.setNode(
              personId,
              centerNode,
              access,
              { personName, nodeName: nodeLabel },
            )}
          />
        </Box>
      </Box>
      <Box>
        <Typography sx={sectionLabelSx}>{t('admin:dataAccess.accessTab.inherited')}</Typography>
        <AccessPeopleTable rows={inheritedRows} />
      </Box>
    </Stack>
  );
}
