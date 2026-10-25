import 'dotenv/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContractsService } from '../contracts.service';
import { buildShareEmail } from '../../notifications/notification-templates';
import { seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// "Send link" on a contract, against a real database: the share goes to notifyShare as a
// `contract` with the contract's name; recipients are people of the contract's tenant who can
// sign in (a person of another tenant is dropped), plus plain addresses; a contract of another
// tenant is not found and nothing is sent; no recipient at all is a 400. The e-mail names the
// contract in every language.

async function seedContract(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const companyId = await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`, [tenantId, `Share company ${tag}`]);
  const supplierId = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Share supplier ${tag}`]);
  const contractId = await one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, DATE '2026-01-01') RETURNING id`,
    [tenantId, `Share contract ${tag}`, companyId, supplierId],
  );
  const userId = await seedUser(runner, tenantId, `share-${tag}-${tenantId.slice(0, 8)}@example.com`);
  return { tenantId, contractId, userId };
}

function contracts(shares: any[]): ContractsService {
  const args: any[] = Array.from({ length: 9 }, () => undefined);
  args[4] = captureAudit();
  args[8] = { notifyShare: (params: any) => { shares.push(params); } };
  return new (ContractsService as any)(...args);
}

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function testShareContract() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedContract(runner, 'ctshare-a');
    const b = await seedContract(runner, 'ctshare-b');
    await setTenant(runner, b.tenantId);
    const shares: any[] = [];
    const svc = contracts(shares);
    const opts = { manager: runner.manager };

    // A person of the tenant and a plain address; a person of another tenant is dropped.
    assert.deepEqual(
      await svc.shareContract(b.contractId, { recipient_user_ids: [b.userId, a.userId], recipient_emails: ['buyer@example.com'], message: 'Renewal due' }, b.userId, opts),
      { ok: true, cannot_open: [] },
    );
    assert.equal(shares.length, 1);
    assert.equal(shares[0].itemType, 'contract');
    assert.equal(shares[0].itemId, b.contractId);
    assert.equal(shares[0].itemName, 'Share contract ctshare-b');
    assert.equal(shares[0].tenantId, b.tenantId);
    assert.equal(shares[0].senderName, 'Cost Owner');
    assert.deepEqual(shares[0].recipients.map((r: any) => r.userId), [b.userId]);
    assert.deepEqual(shares[0].rawEmails, ['buyer@example.com']);

    // A contract of another tenant is not found: nothing is sent.
    assert.ok((await rejection(() => svc.shareContract(a.contractId, { recipient_emails: ['x@example.com'] }, b.userId, opts))) instanceof NotFoundException);
    // No recipient at all.
    assert.ok((await rejection(() => svc.shareContract(b.contractId, {}, b.userId, opts))) instanceof BadRequestException);
    // Only a person of another tenant: nobody to send to.
    await svc.shareContract(b.contractId, { recipient_user_ids: [a.userId] }, b.userId, opts);
    assert.equal(shares.length, 1);
  });
}

async function testShareEmail() {
  const expected: Record<string, string> = { en: 'Contract', fr: 'Contrat', de: 'Vertrag', es: 'Contrato' };
  for (const [locale, label] of Object.entries(expected)) {
    const email = buildShareEmail({
      itemType: 'contract',
      itemName: 'SAP Maintenance',
      itemUrl: 'https://acme.kanap.net/ops/contracts/c-1/overview',
      senderName: 'Ada',
      locale,
    });
    assert.ok(email.subject.includes('SAP Maintenance'), `${locale} subject names the contract`);
    assert.ok(email.html.includes(label), `${locale} names the type`);
    assert.ok(email.html.includes('/ops/contracts/c-1/overview'), `${locale} links the contract`);
  }
}

void runSpecs('contract-share.integration.spec', [
  ['testShareContract', testShareContract],
  ['testShareEmail', testShareEmail],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
