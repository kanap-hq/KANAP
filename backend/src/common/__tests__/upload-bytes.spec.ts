import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { backendPath } from './backend-root';
import { uploadedBytes } from '../upload';

// Uploads stay in memory: no route configures multer disk storage, so a file is its buffer.
// The services used to fall back on reading `file.path` from disk, dead code that code
// scanning reports as a path built from user input. They all read the buffer through
// uploadedBytes, and no source reads a path from an uploaded file again.

const file = (buffer?: Buffer) => ({ buffer } as unknown as Express.Multer.File);

assert.deepEqual(uploadedBytes(file(Buffer.from('name\nAcme\n'))), Buffer.from('name\nAcme\n'));
assert.throws(() => uploadedBytes(undefined), (e: unknown) => e instanceof BadRequestException && /No file uploaded/.test((e as Error).message));
assert.throws(() => uploadedBytes(file()), (e: unknown) => e instanceof BadRequestException && /Empty upload/.test((e as Error).message));

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const offenders = sources(backendPath('src')).flatMap((source) =>
  fs
    .readFileSync(source, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, at: `${path.relative(backendPath(), source)}:${index + 1}` }))
    .filter(({ line }) => /file\s+as\s+any\)\.path\b|\bfile\??\.path\b/.test(line))
    .map(({ at }) => at),
);
assert.deepEqual(offenders, [], `an uploaded file is read from its buffer (uploadedBytes), never from a path: ${offenders.join(', ')}`);

console.log('upload-bytes.spec: ok');
