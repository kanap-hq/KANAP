import React from 'react';
import { Box } from '@mui/material';
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

/**
 * One option of a server list: name, then the cluster mark and its members for a cluster.
 * The hint (`ENV · kind · provider`) is the delayed tooltip of `OptionWithHint`.
 */
export function renderServerOption(
  optionProps: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key },
  option: ServerOption,
  { noMembers, showReference }: RenderServerOptionOptions,
) {
  const hint = [option.environment?.toUpperCase(), option.kind, option.provider].filter(Boolean).join(' · ');
  const name = showReference && option.asset_reference
    ? `${option.asset_reference} · ${option.name}`
    : option.name;
  if (!option.is_cluster) {
    return <OptionWithHint key={option.id} optionProps={optionProps} label={name} hint={hint} />;
  }
  const members = option.member_names;
  return (
    <OptionWithHint
      key={option.id}
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
