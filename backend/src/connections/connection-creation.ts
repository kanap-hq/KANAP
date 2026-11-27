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
