/**
 * What a connection still lacks before "Create" may end its creation (`POST /connections/:id/creation/
 * complete`): at least one protocol, and both ends of a server-to-server connection (an asset or an
 * entity each) or two servers of a multi-server one. The keys are the screen's (`params.fields` of
 * `CREATION_INCOMPLETE`).
 *
 * The screen creates a connection at its title (`POST /connections/creation`) without any of them.
 * While a connection lacks one, an update may leave it lacking (`ConnectionsCrudService.update`);
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

/** The English words of the refusal message (the screen names the fields in the person's language). */
export const CONNECTION_FIELD_NAMES: Record<ConnectionCreationField, string> = {
  protocols: 'protocols',
  source: 'source',
  destination: 'destination',
  servers: 'servers',
};
