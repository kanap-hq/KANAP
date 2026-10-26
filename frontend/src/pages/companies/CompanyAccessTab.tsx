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
  type CompanyAccessView,
} from '../../components/dataAccess/dataAccess';

const sectionLabelSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.tertiary',
  mb: 1,
} as const;

/**
 * The "Access" tab of a company (spec §7.2): who sees the whole company and who sees a part of it
 * through a cost center. Visible only to unscoped user administrators (the workspace hides it).
 */
export default function CompanyAccessTab({ companyId }: { companyId: string }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(() => ['company-data-access', companyId] as const, [companyId]);
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => (await api.get<CompanyAccessView>(`/companies/${companyId}/data-access`)).data,
  });
  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ['data-access'] });
  }, [queryClient, queryKey]);
  const actions = usePersonAccessActions(refresh);

  const companyNode: AccessNode = { type: 'company', id: companyId, name: null, access: 'read' };

  const fullRows: AccessPersonRow[] = (data?.full ?? []).map((row) => ({
    key: row.person.id,
    name: row.person.name,
    access: row.access,
    // Everything covers the company too: removing it here would take away all their access.
    onRemove: row.via.type === 'company' ? () => actions.removeNode(row.person.id, companyNode) : undefined,
    via: row.via.type === 'all' ? accessNodeReference(row.via, t) : undefined,
  }));

  const partialRows: AccessPersonRow[] = (data?.partial ?? []).map((row) => {
    const center = row.via.type === 'cost_center' ? row.via : null;
    const node: AccessNode | null = center
      ? { type: 'cost_center', id: center.id ?? null, name: center.name, code: center.code, kind: null, access: row.access }
      : null;
    return {
      key: row.person.id,
      name: row.person.name,
      access: row.access,
      onRemove: node ? () => actions.removeNode(row.person.id, node) : undefined,
      via: center ? (
        <Link
          component={RouterLink}
          to={`/master-data/cost-centers/${center.id}/access`}
          underline="hover"
          sx={{ fontSize: 13, color: 'kanap.text.secondary' }}
        >
          {accessNodeReference(center, t)}
        </Link>
      ) : undefined,
    };
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
        <Typography sx={sectionLabelSx}>{t('admin:dataAccess.accessTab.full')}</Typography>
        <AccessPeopleTable rows={fullRows} busyPersonId={actions.pending} />
        <Box sx={{ mt: 1.5 }}>
          <AccessPersonAdd
            busy={!!actions.pending}
            onAdd={(personId, access) => actions.setNode(personId, companyNode, access)}
          />
        </Box>
      </Box>
      <Box>
        <Typography sx={sectionLabelSx}>{t('admin:dataAccess.accessTab.partial')}</Typography>
        <AccessPeopleTable rows={partialRows} busyPersonId={actions.pending} />
      </Box>
    </Stack>
  );
}
