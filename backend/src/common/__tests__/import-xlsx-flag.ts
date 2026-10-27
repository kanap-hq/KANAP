import { Features } from '../../config/features';

/**
 * Runs `run` with the data imports reading workbooks (`IMPORT_XLSX`) on or off, then puts the switch
 * back. The switch is read at each upload, so a spec can try both sides in one process.
 */
export async function withImportXlsx<T>(enabled: boolean, run: () => Promise<T> | T): Promise<T> {
  const before = Features.IMPORT_XLSX;
  Features.IMPORT_XLSX = enabled;
  try {
    return await run();
  } finally {
    Features.IMPORT_XLSX = before;
  }
}
