import React from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { environmentLabel } from '../../utils/applicationEnvironments';
import OptionWithHint from './OptionWithHint';
import ClusterMark from '../workspace/ClusterMark';

export type ServerOption = {
  id: string;
  name: string;
  environment: string;
  kind: string;
  provider: string;
  asset_reference?: string | null;
  is_cluster?: boolean;
  /** A cluster's members by name (`include=member_names`): who its assignment reaches. */
  member_names?: string[];
};

type RenderServerOptionOptions = {
  /** What a cluster with no declared member says under its name. */
  noMembers: string;
  /** Prefix the name with the business reference (`AST-71 · server-1`). */
  showReference?: boolean;
};

type ServerOptionRowProps = RenderServerOptionOptions & {
  optionProps: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key };
  option: ServerOption;
};

/**
 * The delayed tooltip: environment, server kind and provider, in the user's language.
 * A provider stored as a hosting type (on-prem, colocation) uses that catalog name.
 */
function ServerOptionRow({ optionProps, option, noMembers, showReference }: ServerOptionRowProps) {
  const { t } = useTranslation('it');
  const { labelFor, byField } = useItOpsEnumOptions();
  const providerCode = option.provider || '';
  const providers = byField?.serverProvider ?? [];
  const provider = !providerCode
    ? ''
    : providers.some((item) => item.code === providerCode)
      ? labelFor('serverProvider', providerCode)
      : labelFor('hostingType', providerCode);
  const hint = [
    environmentLabel((key) => t(key), option.environment),
    option.kind ? labelFor('serverKind', option.kind) : '',
    provider,
  ].filter(Boolean).join(' · ');
  const name = showReference && option.asset_reference
    ? `${option.asset_reference} · ${option.name}`
    : option.name;
  if (!option.is_cluster) {
    return <OptionWithHint optionProps={optionProps} label={name} hint={hint} />;
  }
  const members = option.member_names;
  return (
    <OptionWithHint
      optionProps={optionProps}
      hint={hint}
      label={(
        <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {name}
            <ClusterMark />
          </Box>
          {members && (
            <Box component="span" sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary, overflow: 'hidden', textOverflow: 'ellipsis' })}>
              {members.length > 0 ? members.join(', ') : noMembers}
            </Box>
          )}
        </Box>
      )}
    />
  );
}

/**
 * One option of a server list: name, then the cluster mark and its members for a cluster.
 * The hint is the delayed tooltip of `OptionWithHint`.
 */
export function renderServerOption(
  optionProps: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key },
  option: ServerOption,
  options: RenderServerOptionOptions,
) {
  return <ServerOptionRow key={option.id} optionProps={optionProps} option={option} {...options} />;
}
