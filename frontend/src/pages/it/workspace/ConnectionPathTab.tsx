import React from 'react';
import { Box } from '@mui/material';
import ConnectionPathSection, { ConnectionPathHop } from './ConnectionPathSection';
import { type ConnectionProtocol } from './ConnectionProtocolsTable';

type Props = {
  connectionId: string;
  hops: ConnectionPathHop[];
  canManage: boolean;
  defaultProtocolCodes: string[];
  protocols?: ConnectionProtocol[];
  sourceLabel: string;
  destinationLabel: string;
  sourceIsCluster?: boolean;
  destinationIsCluster?: boolean;
  onChange: (next: ConnectionPathHop[]) => void;
};

export default function ConnectionPathTab(props: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <ConnectionPathSection {...props} />
    </Box>
  );
}
