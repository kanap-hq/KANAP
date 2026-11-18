import { useState, useCallback } from 'react';
import {
  ImportOperation,
  ImportPhase,
  CsvImportResult,
  WORKFLOW_PRESETS,
} from './csv.types';

/**
 * Hook for managing CSV import state and flow
 */
export function useCsvImport() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<ImportPhase>('upload');
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState('merge');
  const [operation, setOperation] = useState<ImportOperation>('upsert');

  // The preset sets the operation.
  const selectPreset = useCallback((id: string) => {
    setPresetId(id);
    const preset = WORKFLOW_PRESETS.find((p) => p.id === id);
    if (preset) setOperation(preset.operation);
  }, []);

  // Reset state for new import
  const reset = useCallback(() => {
    setFile(null);
    setPhase('upload');
    setResult(null);
    setLoading(false);
    setError(null);
    setPresetId('merge');
    setOperation('upsert');
  }, []);

  // Go back to upload phase
  const goBack = useCallback(() => {
    setPhase('upload');
    setResult(null);
    setError(null);
  }, []);

  return {
    // State
    file,
    phase,
    result,
    loading,
    error,
    presetId,
    operation,

    // Setters
    setFile,
    setPhase,
    setResult,
    setLoading,
    setError,

    // Actions
    selectPreset,
    reset,
    goBack,
  };
}

export type UseCsvImportReturn = ReturnType<typeof useCsvImport>;
