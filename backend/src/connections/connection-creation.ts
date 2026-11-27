import type { EntityManager } from 'typeorm';
import { creationCancelExpired } from '../common/creation/creation-token';

/**
 * "Cancel" of a connection being created stops once it is linked (403 `CREATION_CANCEL_EXPIRED`,
 * decision P17): an interface binding (`interface_connection_links`) or a document
 * (`document_connections`) linked to it. Their writers post them from the binding or the document:
 * the rows carry no author and leave no row in the connection's history (only a first binding's
 * risk-mode switch writes one), so `assertCreatorAloneSinceCreation` cannot see who set them, and
 * any link refuses, the creator's own included. The protocols, servers and path segments are the
 * connection's own: the creator gives them, and another person's change of them is in its history.
 *
 * The preflight calls it as is; the cancel, under the connection's lock: a link inserted meanwhile
 * waits on that lock through its foreign key, so the read after the lock sees every committed link,
 * and a link posted after the lock fails on the connection gone.
 */
export async function assertConnectionUnlinked(manager: EntityManager, tenantId: string, connectionId: string): Promise<void> {
  const [row]: Array<{ linked: boolean }> = await manager.query(
    `SELECT EXISTS (SELECT 1 FROM interface_connection_links WHERE tenant_id = $1 AND connection_id = $2)
         OR EXISTS (SELECT 1 FROM document_connections WHERE tenant_id = $1 AND connection_id = $2) AS linked`,
    [tenantId, connectionId],
  );
  if (row?.linked) throw creationCancelExpired();
}

/**
 * What a connection lacks to be complete: at least one protocol, and both ends of a
 * server-to-server connection (an asset or an entity each) or two servers of a multi-server one.
 *
 * A connection is created complete (`POST /connections`). One created at its title before 26.11.9
 * may lack them: while it lacks one, an update may leave it lacking (`ConnectionsCrudService.update`);
 * once it has them all, every update keeps them.
 */

export type ConnectionCreationField = 'protocols' | 'source' | 'destination' | 'servers';

export type ConnectionCompleteness = {
  topology: string;
  source_asset_id: string | null;
  source_entity_code: string | null;
  destination_asset_id: string | null;
  destination_entity_code: string | null;
  protocolCount: number;
  serverCount: number;
};

export function missingConnectionFields(connection: ConnectionCompleteness): ConnectionCreationField[] {
  const fields: ConnectionCreationField[] = [];
  if (connection.protocolCount === 0) fields.push('protocols');
  if (connection.topology === 'multi_server') {
    if (connection.serverCount < 2) fields.push('servers');
  } else {
    if (!connection.source_asset_id && !connection.source_entity_code) fields.push('source');
    if (!connection.destination_asset_id && !connection.destination_entity_code) fields.push('destination');
  }
  return fields;
}
