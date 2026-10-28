// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import {
  RecordHistoryService,
  type RecordHistoryChange,
  type RecordHistoryContext,
  type RecordHistoryItem,
  type RecordHistoryPage,
} from '../record-history.service';
import {
  audit,
  seedHistoryData,
  seedPerson,
  type HistorySeed,
  type Level,
  type Person,
} from './record-history.fixtures';

// The asset and technology histories (lot 2, family D) on the migrated database: their own rows,
// every child kind through the real writer (so the payload rules fill `parent_*` where they
// apply), the three read modes, the reference resolution with the reader's modules, a catalogue
// synchronization authored by the system, and the access rules (403 without infrastructure, 404
// for an unknown, missing or foreign record).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const ASSET_MODULES: Record<string, Level> = { infrastructure: 'reader' };
const ALL_MODULES: Record<string, Level> = {
  infrastructure: 'reader', budget: 'reader', contracts: 'reader', portfolio_projects: 'reader',
  companies: 'reader', suppliers: 'reader', contacts: 'reader', applications: 'reader', locations: 'reader',
};

type Seeded = {
  data: HistorySeed;
  cluster: string;
  related: string;
  version: string;
  assetReader: Person;
  technologyReader: Person;
  allReader: Person;
  noModules: Person;
};

function withManager(ctx: RecordHistoryContext, runner: QueryRunner): RecordHistoryContext {
  return { ...ctx, manager: runner.manager };
}

async function withRunner<T>(tenantId: string, fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return await fn(runner);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

async function readPage(
  person: Person,
  tenantId: string,
  table: string,
  id: string,
  permissions: Record<string, Level>,
): Promise<RecordHistoryPage> {
  return withRunner(tenantId, (runner) => {
    const ctx: RecordHistoryContext = {
      tenantId,
      userId: person.id,
      isAdmin: false,
      permissions,
      manager: runner.manager,
    };
    return new RecordHistoryService().list(ctx, table, id);
  });
}

function kinds(page: RecordHistoryPage): string[] {
  return page.items.map((item) => item.subject.kind);
}

function findChange(page: RecordHistoryPage, field: string, event?: 'added' | 'removed'): { item: RecordHistoryItem; change: RecordHistoryChange } | null {
  for (const item of page.items) {
    for (const change of item.changes) {
      if (change.field === field && (event === undefined || change.event === event)) return { item, change };
    }
  }
  return null;
}

function assertNoRawId(page: RecordHistoryPage, id: string) {
  assert.equal(JSON.stringify(page).includes(id), false, `the raw id ${id} never reaches the answer`);
}

function assertPresentable(page: RecordHistoryPage) {
  for (const item of page.items) {
    for (const change of item.changes) {
      for (const value of [change.before, change.after]) {
        if (value === null || value === undefined || typeof value !== 'object') continue;
        if (Array.isArray(value)) {
          assert.ok(
            value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item)),
            `${change.field}: a scalar list`,
          );
          continue;
        }
        assert.ok(
          (value as any).hidden === true || typeof (value as any).kind === 'string',
          `${change.field}: a structured value is a reference`,
        );
      }
    }
  }
  const serialized = JSON.stringify(page);
  for (const raw of ['after_json', 'before_json', 'tenant_id', 'created_at', 'updated_at', 'row_version']) {
    assert.ok(!serialized.includes(`"${raw}"`), `${raw}: no raw payload key`);
  }
}

async function seedFamily(runner: QueryRunner, data: HistorySeed): Promise<Seeded> {
  const cluster = (await runner.query(
    `INSERT INTO assets (tenant_id, name, asset_reference, kind, environment, is_cluster, status)
     VALUES ($1, 'Cluster One', 'AST-3', 'cluster', 'prod', true, 'active') RETURNING id`,
    [data.tenantId],
  ))[0].id as string;
  const related = (await runner.query(
    `INSERT INTO assets (tenant_id, name, asset_reference, kind, environment, status)
     VALUES ($1, 'Server Two', 'AST-2', 'physical_server', 'prod', 'active') RETURNING id`,
    [data.tenantId],
  ))[0].id as string;
  const version = (await runner.query(
    `INSERT INTO technology_versions (tenant_id, technology_id, label, cpe_version, build_prefixes, standard_support_end, extended_support_end)
     VALUES ($1, $2, '2.1', '2.1', ARRAY['2.1.'], '2027-06-30', '2028-06-30') RETURNING id`,
    [data.tenantId, data.technology],
  ))[0].id as string;

  const assetReader = await seedPerson(runner, data.tenantId, { first: 'Aline', last: 'Asset' }, { infrastructure: 'reader' });
  const technologyReader = await seedPerson(runner, data.tenantId, { first: 'Tina', last: 'Tech' }, { infrastructure: 'reader' });
  const allReader = await seedPerson(runner, data.tenantId, { first: 'Alba', last: 'All' }, ALL_MODULES);
  const noModules = await seedPerson(runner, data.tenantId, { first: 'Nino', last: 'None' }, { tasks: 'reader' });

  await audit(runner, {
    table: 'assets', recordId: data.asset, action: 'create', userId: allReader.id,
    after: {
      id: data.asset, tenant_id: data.tenantId, name: 'Server One', asset_reference: 'AST-1',
      kind: 'physical_server', environment: 'prod', status: 'active', location_id: data.location,
      notes: 'First server', is_cluster: false,
    },
  });
  await audit(runner, {
    table: 'assets', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { name: 'Server One', asset_reference: 'AST-1', kind: 'physical_server', environment: 'prod', status: 'active', notes: 'First server' },
    after: { name: 'Server One renamed', asset_reference: 'AST-1', kind: 'physical_server', environment: 'prod', status: 'retired', notes: 'First server' },
  });

  await audit(runner, {
    table: 'asset_relations', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { relations: [] },
    after: { relations: [{ related_asset_id: related, relation_type: 'depends_on' }] },
  });
  await audit(runner, {
    table: 'asset_relations', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { relations: [{ related_asset_id: related, relation_type: 'depends_on' }] },
    after: { relations: [] },
  });
  await audit(runner, {
    table: 'asset_cluster_members', recordId: cluster, action: 'update', userId: allReader.id,
    before: { members: [] }, after: { members: [data.asset] },
  });
  await audit(runner, {
    table: 'asset_cluster_members', recordId: cluster, action: 'update', userId: allReader.id,
    before: { members: [data.asset] }, after: { members: [] },
  });
  const hardwareId = randomUUID();
  const hardwareRow = {
    id: hardwareId, tenant_id: data.tenantId, asset_id: data.asset, serial_number: 'SN-1',
    manufacturer: 'Dell', model: 'R640', purchase_date: '2024-01-01', rack_location: 'R1', rack_unit: '12', notes: null,
  };
  await audit(runner, {
    table: 'asset_hardware_info', recordId: hardwareId, action: 'create', userId: allReader.id,
    after: hardwareRow,
  });
  await audit(runner, {
    table: 'asset_hardware_info', recordId: hardwareId, action: 'delete', userId: allReader.id,
    before: hardwareRow, after: null,
  });
  const supportId = randomUUID();
  const supportRow = {
    id: supportId, tenant_id: data.tenantId, asset_id: data.asset, vendor_id: data.supplier,
    support_contract_id: data.contractA, support_tier: 'gold', support_expiry: '2027-01-01', notes: null,
  };
  await audit(runner, {
    table: 'asset_support_info', recordId: supportId, action: 'create', userId: allReader.id,
    after: supportRow,
  });
  await audit(runner, {
    table: 'asset_support_info', recordId: supportId, action: 'delete', userId: allReader.id,
    before: supportRow, after: null,
  });
  const linkId = randomUUID();
  const assetLink = { id: linkId, tenant_id: data.tenantId, asset_id: data.asset, url: 'https://example.invalid/asset', description: 'Asset docs' };
  await audit(runner, {
    table: 'asset_links', recordId: linkId, action: 'create', userId: allReader.id,
    after: assetLink,
  });
  await audit(runner, {
    table: 'asset_links', recordId: linkId, action: 'delete', userId: allReader.id,
    before: assetLink, after: null,
  });
  const attachmentId = randomUUID();
  const assetAttachment = {
    id: attachmentId, tenant_id: data.tenantId, asset_id: data.asset, original_filename: 'asset.txt',
    stored_filename: 'stored.txt', mime_type: 'text/plain', size: 12, storage_path: 'files/asset.txt', uploaded_at: '2026-01-01T00:00:00.000Z',
  };
  await audit(runner, {
    table: 'asset_attachments', recordId: attachmentId, action: 'create', userId: allReader.id,
    after: assetAttachment,
  });
  await audit(runner, {
    table: 'asset_attachments', recordId: attachmentId, action: 'delete', userId: allReader.id,
    before: assetAttachment, after: null,
  });
  await audit(runner, {
    table: 'asset_contracts', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { ids: [] }, after: { ids: [data.contractA] },
  });
  await audit(runner, {
    table: 'asset_contracts', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { ids: [data.contractA] }, after: { ids: [] },
  });
  await audit(runner, {
    table: 'asset_projects', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { ids: [] }, after: { ids: [data.project] },
  });
  await audit(runner, {
    table: 'asset_projects', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { ids: [data.project] }, after: { ids: [] },
  });
  await audit(runner, {
    table: 'asset_spend_items', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { ids: [] }, after: { ids: [data.opexLine] },
  });
  await audit(runner, {
    table: 'asset_spend_items', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { ids: [data.opexLine] }, after: { ids: [] },
  });
  await audit(runner, {
    table: 'asset_capex_items', recordId: data.asset, action: 'update', userId: allReader.id,
    before: { ids: [] }, after: { ids: [data.capexLine] },
  });
  const installedLink = {
    id: randomUUID(), asset_id: data.asset, technology_id: data.technology, technology_version_id: version,
    is_operating_system: true, notes: null, source: 'manual',
  };
  await audit(runner, {
    table: 'asset_technologies', recordId: data.technology, action: 'create', userId: allReader.id,
    after: installedLink,
  });
  await audit(runner, {
    table: 'asset_technologies', recordId: data.technology, action: 'delete', userId: allReader.id,
    before: installedLink, after: null,
  });

  await audit(runner, {
    table: 'technologies', recordId: data.technology, action: 'create', userId: allReader.id,
    after: {
      id: data.technology, tenant_id: data.tenantId, item_number: 9, name: 'Postgres', editor: 'PostgreSQL',
      family: 'database', hosting_type: 'on_prem', lifecycle: 'active', description: 'Database',
      notes: null, support_notes: null, catalog_key: null, cpe_products: ['a:postgresql:postgresql'],
      cve_names: [], replaced_by_id: null, cyber_criticality: 'high', recovery_wave: 'vital',
      rto_minutes: 60, rpo_minutes: 15, admin_zone: 'tier1', vulnerability_alerts: true, catalog_state: {},
    },
  });
  await audit(runner, {
    table: 'technologies', recordId: data.technology, action: 'update', userId: allReader.id,
    before: { name: 'Postgres', editor: 'PostgreSQL', family: 'database', hosting_type: 'on_prem', lifecycle: 'active' },
    after: { name: 'PostgreSQL', editor: 'PostgreSQL', family: 'database', hosting_type: 'public_cloud', lifecycle: 'active' },
  });
  await audit(runner, {
    table: 'technologies', recordId: data.technology, action: 'update', userId: null, source: 'system',
    before: null,
    after: {
      catalog_sync: {
        versions_added: ['2.2'], versions_updated: [], versions_attached: [],
        cpe_products_added: ['a:postgresql:postgresql'], cpe_products_removed: [],
        cve_names_added: ['CVE-2026-0001'], cve_names_removed: [],
        description_filled: true, description_updated: false,
      },
    },
  });

  const versionRow = {
    id: version, tenant_id: data.tenantId, technology_id: data.technology, label: '2.1',
    cpe_version: '2.1', build_prefixes: ['2.1.'], standard_support_end: '2027-06-30',
    extended_support_end: '2028-06-30', notes: null, catalog_key: 'postgresql:2.1',
    vulnerability_alerts: true, vulnerability_alerts_effective: true,
  };
  await audit(runner, {
    table: 'technology_versions', recordId: data.technology, action: 'create', userId: allReader.id,
    after: versionRow,
  });
  await audit(runner, {
    table: 'technology_versions', recordId: data.technology, action: 'delete', userId: allReader.id,
    before: versionRow, after: null,
  });
  await audit(runner, {
    table: 'technology_owners', recordId: data.technology, action: 'update', userId: allReader.id,
    before: [], after: [`it:${data.owner}`, `business:${allReader.id}`],
  });
  await audit(runner, {
    table: 'technology_owners', recordId: data.technology, action: 'update', userId: allReader.id,
    before: [`it:${data.owner}`, `business:${allReader.id}`], after: [`business:${allReader.id}`],
  });
  await audit(runner, {
    table: 'technology_support_contacts', recordId: data.technology, action: 'update', userId: allReader.id,
    before: [], after: [`${data.contact}:technical`],
  });
  await audit(runner, {
    table: 'technology_support_contacts', recordId: data.technology, action: 'update', userId: allReader.id,
    before: [`${data.contact}:technical`], after: [],
  });
  await audit(runner, {
    table: 'application_technologies', recordId: data.technology, action: 'update', userId: allReader.id,
    before: null, after: { added: [data.application] },
  });
  await audit(runner, {
    table: 'application_technologies', recordId: data.technology, action: 'update', userId: allReader.id,
    before: { removed: [data.application] }, after: null,
  });
  await audit(runner, {
    table: 'technology_contracts', recordId: data.technology, action: 'update', userId: allReader.id,
    before: { ids: [] }, after: { ids: [data.contractA] },
  });
  await audit(runner, {
    table: 'technology_contracts', recordId: data.technology, action: 'update', userId: allReader.id,
    before: { ids: [data.contractA] }, after: { ids: [] },
  });
  await audit(runner, {
    table: 'technology_projects', recordId: data.technology, action: 'update', userId: allReader.id,
    before: { ids: [] }, after: { ids: [data.project] },
  });
  await audit(runner, {
    table: 'technology_projects', recordId: data.technology, action: 'update', userId: allReader.id,
    before: { ids: [data.project] }, after: { ids: [] },
  });
  await audit(runner, {
    table: 'technology_spend_items', recordId: data.technology, action: 'update', userId: allReader.id,
    before: { ids: [] }, after: { ids: [data.opexLine] },
  });
  await audit(runner, {
    table: 'technology_spend_items', recordId: data.technology, action: 'update', userId: allReader.id,
    before: { ids: [data.opexLine] }, after: { ids: [] },
  });
  const technologyLink = randomUUID();
  const techLinkRow = { id: technologyLink, tenant_id: data.tenantId, technology_id: data.technology, url: 'https://example.invalid/tech', description: 'Tech docs' };
  await audit(runner, {
    table: 'technology_links', recordId: technologyLink, action: 'create', userId: allReader.id,
    after: techLinkRow,
  });
  await audit(runner, {
    table: 'technology_links', recordId: technologyLink, action: 'delete', userId: allReader.id,
    before: techLinkRow, after: null,
  });
  const technologyAttachment = randomUUID();
  const techAttachmentRow = {
    id: technologyAttachment, tenant_id: data.tenantId, technology_id: data.technology, original_filename: 'tech.txt',
    stored_filename: 'stored-tech.txt', mime_type: 'text/plain', size: 10, storage_path: 'files/tech.txt', uploaded_at: '2026-01-01T00:00:00.000Z',
  };
  await audit(runner, {
    table: 'technology_attachments', recordId: technologyAttachment, action: 'create', userId: allReader.id,
    after: techAttachmentRow,
  });
  await audit(runner, {
    table: 'technology_attachments', recordId: technologyAttachment, action: 'delete', userId: allReader.id,
    before: techAttachmentRow, after: null,
  });
  const vulnerability = randomUUID();
  await audit(runner, {
    table: 'technology_vulnerabilities', recordId: vulnerability, action: 'update', userId: allReader.id,
    before: { id: vulnerability, technology_id: data.technology, cve_id: 'CVE-2026-1234', state: 'to_review', note: null },
    after: { id: vulnerability, technology_id: data.technology, cve_id: 'CVE-2026-1234', state: 'handled', note: 'Patched' },
  });

  return { data, cluster, related, version, assetReader, technologyReader, allReader, noModules };
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const { data } = seeded;
  const asset = await readPage(seeded.assetReader, data.tenantId, 'assets', data.asset, ASSET_MODULES);
  assert.ok(asset.items.length > 0, 'an infrastructure reader reads the asset history');
  const technology = await readPage(seeded.technologyReader, data.tenantId, 'technologies', data.technology, ASSET_MODULES);
  assert.ok(technology.items.length > 0, 'an infrastructure reader reads the technology history');

  await assert.rejects(
    () => readPage(seeded.noModules, data.tenantId, 'assets', data.asset, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'no infrastructure gets 403 MODULE_RIGHT_REQUIRED',
  );
  await assert.rejects(
    () => readPage(seeded.noModules, data.tenantId, 'technologies', data.technology, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'no infrastructure gets 403 on a technology',
  );
  for (const [table, id] of [['assets', data.asset], ['technologies', data.technology]] as const) {
    await assert.rejects(
      () => readPage(seeded.allReader, data.tenantId, table, randomUUID(), ALL_MODULES),
      (error: any) => error?.status === 404,
      `${table}: a missing record gets 404`,
    );
    await assert.rejects(
      () => readPage(seeded.allReader, data.tenantId, table, 'not-a-uuid', ALL_MODULES),
      (error: any) => error?.status === 404,
      `${table}: a malformed id gets 404`,
    );
    await assert.rejects(
      () => readPage(seeded.allReader, data.tenantId, table, table === 'assets' ? foreign.asset : foreign.technology, ALL_MODULES),
      (error: any) => error?.status === 404,
      `${table}: another tenant's record gets 404`,
    );
  }
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'unknown_table', data.asset, ALL_MODULES),
    (error: any) => error?.status === 404,
    'an unknown table gets 404',
  );
  console.log('  200 with infrastructure, 403 without it, 404 for unknown, missing, malformed and foreign records: OK');
}

async function testAssetEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, 'assets', data.asset, ALL_MODULES);
  assertPresentable(page);
  const found = new Set(kinds(page));
  for (const kind of ['record', 'relation', 'hardware', 'support', 'link', 'attachment', 'technology', 'contract', 'project', 'budget_line']) {
    assert.ok(found.has(kind), `${kind}: an entry of that subject kind`);
  }

  const create = page.items.find((item) => item.subject.kind === 'record' && item.action === 'create');
  assert.ok(create, 'the asset creation is an entry');
  const created = (field: string) => findChange({ ...page, items: [create!] }, field);
  assert.equal(created('name')?.change.after, 'Server One');
  assert.equal(created('asset_reference')?.change.after, 'AST-1');
  assert.equal(created('kind')?.change.after, 'physical_server');
  const location = created('location_id')?.change.after as any;
  assert.equal(location.kind, 'location');
  assert.equal(location.label, 'Paris DC');

  const update = page.items.find((item) => item.subject.kind === 'record' && item.action === 'update');
  assert.ok(update, 'the asset update is an entry');
  assert.equal(findChange({ ...page, items: [update!] }, 'name')?.change.after, 'Server One renamed');
  assert.equal(findChange({ ...page, items: [update!] }, 'status')?.change.after, 'retired');
  assert.equal(findChange({ ...page, items: [update!] }, 'operating_system'), null, 'the derived operating system is not a field change');

  const relation = findChange(page, 'relation_depends_on', 'added');
  assert.ok(relation, 'the relation is added');
  assert.equal((relation.change.after as any).label, 'Server Two');
  assert.ok(findChange(page, 'relation_depends_on', 'removed'), 'the relation is removed');
  const cluster = await readPage(seeded.assetReader, data.tenantId, 'assets', seeded.cluster, ASSET_MODULES);
  const member = findChange(cluster, 'member', 'added');
  assert.ok(member, 'the cluster member is added on the cluster s history');
  assert.equal((member.change.after as any).label, 'Server One');
  assert.ok(findChange(cluster, 'member', 'removed'), 'the cluster member is removed');

  const hardware = page.items.find((item) => item.subject.kind === 'hardware' && item.action === 'create');
  assert.ok(hardware, 'the hardware sheet is an entry');
  const serial = hardware!.changes.find((change) => change.field === 'serial_number');
  assert.equal(serial?.after, 'SN-1');
  assert.equal(hardware!.changes.some((change) => change.field === 'asset_id'), false, 'the record link is hidden');

  assert.ok(page.items.some((item) => item.subject.kind === 'hardware' && item.action === 'delete'), 'the hardware deletion is an entry');
  const support = page.items.find((item) => item.subject.kind === 'support' && item.action === 'create');
  assert.ok(support, 'the support sheet is an entry');
  const vendor = support!.changes.find((change) => change.field === 'vendor_id');
  assert.equal((vendor?.after as any).kind, 'supplier');
  const contract = support!.changes.find((change) => change.field === 'support_contract_id');
  assert.equal((contract?.after as any).kind, 'contract');
  assert.ok(page.items.some((item) => item.subject.kind === 'support' && item.action === 'delete'), 'the support deletion is an entry');

  const link = findChange(page, 'link', 'added');
  assert.ok(link, 'the web link is added');
  assert.equal((link.change.after as any).label, 'Asset docs');
  const attachment = findChange(page, 'attachment', 'added');
  assert.ok(attachment, 'the attachment is added');
  assert.equal((attachment.change.after as any).label, 'asset.txt');
  assert.ok(findChange(page, 'attachment', 'removed'), 'the attachment is removed');

  const technology = findChange(page, 'operating_system', 'added');
  assert.ok(technology, 'the installed operating system is added in words');
  assert.equal((technology.change.after as any).label, 'Postgres');
  assert.equal((technology.change.after as any).reference, 'TEC-9');
  assert.ok(findChange(page, 'operating_system', 'removed'), 'the installed operating system is removed');

  const linkedContract = findChange(page, 'contract', 'added');
  assert.ok(linkedContract, 'the contract link is added');
  assert.equal((linkedContract.change.after as any).label, 'Support Contract');
  assert.ok(findChange(page, 'contract', 'removed'), 'the contract link is removed');
  const linkedProject = findChange(page, 'project', 'added');
  assert.equal((linkedProject?.change.after as any).reference, 'PRJ-7');
  assert.ok(findChange(page, 'project', 'removed'), 'the project link is removed');
  const lineRefs = new Set(page.items.flatMap((item) => item.changes
    .filter((change) => change.field === 'budget_line' && change.event === 'added')
    .map((change) => (change.after as any)?.reference)));
  assert.ok(lineRefs.has('BL-1'), 'the OPEX line link is added');
  assert.ok(lineRefs.has('BL-2'), 'the CAPEX line link is added');
  assert.ok(findChange(page, 'budget_line', 'removed'), 'the OPEX line link is removed');

  // An infrastructure-only reader names the technologies and assets, and hides the other modules.
  const narrow = await readPage(seeded.assetReader, data.tenantId, 'assets', data.asset, ASSET_MODULES);
  const narrowContract = findChange(narrow, 'contract', 'added');
  assert.deepEqual(narrowContract?.change.after, { hidden: true, kind: 'contract' }, 'a contract is hidden without its module');
  const narrowLine = findChange(narrow, 'budget_line', 'added');
  assert.deepEqual(narrowLine?.change.after, { hidden: true, kind: 'budget_line' }, 'a budget line is hidden without its module');
  const narrowTechnology = findChange(narrow, 'operating_system', 'added');
  assert.equal((narrowTechnology?.change.after as any).label, 'Postgres', 'the technology is named with infrastructure');
  assertNoRawId(page, data.tenantId);
  console.log('  asset creation, update, relation, member, hardware, support, link, attachment, technology, contract, project and line links in words: OK');
}

async function testTechnologyEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, 'technologies', data.technology, ALL_MODULES);
  assertPresentable(page);
  const found = new Set(kinds(page));
  for (const kind of ['record', 'technology_version', 'owner', 'contact', 'application', 'asset', 'contract', 'project', 'budget_line', 'link', 'attachment', 'vulnerability']) {
    assert.ok(found.has(kind), `${kind}: an entry of that subject kind`);
  }

  const create = page.items.find((item) => item.subject.kind === 'record' && item.action === 'create');
  assert.ok(create, 'the technology creation is an entry');
  assert.equal(findChange({ ...page, items: [create!] }, 'name')?.change.after, 'Postgres');
  assert.equal(findChange({ ...page, items: [create!] }, 'family')?.change.after, 'database');
  const update = page.items.find((item) => item.subject.kind === 'record' && item.changes.some((change) => change.field === 'hosting_type'));
  assert.ok(update, 'the technology update is an entry');
  assert.equal(findChange({ ...page, items: [update!] }, 'hosting_type')?.change.after, 'public_cloud');

  const versionCreate = page.items.find((item) => item.subject.kind === 'technology_version' && item.action === 'create');
  assert.ok(versionCreate, 'the version creation is an entry');
  assert.equal(versionCreate!.subject.label, '2.1');
  assert.deepEqual(versionCreate!.changes, [], 'a version creation shows its title only');
  assert.ok(page.items.some((item) => item.subject.kind === 'technology_version' && item.action === 'delete'), 'the version deletion is an entry');

  const owner = findChange(page, 'owner_it', 'added');
  assert.ok(owner, 'the IT owner is added');
  assert.equal((owner.change.after as any).label, 'Ava Reader');
  const businessOwner = findChange(page, 'owner_business', 'added');
  assert.ok(businessOwner, 'the business owner is added');
  assert.equal((businessOwner.change.after as any).label, 'Alba All');
  assert.ok(findChange(page, 'owner_it', 'removed'), 'the IT owner is removed');

  const contact = findChange(page, 'contact', 'added');
  assert.ok(contact, 'the support contact is added');
  assert.equal((contact.change.after as any).label, 'Cora Contact');
  assert.ok(findChange(page, 'contact', 'removed'), 'the support contact is removed');

  const application = findChange(page, 'application', 'added');
  assert.ok(application, 'the application link is added');
  assert.equal((application.change.after as any).label, 'Ledger App');
  assert.ok(findChange(page, 'application', 'removed'), 'the application link is removed');
  const asset = findChange(page, 'asset', 'added');
  assert.ok(asset, 'the asset link is added');
  assert.equal((asset.change.after as any).label, 'Server One');
  assert.ok(findChange(page, 'asset', 'removed'), 'the asset link is removed');
  const linkedContract = findChange(page, 'contract', 'added');
  assert.equal((linkedContract?.change.after as any).label, 'Support Contract');
  assert.ok(findChange(page, 'contract', 'removed'), 'the contract link is removed');
  const linkedProject = findChange(page, 'project', 'added');
  assert.equal((linkedProject?.change.after as any).reference, 'PRJ-7');
  assert.ok(findChange(page, 'project', 'removed'), 'the project link is removed');
  const line = findChange(page, 'budget_line', 'added');
  assert.equal((line?.change.after as any).reference, 'BL-1');
  assert.ok(findChange(page, 'budget_line', 'removed'), 'the budget line link is removed');
  const link = findChange(page, 'link', 'added');
  assert.equal((link?.change.after as any).label, 'Tech docs');
  assert.ok(findChange(page, 'link', 'removed'), 'the web link is removed');
  const attachment = findChange(page, 'attachment', 'added');
  assert.equal((attachment?.change.after as any).label, 'tech.txt');
  assert.ok(findChange(page, 'attachment', 'removed'), 'the attachment is removed');

  const vulnerability = findChange(page, 'vulnerability_state');
  assert.ok(vulnerability, 'the vulnerability state change is an entry');
  assert.equal(vulnerability!.item.subject.label, 'CVE-2026-1234');
  assert.equal(vulnerability!.change.before, 'to_review');
  assert.equal(vulnerability!.change.after, 'handled');
  const note = findChange(page, 'note');
  assert.equal(note?.change.after, 'Patched');

  const sync = page.items.find((item) => item.actor.kind === 'system' && item.changes.some((change) => change.field === 'versions_added'));
  assert.ok(sync, 'the catalogue synchronization is an entry');
  assert.equal(sync!.actor.name, null);
  assert.deepEqual(findChange({ ...page, items: [sync!] }, 'versions_added')?.change.after, ['2.2']);
  assert.equal(findChange({ ...page, items: [sync!] }, 'description_filled')?.change.after, true);

  // An infrastructure-only reader names the assets and technologies, and hides the other modules.
  const narrow = await readPage(seeded.technologyReader, data.tenantId, 'technologies', data.technology, ASSET_MODULES);
  assert.deepEqual(findChange(narrow, 'application', 'added')?.change.after, { hidden: true, kind: 'application' }, 'an application is hidden without its module');
  assert.deepEqual(findChange(narrow, 'contact', 'added')?.change.after, { hidden: true, kind: 'contact' }, 'a contact is hidden without its module');
  assert.equal((findChange(narrow, 'asset', 'added')?.change.after as any).label, 'Server One', 'the asset is named with infrastructure');
  assertNoRawId(page, data.tenantId);
  console.log('  technology creation, update, version, owners, contact, application, asset, contract, project, line, link, attachment and vulnerability in words: OK');
}

async function testParentRows(seeded: Seeded) {
  const { data } = seeded;
  const rows: Array<{ table_name: string; parent_table: string | null; parent_id: string | null }> = await withRunner(
    data.tenantId,
    (runner) => runner.query(
      `SELECT table_name, parent_table, parent_id
         FROM audit_log
        WHERE tenant_id = $1 AND table_name IN ('asset_hardware_info', 'asset_links', 'asset_technologies', 'technology_links', 'technology_vulnerabilities')
        ORDER BY table_name`,
      [data.tenantId],
    ),
  );
  assert.equal(rows.find((row) => row.table_name === 'asset_hardware_info')?.parent_table, 'assets');
  assert.equal(rows.find((row) => row.table_name === 'asset_links')?.parent_table, 'assets');
  assert.equal(rows.find((row) => row.table_name === 'asset_technologies')?.parent_table, 'assets');
  assert.equal(rows.find((row) => row.table_name === 'technology_links')?.parent_table, 'technologies');
  assert.equal(rows.find((row) => row.table_name === 'technology_vulnerabilities')?.parent_table, 'technologies');
  console.log('  the payload rules fill parent_table and parent_id for the children written by payload: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-family-d');
  const foreignTenantId = await createRaceTenant('record-history-family-d-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => {
      const data = await seedHistoryData(runner, tenantId);
      return seedFamily(runner, data);
    });
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));

    await testAccess(seeded, foreign);
    await testAssetEntries(seeded);
    await testTechnologyEntries(seeded);
    await testParentRows(seeded);
    console.log('record-history-family-d.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(foreignTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
