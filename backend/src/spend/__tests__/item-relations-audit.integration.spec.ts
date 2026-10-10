import 'dotenv/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItemsService } from '../spend-items.service';
import { SpendItemContactsService } from '../spend-item-contacts.service';
import { CapexItemsService } from '../spend-items.service';
import { CapexItemContactsService } from '../spend-item-contacts.service';
import { assert, captureAudit, inRolledBackTransaction, Kind, runSpecs, seedItem, seedTenant, setTenant } from './round-inputs.fixtures';

// An item's relations, from the item's side, on OPEX and CAPEX alike:
// - applications: list and replace the whole set, every statement scoped by
//   the tenant, an application of another tenant refused, one audit row
//   (sorted application ids) when the set changes, another item's links kept;
// - contacts (OPEX now audits like CAPEX): attach, detach and supplier sync
//   write audit rows with the user; detaching a link of another item is a 404;
// - an edit of the line through update() moves its updated_at.

const USER = '00000000-0000-4000-8000-00000000abcd';
const KINDS: Kind[] = ['opex', 'capex'];
// The CAPEX lines share the OPEX tables since lot Z1; their audit rows keep the CAPEX table names.
const T = {
  opex: {
    items: 'spend_items', links: 'application_spend_items', itemFk: 'spend_item_id', contacts: 'spend_item_contacts',
    auditLinks: 'application_spend_items', auditContacts: 'spend_item_contacts',
  },
  capex: {
    items: 'spend_items', links: 'application_spend_items', itemFk: 'spend_item_id', contacts: 'spend_item_contacts',
    auditLinks: 'application_capex_items', auditContacts: 'capex_item_contacts',
  },
} as const;

function contactsService(kind: Kind, audit: unknown): any {
  const args = [undefined, undefined, undefined, audit];
  return kind === 'opex' ? new (SpendItemContactsService as any)(...args) : new (CapexItemContactsService as any)(...args);
}

/** The item service of each scope on the real class; only the dependencies these paths use. */
function itemService(kind: Kind, audit: unknown, contacts: unknown = contactsService(kind, audit)): any {
  // One constructor for both natures since lot Z1.
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[3] = audit;
  args[8] = contacts;
  return kind === 'opex' ? new (SpendItemsService as any)(...args) : new (CapexItemsService as any)(...args);
}

/** The runner's manager, recording every raw statement it runs. */
function recordingManager(manager: EntityManager, sql: string[]): EntityManager {
  return new Proxy(manager, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (query: string, params?: unknown[]) => {
          sql.push(query);
          return target.query(query, params);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function seedApplication(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const [app] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  return app.id;
}

async function seedCompany(runner: QueryRunner, tenantId: string): Promise<string> {
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Relations test company', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );
  return company.id;
}

async function linkedApplications(runner: QueryRunner, kind: Kind, tenantId: string, itemId: string): Promise<string[]> {
  const rows = await runner.query(
    `SELECT application_id FROM ${T[kind].links} WHERE tenant_id = $1 AND ${T[kind].itemFk} = $2 ORDER BY application_id`,
    [tenantId, itemId],
  );
  return rows.map((r: any) => r.application_id);
}

async function testApplications(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const otherTenant = await seedTenant(runner, `apps-other-${kind}`);
    const foreignApp = await seedApplication(runner, otherTenant, 'Application of another tenant');
    const tenantId = await seedTenant(runner, `apps-${kind}`);
    const [zeta, alpha, beta] = [
      await seedApplication(runner, tenantId, 'Zeta'),
      await seedApplication(runner, tenantId, 'Alpha'),
      await seedApplication(runner, tenantId, 'Beta'),
    ];
    const itemId = await seedItem(runner, kind, tenantId, 1, 'Line with applications');
    const otherItemId = await seedItem(runner, kind, tenantId, 2, 'Other line');
    await runner.query(
      `INSERT INTO ${T[kind].links} (tenant_id, ${T[kind].itemFk}, application_id) VALUES ($1, $2, $3)`,
      [tenantId, otherItemId, alpha],
    );

    const audit = captureAudit();
    const svc = itemService(kind, audit);
    const sql: string[] = [];
    const mg = recordingManager(runner.manager, sql);

    const replaced = await svc.bulkReplaceApplications(itemId, [zeta, ` ${alpha} `, zeta, ''], USER, { manager: mg });
    assert.deepEqual(replaced.items.map((a: any) => a.name), ['Alpha', 'Zeta'], `${kind}: trimmed, deduplicated, sorted by name`);
    assert.deepEqual(await linkedApplications(runner, kind, tenantId, itemId), [alpha, zeta].sort(), `${kind}: stored set`);
    const expectedAfter = [alpha, zeta].sort();
    assert.deepEqual(audit.entries, [
      { table: T[kind].auditLinks, recordId: itemId, action: 'update', before: [], after: expectedAfter, userId: USER },
    ], `${kind}: one audit row with the sorted application ids`);

    const listed = await svc.listApplications(itemId, { manager: mg });
    assert.deepEqual(listed.items, [{ id: alpha, name: 'Alpha' }, { id: zeta, name: 'Zeta' }], `${kind}: list`);

    const touching = sql.filter((q) => q.includes(T[kind].links));
    assert.ok(touching.length >= 4, `${kind}: list and replace ran raw statements on the link table`);
    for (const q of touching) {
      assert.match(q, /tenant_id = \$1|INSERT INTO/, `${kind}: every statement carries the tenant: ${q}`);
    }
    const insert = touching.find((q) => q.includes('INSERT INTO'));
    assert.match(insert ?? '', /\(tenant_id, /, `${kind}: the insert writes the item's tenant`);

    // Same set again, even in upper case or twice in two cases: nothing changes, no audit row.
    await svc.bulkReplaceApplications(itemId, [zeta, alpha], USER, { manager: mg });
    const upper = await svc.bulkReplaceApplications(itemId, [zeta.toUpperCase(), alpha, alpha.toUpperCase()], USER, { manager: mg });
    assert.deepEqual(upper.items.map((a: any) => a.id), [alpha, zeta], `${kind}: upper-case ids name the same applications`);
    assert.equal(audit.entries.length, 1, `${kind}: an unchanged set writes no audit row`);

    // An application of another tenant (or not an application at all) is refused and nothing changes.
    for (const ids of [[beta, foreignApp], ['not-a-uuid']]) {
      await assert.rejects(
        () => svc.bulkReplaceApplications(itemId, ids, USER, { manager: mg }),
        (err: unknown) => err instanceof BadRequestException && /One or more applications were not found\./.test((err as Error).message),
        `${kind}: ${ids.join(',')} refused`,
      );
    }
    assert.deepEqual(await linkedApplications(runner, kind, tenantId, itemId), expectedAfter, `${kind}: refused replace leaves the set`);

    // Emptying the set.
    const emptied = await svc.bulkReplaceApplications(itemId, [], USER, { manager: mg });
    assert.deepEqual(emptied.items, [], `${kind}: emptied`);
    assert.deepEqual(audit.entries[1], { table: T[kind].auditLinks, recordId: itemId, action: 'update', before: expectedAfter, after: [], userId: USER });

    assert.deepEqual(await linkedApplications(runner, kind, tenantId, otherItemId), [alpha], `${kind}: the other line's link is untouched`);
    await setTenant(runner, otherTenant);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${T[kind].links} WHERE tenant_id = $1`, [otherTenant]);
    assert.equal(n, 0, `${kind}: nothing written in the other tenant`);
  });
}

async function seedSupplierWithContact(runner: QueryRunner, tenantId: string, tag: string) {
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Supplier ${tag}`]);
  const [contact] = await runner.query(
    `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, $2, 'Supplier', 'Contact') RETURNING id`,
    [tenantId, `supplier-${tag}@example.com`],
  );
  await runner.query(
    `INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'commercial')`,
    [tenantId, supplier.id, contact.id],
  );
  return { supplierId: supplier.id as string, contactId: contact.id as string };
}

async function testContactsAudit(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `contacts-${kind}`);
    const itemId = await seedItem(runner, kind, tenantId, 1, 'Line with contacts');
    const otherItemId = await seedItem(runner, kind, tenantId, 2, 'Other line');
    const [manual] = await runner.query(
      `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, 'manual@example.com', 'Manual', 'Contact') RETURNING id`,
      [tenantId],
    );
    const { supplierId, contactId } = await seedSupplierWithContact(runner, tenantId, kind);
    const audit = captureAudit();
    const contacts = contactsService(kind, audit);
    const opts = { manager: runner.manager, tenantId };

    const link = await contacts.attachManual(itemId, { contactId: manual.id, role: 'technical' }, USER, opts);
    assert.deepEqual(
      audit.entries.map((e) => [e.table, e.recordId, e.action, e.before, e.userId]),
      [[T[kind].auditContacts, link.id, 'create', null, USER]],
      `${kind}: attach audited with the user`,
    );
    assert.equal(audit.entries[0].after.id, link.id);

    await assert.rejects(
      () => contacts.detach(otherItemId, link.id, USER, opts),
      (err: unknown) => err instanceof NotFoundException,
      `${kind}: a link of another item is not found`,
    );
    const [{ n: kept }] = await runner.query(`SELECT count(*)::int AS n FROM ${T[kind].contacts} WHERE id = $1`, [link.id]);
    assert.equal(kept, 1, `${kind}: the link is kept`);
    assert.equal(audit.entries.length, 1, `${kind}: no audit row for the refused detach`);

    await contacts.detach(itemId, link.id, USER, opts);
    assert.deepEqual(
      [audit.entries[1].table, audit.entries[1].recordId, audit.entries[1].action, audit.entries[1].before?.id, audit.entries[1].after, audit.entries[1].userId],
      [T[kind].auditContacts, link.id, 'delete', link.id, null, USER],
      `${kind}: detach audited with the user`,
    );

    // The supplier sync runs from update() when the supplier changes, with the editing user.
    const companyId = await seedCompany(runner, tenantId);
    const svc = itemService(kind, captureAudit(), contacts);
    await svc.update(itemId, { paying_company_id: companyId, supplier_id: supplierId }, USER, opts);
    assert.deepEqual(audit.entries[2], {
      table: T[kind].auditContacts,
      recordId: itemId,
      action: 'update',
      before: [],
      after: [`${contactId}:commercial`],
      userId: USER,
    }, `${kind}: supplier sync audited with the user`);

    // A sync that changes nothing writes no audit row.
    await contacts.syncFromSupplierForItem(itemId, USER, opts);
    assert.equal(audit.entries.length, 3, `${kind}: an unchanged sync writes no audit row`);
  });
}

async function testUpdateMovesUpdatedAt(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `updated-at-${kind}`);
    const itemId = await seedItem(runner, kind, tenantId, 1, 'Edited line');
    const companyId = await seedCompany(runner, tenantId);
    await runner.query(`UPDATE ${T[kind].items} SET created_at = '2020-01-01', updated_at = '2020-01-01' WHERE id = $1`, [itemId]);
    const svc = itemService(kind, captureAudit(), { syncFromSupplier: async () => undefined });
    const before = Date.now();
    await svc.update(itemId, { paying_company_id: companyId, notes: 'Edited' }, USER, { manager: runner.manager });
    const [row] = await runner.query(`SELECT created_at, updated_at, notes FROM ${T[kind].items} WHERE id = $1`, [itemId]);
    assert.equal(row.notes, 'Edited');
    assert.ok(new Date(row.updated_at).getTime() >= before - 1000, `${kind}: updated_at moved to the edit (${row.updated_at})`);
    assert.equal(new Date(row.created_at).toISOString(), new Date('2020-01-01').toISOString(), `${kind}: created_at kept`);
  });
}

void runSpecs('item-relations-audit.integration.spec', KINDS.flatMap((kind) => [
  [`testApplications(${kind})`, () => testApplications(kind)],
  [`testContactsAudit(${kind})`, () => testContactsAudit(kind)],
  [`testUpdateMovesUpdatedAt(${kind})`, () => testUpdateMovesUpdatedAt(kind)],
] as Array<[string, () => Promise<void>]>));

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
