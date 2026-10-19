import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorldBankClient } from '../world-bank-client';

/**
 * A past year missing from a dataset older than 24 hours reloads the CSV once,
 * ignoring both the memory cache and a fresh file on disk. A young copy, and
 * a second ask inside the same window, do not download again. A failed reload
 * keeps the previous copy and still consumes the window.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const STALE_CSV = 'Country Name,Country Code,Indicator Name,2020\nEuro area,EMU,Official exchange rate,0.8\n';
const FRESH_CSV = 'Country Name,Country Code,Indicator Name,2020,2021\nEuro area,EMU,Official exchange rate,0.8,0.91\n';

async function withClient(run: (client: WorldBankClient, dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fx-'));
  const client = new WorldBankClient();
  (client as any).csvCacheDir = dir;
  try {
    await run(client, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function seedMemory(client: WorldBankClient, loadedAt: number) {
  const dataset = new Map<string, Map<number, number>>();
  dataset.set('EMU', new Map([[2020, 0.8]]));
  (client as any).annualDataCache = dataset;
  (client as any).annualDataLoadedAt = loadedAt;
}

function stubDownload(client: WorldBankClient, csv: string) {
  let downloads = 0;
  (client as any).requestBinaryWithRetry = async () => {
    downloads += 1;
    return Buffer.from('archive');
  };
  (client as any).extractCsvFromArchive = () => csv;
  return () => downloads;
}

async function testFreshDiskFileIsReused() {
  await withClient(async (client, dir) => {
    const csvPath = path.join(dir, 'world-bank-fcrf.csv');
    await fs.promises.writeFile(csvPath, STALE_CSV);
    const downloads = stubDownload(client, FRESH_CSV);
    const loaded = await (client as any).ensureAnnualCsvFile();
    assert.equal(loaded, csvPath);
    assert.equal(downloads(), 0, 'a file inside the CSV cache window is not downloaded again');
  });
}

async function testStaleDatasetReloadsOnceAndBypassesTheDiskFile() {
  await withClient(async (client, dir) => {
    const csvPath = path.join(dir, 'world-bank-fcrf.csv');
    await fs.promises.writeFile(csvPath, STALE_CSV);
    const downloads = stubDownload(client, FRESH_CSV);
    seedMemory(client, Date.now() - 2 * DAY);

    assert.equal(await client.refreshAnnualDatasetIfOlderThan(DAY), true);
    assert.equal(downloads(), 1, 'a stale copy is downloaded once');
    const reloaded = await client.fetchAnnualRates('EUR', 2021, 2021);
    assert.equal(reloaded.get(2021), 0.91, 'the new copy replaces the memory cache and the fresh file on disk');

    assert.equal(await client.refreshAnnualDatasetIfOlderThan(DAY), false);
    assert.equal(downloads(), 1, 'a copy just loaded is left in place');

    (client as any).annualDataLoadedAt = Date.now() - 2 * DAY;
    assert.equal(await client.refreshAnnualDatasetIfOlderThan(DAY), false, 'a process reloads at most once per window');
    assert.equal(downloads(), 1);
  });
}

async function testFileAgeDecidesACopyLoadedAtStartup() {
  await withClient(async (client, dir) => {
    const csvPath = path.join(dir, 'world-bank-fcrf.csv');
    await fs.promises.writeFile(csvPath, STALE_CSV);
    const old = new Date(Date.now() - 2 * DAY);
    await fs.promises.utimes(csvPath, old, old);
    const downloads = stubDownload(client, FRESH_CSV);

    const before = await client.fetchAnnualRates('EUR', 2021, 2021);
    assert.equal(before.get(2021), undefined, 'the file on disk has no value for the year');
    assert.equal(downloads(), 0, 'a file inside the CSV cache window is loaded without a download');

    assert.equal(await client.refreshAnnualDatasetIfOlderThan(DAY), true, 'the file time, not the moment it was read, ages the copy');
    assert.equal(downloads(), 1);
    const after = await client.fetchAnnualRates('EUR', 2021, 2021);
    assert.equal(after.get(2021), 0.91);
  });
}

async function testYoungDatasetIsNotReloaded() {
  await withClient(async (client) => {
    const downloads = stubDownload(client, FRESH_CSV);
    seedMemory(client, Date.now() - HOUR);
    (client as any).lastForcedAnnualRefreshAt = 0;
    assert.equal(await client.refreshAnnualDatasetIfOlderThan(DAY), false);
    assert.equal(downloads(), 0);
  });
}

async function testFailedReloadKeepsThePreviousDataset() {
  await withClient(async (client) => {
    let downloads = 0;
    (client as any).requestBinaryWithRetry = async () => {
      downloads += 1;
      throw new Error('upstream down');
    };
    seedMemory(client, Date.now() - 2 * DAY);

    assert.equal(await client.refreshAnnualDatasetIfOlderThan(DAY), false);
    assert.equal(downloads, 1);
    const kept = await client.fetchAnnualRates('EUR', 2020, 2020);
    assert.equal(kept.get(2020), 0.8, 'the previous copy stays in place');

    assert.equal(await client.refreshAnnualDatasetIfOlderThan(DAY), false);
    assert.equal(downloads, 1, 'a failed reload counts toward the window');
  });
}

(async () => {
  await testFreshDiskFileIsReused();
  await testStaleDatasetReloadsOnceAndBypassesTheDiskFile();
  await testFileAgeDecidesACopyLoadedAtStartup();
  await testYoungDatasetIsNotReloaded();
  await testFailedReloadKeepsThePreviousDataset();
  console.log('World Bank annual dataset reloads once when it is stale.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
