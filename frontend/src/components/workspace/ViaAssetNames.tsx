import React from 'react';
import { Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export type ViaAsset = { id: string; name: string; reference?: string | null };

/**
 * The assets that carry a line (a host, the members of a cluster): their names side by side, each a
 * neutral link to its page. Its column wraps (`wrap`), so every name stays readable; the list is also on hover.
 */
export default function ViaAssetNames({ assets }: { assets: ViaAsset[] }) {
  if (assets.length === 0) return null;
  return (
    <span title={assets.map((asset) => asset.name).join(', ')}>
      {assets.map((asset, index) => (
        <React.Fragment key={asset.id}>
          {index > 0 && ', '}
          <Link
            component={RouterLink}
            to={`/it/assets/${asset.id}/overview`}
            underline="hover"
            onClick={(event) => event.stopPropagation()}
            sx={{ color: 'inherit', fontSize: 'inherit', '&:hover': { color: 'primary.main' } }}
          >
            {asset.name}
          </Link>
        </React.Fragment>
      ))}
    </span>
  );
}
