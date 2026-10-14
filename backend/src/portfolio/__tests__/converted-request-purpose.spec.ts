import * as assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { MARKDOWN_MAX_BYTES, MARKDOWN_TOO_LARGE } from '../../common/markdown-limits';
import { convertedRequestPurpose } from '../portfolio-requests.service';

// A task converted to a request keeps its stored description as the purpose,
// whatever its size; a purpose sent with the conversion is a new text, held to
// the size limit.

function storedDescription(bytes: number): string {
  const paragraph = 'La **migration** des postes suit [la procédure](https://example.com/postes_migration).\n\n- Inventaire\n- Bascule _progressive_\n\n';
  return paragraph.repeat(Math.ceil(bytes / Buffer.byteLength(paragraph))).slice(0, bytes).trim();
}

async function run() {
  const stored = storedDescription(MARKDOWN_MAX_BYTES + 50 * 1024);
  assert.ok(Buffer.byteLength(stored) > MARKDOWN_MAX_BYTES);
  assert.equal(await convertedRequestPurpose(false, undefined, stored), stored);
  assert.equal(await convertedRequestPurpose(false, undefined, null), null);
  assert.equal(await convertedRequestPurpose(true, 'Given **purpose**', stored), 'Given **purpose**');
  await assert.rejects(
    () => convertedRequestPurpose(true, stored, null),
    (error: unknown) => error instanceof HttpException
      && error.getStatus() === 400
      && (error.getResponse() as { code?: string }).code === MARKDOWN_TOO_LARGE,
  );
}

run()
  .then(async () => {
    await closeMarkdownWorkers();
    console.log('converted-request-purpose.spec OK');
  })
  .catch(async (error) => {
    console.error(error);
    await closeMarkdownWorkers();
    process.exit(1);
  });
