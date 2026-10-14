import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import api from '../../api';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { getProjectStatusLabel, getRequestStatusLabel } from '../../utils/portfolioI18n';

/** What `GET /suppliers/:id/usages` and `GET /contacts/:id/usages` answer (backend `common/record-usages.ts`). */
export type UsageType = 'suppliers' | 'budget_lines' | 'contracts' | 'applications' | 'assets' | 'locations' | 'projects' | 'requests';
export type UsageItem = {
  id: string;
  reference: string | null;
  name: string;
  nature?: 'opex' | 'capex';
  status: string | null;
  active: boolean;
  roles?: string[];
};
export type UsageGroup = { type: UsageType; total: number; items: UsageItem[] };
export type Usages = { total: number; groups: UsageGroup[] };
export type UsageOwner = 'suppliers' | 'contacts';

export const recordUsagesKey = (owner: UsageOwner, id: string) => [owner, id, 'usages'] as const;

/** Where a supplier or a contact is used, refetched on each visit: other pages change it. */
export function useRecordUsages(owner: UsageOwner, id: string) {
  return useQuery({
    queryKey: recordUsagesKey(owner, id),
    queryFn: async () => (await api.get<Usages>(`/${owner}/${id}/usages`)).data,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** The page of an object, in the same tab. A budget line opens by its reference (`BL-n`). */
export function usageHref(type: UsageType, item: UsageItem): string {
  switch (type) {
    case 'suppliers': return `/master-data/suppliers/${item.id}/overview`;
    case 'budget_lines': return `/ops/budget/${item.reference ?? item.id}`;
    case 'contracts': return `/ops/contracts/${item.id}`;
    case 'applications': return `/it/applications/${item.id}`;
    case 'assets': return `/it/assets/${item.id}`;
    case 'locations': return `/it/locations/${item.id}`;
    case 'projects': return `/portfolio/projects/${item.id}`;
    case 'requests': return `/portfolio/requests/${item.id}`;
  }
}

/** Groups whose roles are contact types (`contacts.roles.*`); the others hold free text. */
const TYPED_ROLE_GROUPS: readonly UsageType[] = ['suppliers', 'budget_lines', 'contracts'];

const rowLinkSx = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  minHeight: 32,
  fontSize: 13,
  color: theme.palette.kanap.text.primary,
  textDecoration: 'none',
  borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
  '&:hover .usage-name': { color: theme.palette.kanap.teal, textDecoration: 'underline', textUnderlineOffset: '2px' },
  '&:focus-visible': { outline: `2px solid ${theme.palette.kanap.teal}`, outlineOffset: -2, borderRadius: '2px' },
});

/** The objects that use a supplier or a contact, by type: each row opens the object's page. */
export default function RecordUsagesTab({ owner, id }: { owner: UsageOwner; id: string }) {
  const { t } = useTranslation(['master-data', 'common']);
  const { t: tPortfolio } = useTranslation('portfolio');
  const { data, error } = useRecordUsages(owner, id);

  const details = (type: UsageType, item: UsageItem): string[] => {
    const parts: string[] = [];
    if (item.nature) parts.push(t(`shared.usages.nature.${item.nature}`));
    if (type === 'projects' && item.status) parts.push(getProjectStatusLabel(tPortfolio, item.status));
    if (type === 'requests' && item.status) parts.push(getRequestStatusLabel(tPortfolio, item.status));
    if (!item.active) parts.push(t('shared.usages.inactive'));
    for (const role of item.roles ?? []) {
      parts.push(TYPED_ROLE_GROUPS.includes(type) ? t(`contacts.roles.${role}`, { defaultValue: role }) : role);
    }
    return parts;
  };

  if (error) return <Alert severity="error" sx={{ maxWidth: 640 }}>{t('shared.usages.loadFailed')}</Alert>;
  // Nothing while the list loads: no flash of the empty line.
  if (!data) return null;
  if (data.groups.length === 0) {
    return (
      <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', py: '6px' }}>
        {owner === 'suppliers' ? t('shared.usages.emptySupplier') : t('shared.usages.emptyContact')}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 720 }}>
      {data.groups.map((group) => {
        const title = t(`shared.usages.groups.${group.type}`);
        return (
          <Box key={group.type} component="section" aria-label={title}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Typography component="h3" sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary' }}>{title}</Typography>
              <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary', fontVariantNumeric: 'tabular-nums' }}>
                {group.total}
              </Typography>
            </Box>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {group.items.map((item) => {
                const extra = details(group.type, item);
                return (
                  <Box component="li" key={item.id}>
                    <Box component={RouterLink} to={usageHref(group.type, item)} sx={rowLinkSx}>
                      {item.reference && (
                        <Box
                          component="span"
                          sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12, color: 'kanap.text.secondary', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                        >
                          {item.reference}
                        </Box>
                      )}
                      <Box
                        component="span"
                        className="usage-name"
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: item.active ? 'inherit' : 'kanap.text.tertiary',
                        }}
                      >
                        {item.name}
                      </Box>
                      {extra.length > 0 && (
                        <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {extra.join(' · ')}
                        </Box>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
            {group.total > group.items.length && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', pt: '6px' }}>
                {t('shared.usages.partial', { shown: group.items.length, total: group.total })}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
