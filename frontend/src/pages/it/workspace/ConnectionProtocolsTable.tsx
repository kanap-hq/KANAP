import React from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableRow, TextField } from '@mui/material';
import { tableCellTextFieldSx } from '../../../theme/formSx';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';

export type ConnectionProtocol = { code: string; port_override: string | null };

const PORT_DEBOUNCE_MS = 900;
const monoSx = { fontFamily: "'JetBrains Mono Variable', monospace" } as const;

type Props = {
  protocols: ConnectionProtocol[];
  /** Re-seed the editable port draft when this changes (e.g. the connection id). */
  connectionKey?: string;
  /** Editable port column (Overview). Read-only shows the effective port (Path). */
  editable?: boolean;
  disabled?: boolean;
  /** Called (debounced) with the full next protocol set when a port is edited. */
  onProtocolsChange?: (next: ConnectionProtocol[]) => void;
};

/**
 * Dense protocol/port table shared by the connection Overview (editable) and the
 * Path tab's destination card (read-only). The port for a protocol defaults to
 * its typical port and may carry a per-protocol override.
 */
export default function ConnectionProtocolsTable({
  protocols,
  connectionKey,
  editable = false,
  disabled = false,
  onProtocolsChange,
}: Props) {
  const { t } = useTranslation(['it']);
  const { settings } = useItOpsEnumOptions();

  const rows = React.useMemo(() => {
    const metaByCode = new Map<string, { label: string; typicalPorts: string }>();
    (settings?.connectionTypes || []).forEach((ct: any) => {
      metaByCode.set(String(ct.code), {
        label: ct.label || ct.code,
        typicalPorts: ct.typicalPorts || ct.typical_ports || '',
      });
    });
    return protocols.map((p) => {
      const meta = metaByCode.get(p.code);
      return {
        code: p.code,
        label: meta?.label || p.code,
        typicalPorts: meta?.typicalPorts || '',
        port_override: p.port_override,
      };
    });
  }, [protocols, settings]);

  // Local draft so typing doesn't fire a PATCH per keystroke. Re-seeded only when
  // the set of protocol codes changes, not when our own debounced save round-trips.
  const codesKey = protocols.map((p) => p.code).join('|');
  const [portByCode, setPortByCode] = React.useState<Record<string, string>>({});
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const next: Record<string, string> = {};
    protocols.forEach((p) => {
      next[p.code] = p.port_override || '';
    });
    setPortByCode(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey, connectionKey]);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handlePortChange = (code: string, raw: string) => {
    if (!onProtocolsChange) return;
    const next = { ...portByCode, [code]: raw };
    setPortByCode(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onProtocolsChange(
        protocols.map((p) => ({ code: p.code, port_override: (next[p.code] || '').trim() || null })),
      );
    }, PORT_DEBOUNCE_MS);
  };

  if (rows.length === 0) return null;

  const headSx = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', border: 0 } as const;

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell sx={{ ...headSx, pl: 0 }}>{t('it:workspace.connection.protocolsTable.protocol')}</TableCell>
          <TableCell sx={headSx}>{t('it:workspace.connection.protocolsTable.defaultPort')}</TableCell>
          <TableCell sx={{ ...headSx, width: 160 }}>{t('it:workspace.connection.protocolsTable.port')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((p) => {
          const effective = (p.port_override || '').trim() || p.typicalPorts;
          return (
            <TableRow key={p.code} sx={{ '& td': { borderColor: 'kanap.border.soft' } }}>
              <TableCell sx={{ fontSize: 13, color: 'kanap.text.primary', pl: 0 }}>{p.label}</TableCell>
              <TableCell sx={{ fontSize: 13, color: 'kanap.text.tertiary', ...monoSx }}>
                {p.typicalPorts || '—'}
              </TableCell>
              {editable ? (
                <TableCell sx={{ width: 160 }}>
                  <TextField
                    variant="standard"
                    size="small"
                    disabled={disabled}
                    value={portByCode[p.code] ?? ''}
                    onChange={(e) => handlePortChange(p.code, e.target.value)}
                    placeholder={p.typicalPorts || t('it:workspace.connection.protocolsTable.portPlaceholder')}
                    sx={[tableCellTextFieldSx, { '& input': monoSx }]}
                  />
                </TableCell>
              ) : (
                <TableCell sx={{ fontSize: 13, color: 'kanap.text.primary', ...monoSx }}>
                  {effective || '—'}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
