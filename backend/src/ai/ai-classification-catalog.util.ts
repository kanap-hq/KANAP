import { catalogFromMetadata, ClassificationCatalog } from '../it-ops-settings/classification-catalog';
import type { AiExecutionContextWithManager } from './ai.types';

/** The tenant's application classification catalog, as the Applications list reads it. */
export async function readClassificationCatalog(context: AiExecutionContextWithManager): Promise<ClassificationCatalog> {
  const rows = await context.manager.query('SELECT metadata FROM tenants WHERE id = $1', [context.tenantId]);
  return catalogFromMetadata(rows[0]?.metadata?.it_ops);
}
