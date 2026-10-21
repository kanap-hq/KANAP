import { useCallback, useMemo } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { useFeatures } from '../../../config/FeaturesContext';
import { TILE_REGISTRY } from '../tiles/TileRegistry';
import type { DashboardTileConfig } from './useDashboardConfig';

export function useTilePermissions() {
  const { hasLevel } = useAuth();
  const { config } = useFeatures();
  const features = config.features;

  const canViewTile = useCallback(
    (tileId: string): boolean => {
      const tile = TILE_REGISTRY[tileId];
      if (!tile) return false;
      if (tile.requiredFeature && features[tile.requiredFeature] !== true) return false;

      const reqs = tile.requiredPermissions ?? [];
      if (reqs.length === 0) return true; // No permission required

      return reqs.every((req) => hasLevel(req.resource, req.level));
    },
    [hasLevel, features],
  );

  const filterVisibleTiles = useCallback(
    (tiles: DashboardTileConfig[]): DashboardTileConfig[] => {
      return tiles.filter((t) => canViewTile(t.id));
    },
    [canViewTile],
  );

  // Get list of all tiles the user can view (for settings modal)
  const availableTileIds = useMemo(() => {
    return Object.keys(TILE_REGISTRY).filter((id) => canViewTile(id));
  }, [canViewTile]);

  return { canViewTile, filterVisibleTiles, availableTileIds };
}
