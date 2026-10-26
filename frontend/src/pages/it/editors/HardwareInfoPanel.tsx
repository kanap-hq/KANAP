import React from 'react';
import { Alert, Stack, TextField, Typography } from '@mui/material';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { PropertyRow } from '../../../components/design';
import DateEUField from '../../../components/fields/DateEUField';
import { drawerFieldValueSx, longFormSurfaceFieldSx } from '../../../theme/formSx';

import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type HardwareInfo = {
  serial_number?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  purchase_date?: string | null;
  rack_location?: string | null;
  rack_unit?: string | null;
  notes?: string | null;
};

function normalizeHardware(data?: HardwareInfo | null): HardwareInfo {
  return {
    serial_number: data?.serial_number || null,
    manufacturer: data?.manufacturer || null,
    model: data?.model || null,
    purchase_date: data?.purchase_date || null,
    rack_location: data?.rack_location || null,
    rack_unit: data?.rack_unit || null,
    notes: data?.notes || null,
  };
}

function sameHardware(a: HardwareInfo, b: HardwareInfo) {
  return JSON.stringify(normalizeHardware(a)) === JSON.stringify(normalizeHardware(b));
}

// A save that fails while the panel is leaving. The next visit shows it again.
const hardwareDrafts = new Map<string, HardwareInfo>();

export function clearHardwareInfoDrafts() {
  hardwareDrafts.clear();
}

type Props = {
  assetId: string;
  onDirtyChange?: (dirty: boolean) => void;
  /** The fiche's message bar. The panel is gone when a save on leaving fails. */
  onSaveError?: (message: string | null) => void;
  /** The asset is fed by Netbox, so the hint below applies to it. */
  netboxManaged?: boolean;
  /**
   * Tells whether Netbox provides this hardware field on this asset. Only the
   * fields it fills are read-only; the others stay the administrator's, and
   * the synchronisation never blanks what they type.
   */
  netboxOwns?: (field: 'serial_number' | 'manufacturer' | 'model' | 'rack_location' | 'rack_unit') => boolean;
};

export default function HardwareInfoPanel({
  assetId,
  onDirtyChange,
  onSaveError,
  netboxManaged = false,
  netboxOwns = () => false,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const readOnly = !hasLevel('infrastructure', 'member');

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [serialNumber, setSerialNumber] = React.useState('');
  const [manufacturer, setManufacturer] = React.useState('');
  const [model, setModel] = React.useState('');
  const [purchaseDate, setPurchaseDate] = React.useState('');
  const [rackLocation, setRackLocation] = React.useState('');
  const [rackUnit, setRackUnit] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const [baseline, setBaseline] = React.useState<HardwareInfo>({});
  const failedSaveSignatureRef = React.useRef<string | null>(null);
  // Set from the start of a save to its end, before the re-render that shows it.
  const savingRef = React.useRef(false);
  // What the unmount sends when a change is still waiting for its autosave.
  const pendingFlushRef = React.useRef<(() => void) | null>(null);

  const dirty = React.useMemo(() => {
    return (
      (serialNumber || '') !== (baseline.serial_number || '') ||
      (manufacturer || '') !== (baseline.manufacturer || '') ||
      (model || '') !== (baseline.model || '') ||
      (purchaseDate || '') !== (baseline.purchase_date || '') ||
      (rackLocation || '') !== (baseline.rack_location || '') ||
      (rackUnit || '') !== (baseline.rack_unit || '') ||
      (notes || '') !== (baseline.notes || '')
    );
  }, [serialNumber, manufacturer, model, purchaseDate, rackLocation, rackUnit, notes, baseline]);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/assets/${assetId}/hardware-info`);
      const server = normalizeHardware(res.data as HardwareInfo | null);
      const draft = hardwareDrafts.get(assetId);
      if (draft && sameHardware(server, draft)) hardwareDrafts.delete(assetId);
      const shown = hardwareDrafts.get(assetId) ?? server;
      setSerialNumber(shown.serial_number || '');
      setManufacturer(shown.manufacturer || '');
      setModel(shown.model || '');
      setPurchaseDate(shown.purchase_date || '');
      setRackLocation(shown.rack_location || '');
      setRackUnit(shown.rack_unit || '');
      setNotes(shown.notes || '');
      setBaseline(server);
    } catch (e: any) {
      // 404 means no hardware info yet, which is OK. A draft from a failed leave still shows.
      if (e?.response?.status === 404) {
        const draft = hardwareDrafts.get(assetId);
        const shown = draft ?? normalizeHardware(null);
        setSerialNumber(shown.serial_number || '');
        setManufacturer(shown.manufacturer || '');
        setModel(shown.model || '');
        setPurchaseDate(shown.purchase_date || '');
        setRackLocation(shown.rack_location || '');
        setRackUnit(shown.rack_unit || '');
        setNotes(shown.notes || '');
        setBaseline(normalizeHardware(null));
      } else {
        setError(getApiErrorMessage(e, t, t('messages.loadHardwareInfoFailed')));
      }
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const hardwarePayload = React.useMemo<HardwareInfo>(() => ({
    serial_number: serialNumber || null,
    manufacturer: manufacturer || null,
    model: model || null,
    purchase_date: purchaseDate || null,
    rack_location: rackLocation || null,
    rack_unit: rackUnit || null,
    notes: notes || null,
  }), [serialNumber, manufacturer, model, purchaseDate, rackLocation, rackUnit, notes]);

  const saveSignature = React.useMemo(() => JSON.stringify(hardwarePayload), [hardwarePayload]);

  const save = React.useCallback(async () => {
    if (readOnly) return;
    hardwareDrafts.set(assetId, hardwarePayload);
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/assets/${assetId}/hardware-info`, hardwarePayload);
      failedSaveSignatureRef.current = null;
      setBaseline(hardwarePayload);
      onSaveError?.(null);
    } catch (e: any) {
      failedSaveSignatureRef.current = saveSignature;
      // The panel is on screen, so the failure stays in its own alert. Drop a page banner this
      // panel left behind on an earlier leave, so the same sentence is not shown twice.
      setError(getApiErrorMessage(e, t, t('messages.saveHardwareInfoFailed')));
      onSaveError?.(null);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [assetId, hardwarePayload, onSaveError, readOnly, saveSignature, t]);

  React.useEffect(() => {
    if (!dirty || loading || saving || readOnly) return undefined;
    if (failedSaveSignatureRef.current === saveSignature) return undefined;
    const timer = window.setTimeout(() => {
      void save();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, loading, readOnly, save, saveSignature, saving]);

  // Leaving the tab before the autosave fires still saves the change, once, without touching state.
  React.useEffect(() => {
    const pending = dirty && !loading && !saving && !readOnly && failedSaveSignatureRef.current !== saveSignature;
    pendingFlushRef.current = pending
      ? () => {
          const payload = hardwarePayload;
          hardwareDrafts.set(assetId, payload);
          void api.post(`/assets/${assetId}/hardware-info`, payload).then(
            () => { onSaveError?.(null); },
            (e) => { onSaveError?.(getApiErrorMessage(e, t, t('messages.saveHardwareInfoFailed'))); },
          );
        }
      : null;
  });

  React.useEffect(() => () => {
    if (!savingRef.current) pendingFlushRef.current?.();
  }, []);

  return (
    <Stack spacing={2} maxWidth={520}>
      {error && <Alert severity="error">{error}</Alert>}
      {netboxManaged ? (
        <Typography variant="caption" sx={{ color: 'kanap.text.tertiary' }}>
          {t('pages.netbox.assetSource.managedFields')}
        </Typography>
      ) : null}

      <PropertyRow label={t('workspace.asset.hardware.serialNumber')}>
        <TextField
          value={serialNumber}
          onChange={(e) => setSerialNumber(e.target.value)}
          disabled={saving || readOnly || netboxOwns('serial_number')}
          placeholder={t('workspace.asset.hardware.serialNumberPlaceholder')}
          size="small"
          variant="standard"
          sx={drawerFieldValueSx}
          fullWidth
        />
      </PropertyRow>

      <PropertyRow label={t('workspace.asset.hardware.manufacturer')}>
        <TextField
          value={manufacturer}
          onChange={(e) => setManufacturer(e.target.value)}
          disabled={saving || readOnly || netboxOwns('manufacturer')}
          placeholder={t('workspace.asset.hardware.manufacturerPlaceholder')}
          size="small"
          variant="standard"
          sx={drawerFieldValueSx}
          fullWidth
        />
      </PropertyRow>

      <PropertyRow label={t('workspace.asset.hardware.model')}>
        <TextField
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={saving || readOnly || netboxOwns('model')}
          placeholder={t('workspace.asset.hardware.modelPlaceholder')}
          size="small"
          variant="standard"
          sx={drawerFieldValueSx}
          fullWidth
        />
      </PropertyRow>

      <PropertyRow label={t('workspace.asset.hardware.purchaseDate')} valueSx={{ maxWidth: 180 }}>
        <DateEUField
          label=""
          hideLabel
          valueYmd={purchaseDate}
          onChangeYmd={setPurchaseDate}
          disabled={saving || readOnly}
          size="small"
          textFieldSx={drawerFieldValueSx}
        />
      </PropertyRow>

      <PropertyRow label={t('workspace.asset.hardware.rackLocation')}>
        <TextField
          value={rackLocation}
          onChange={(e) => setRackLocation(e.target.value)}
          disabled={saving || readOnly || netboxOwns('rack_location')}
          placeholder={t('workspace.asset.hardware.rackLocationPlaceholder')}
          size="small"
          variant="standard"
          sx={drawerFieldValueSx}
          fullWidth
        />
      </PropertyRow>

      <PropertyRow label={t('workspace.asset.hardware.rackUnit')}>
        <TextField
          value={rackUnit}
          onChange={(e) => setRackUnit(e.target.value)}
          disabled={saving || readOnly || netboxOwns('rack_unit')}
          placeholder={t('workspace.asset.hardware.rackUnitPlaceholder')}
          size="small"
          variant="standard"
          sx={drawerFieldValueSx}
          fullWidth
        />
      </PropertyRow>

      <PropertyRow label={t('common.notes')} valueSx={{ width: '100%' }}>
        <TextField
          id="asset-hardware-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={saving || readOnly}
          multiline
          minRows={4}
          maxRows={12}
          placeholder={t('workspace.asset.hardware.notesPlaceholder')}
          variant="standard"
          sx={longFormSurfaceFieldSx}
          fullWidth
        />
      </PropertyRow>
    </Stack>
  );
}
