import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { deleteStorageObjects, STORAGE_DELETE_CONCURRENCY } from '../tenant-data-purge';

// deleteStorageObjects, after a tenant reset or purge: every object is asked for once, at most
// STORAGE_DELETE_CONCURRENCY at a time (several at once, not one by one), and a failure is
// counted and logged, never thrown.

async function testBoundedConcurrency() {
  let inFlight = 0;
  let peak = 0;
  const asked: string[] = [];
  const storage = {
    async deleteObject(key: string) {
      asked.push(key);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (key.endsWith('-13')) throw new Error('injected storage failure');
    },
  };
  const paths = Array.from({ length: 40 }, (_, i) => `spec/object-${i}`);
  const result = await deleteStorageObjects(storage as any, paths, 'storage delete spec');
  assert.equal(STORAGE_DELETE_CONCURRENCY, 8);
  assert.deepEqual([...asked].sort(), [...paths].sort(), 'each object once');
  assert.equal(peak, STORAGE_DELETE_CONCURRENCY, 'several at once, never more than the bound');
  assert.deepEqual(result, { deleted: 39, failed: 1 });

  assert.deepEqual(await deleteStorageObjects(storage as any, [], 'storage delete spec'), { deleted: 0, failed: 0 });
}

async function main() {
  await testBoundedConcurrency();
  console.log('ok - storage objects are deleted with a bounded concurrency');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
