import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { converterEnv } from './converter-env';

const execFileAsync = promisify(execFile);

const CONVERSION_TIMEOUT_MS = 30_000;
const CONVERSION_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const CONVERSION_DPI = '192';

export type ConversionResult = {
  success: boolean;
  pngBuffer?: Buffer;
  pngFilename?: string;
  reason?: string;
};

@Injectable()
export class VectorImageConversionService {
  private readonly logger = new Logger(VectorImageConversionService.name);

  async convertToPng(inputPath: string, extension: string, tempDir: string): Promise<ConversionResult> {
    const ext = extension.toLowerCase();
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(tempDir, `${baseName}-converted.png`);

    try {
      switch (ext) {
        case '.emf':
        case '.wmf':
        case '.svg':
        case '.eps':
          return await this.convertWithInkscape(inputPath, outputPath, tempDir);
        default:
          return { success: false, reason: `unsupported vector format: ${ext}` };
      }
    } catch (error: any) {
      const message = String(error?.message || 'unknown error');
      this.logger.warn(`Vector image conversion failed for ${path.basename(inputPath)}: ${message}`);
      return { success: false, reason: message };
    }
  }

  // Inkscape and `which` get the environment of converterEnv (common/converter-env.ts), with
  // their home and cache folders in a dedicated folder inside the temporary folder of the call.
  private async convertWithInkscape(inputPath: string, outputPath: string, tempDir: string): Promise<ConversionResult> {
    if (!(await this.isToolAvailable('inkscape', tempDir))) {
      return { success: false, reason: 'inkscape is not installed' };
    }

    await execFileAsync(
      'inkscape',
      [inputPath, '--export-type=png', `--export-dpi=${CONVERSION_DPI}`, '--export-background=white', `--export-filename=${outputPath}`],
      {
        env: await converterEnv(tempDir),
        timeout: CONVERSION_TIMEOUT_MS,
        maxBuffer: CONVERSION_MAX_BUFFER_BYTES,
      },
    );

    return this.readConvertedPng(outputPath, inputPath);
  }

  private async readConvertedPng(outputPath: string, inputPath: string): Promise<ConversionResult> {
    const pngBuffer = await fs.readFile(outputPath);
    if (pngBuffer.length === 0) {
      return { success: false, reason: 'conversion produced an empty file' };
    }
    const baseName = path.basename(inputPath, path.extname(inputPath));
    return { success: true, pngBuffer, pngFilename: `${baseName}.png` };
  }

  private async isToolAvailable(command: string, tempDir: string): Promise<boolean> {
    try {
      await execFileAsync('which', [command], { env: await converterEnv(tempDir), timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }
}
