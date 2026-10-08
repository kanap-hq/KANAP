import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { TenantBaselineService } from '../tenant-baseline.service';

// The outcome of the default global chart of accounts (TenantBaselineService): created from the
// template, skipped when no template is marked to load by default, failed (logged, never thrown).
// Fakes only: outside a transaction the savepoint helper runs the step directly.

function service(opts: { template: boolean; failOn?: string }) {
  const calls: string[] = [];
  const step = (name: string, result: unknown = undefined) => async () => {
    calls.push(name);
    if (opts.failOn === name) throw new Error(`${name} failed`);
    return result;
  };
  const coas = {
    create: step('create', { id: 'coa-1' }),
    loadTemplateIntoCoa: step('load'),
    setGlobalDefault: step('default'),
    setConsolidation: step('consolidation'),
  };
  const manager = {
    query: async () => (opts.template ? [{ id: 'tpl-1', template_code: 'IFRS', template_name: 'IFRS' }] : []),
  };
  return { svc: new TenantBaselineService({} as any, coas as any, {} as any), manager: manager as any, calls };
}

async function testOutcomes() {
  const created = service({ template: true });
  assert.equal(await created.svc.provisionDefaultGlobalCoa(created.manager), 'provisioned');
  assert.deepEqual(created.calls, ['create', 'load', 'default', 'consolidation']);

  const skipped = service({ template: false });
  assert.equal(await skipped.svc.provisionDefaultGlobalCoa(skipped.manager), 'skipped');
  assert.deepEqual(skipped.calls, []);

  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const failed = service({ template: true, failOn: 'load' });
    assert.equal(await failed.svc.provisionDefaultGlobalCoa(failed.manager), 'failed');
    assert.deepEqual(failed.calls, ['create', 'load']);
  } finally {
    console.warn = warn;
  }
}

testOutcomes()
  .then(() => console.log('tenant-baseline.service.spec: ok'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
