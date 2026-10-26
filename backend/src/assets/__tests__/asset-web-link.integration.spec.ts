import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import dataSource from '../../data-source';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Asset } from '../asset.entity';
import { AssetsAttachmentsService } from '../services/assets-attachments.service';

// A web link on an asset is http or https. `pas une url` is `link_url_invalid` on create and on update.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function refused(run: () => Promise<unknown>): Promise<{ code: string; params: { value: string } }> {
  try {
    await run();
  } catch (err) {
    assert.ok(err instanceof BadRequestException, String(err));
    return (err as BadRequestException).getResponse() as { code: string; params: { value: string } };
  }
  assert.fail('expected a 400');
}

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-link');
      const links = new AssetsAttachmentsService(
        runner.manager.getRepository(Asset),
        {} as any,
        {} as any,
        {} as any,
        { log: async () => undefined } as any,
        {} as any,
      );
      const opts = { manager: runner.manager, tenantId };
      await runner.query(
        `INSERT INTO assets (tenant_id, name, kind, provider, environment, status) VALUES ($1, 'Edge', 'vm', 'other', 'prod', 'active')`,
        [tenantId],
      );
      const [asset] = await runner.query(`SELECT id FROM assets WHERE tenant_id = $1 AND name = 'Edge'`, [tenantId]);

      const created = await refused(() => links.createLink(asset.id, { url: 'pas une url', description: 'QA-C4 lien' } as any, null, opts));
      assert.equal(created.code, 'link_url_invalid');
      assert.equal(created.params.value, 'pas une url');

      const saved = await links.createLink(asset.id, { url: ' https://example.com/qa-c4 ', description: 'Docs' } as any, null, opts);
      assert.equal(saved.url, 'https://example.com/qa-c4');

      const updated = await refused(() => links.updateLink(asset.id, saved.id, { url: 'ftp://files.example.test' } as any, null, opts));
      assert.equal(updated.code, 'link_url_invalid');
      assert.equal(updated.params.value, 'ftp://files.example.test');
      const kept = await links.updateLink(asset.id, saved.id, { description: 'Kept' } as any, null, opts);
      assert.equal(kept.url, 'https://example.com/qa-c4');
    });
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('asset web link integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
