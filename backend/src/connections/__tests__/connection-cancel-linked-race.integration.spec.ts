import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { mapDatabaseError } from '../../common/filters/database-error.mapping';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { InterfaceBindingsService } from '../../interface-bindings/interface-bindings.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { Asset } from '../../assets/asset.entity';
import { Connection } from '../connection.entity';
import { ConnectionServer } from '../connection-server.entity';
import { ConnectionProtocol } from '../connection-protocol.entity';
import { ConnectionLeg } from '../connection-leg.entity';
import { ConnectionsController } from '../connections.controller';
import { ConnectionsCrudService } from '../services/connections-crud.service';
import { assert, describe, progress, runRaceSpecs, settle, sql, withRace, type Outcome, type Race } from '../../spend/__tests__/race-harness';

// Lot N1b (decision P17): "Cancel" of a connection being created and a link set on it by another
// person (an interface binding, a document) at the same time, in both orders. The cancel locks the
// connection FOR UPDATE; the link's insert takes its key share through the foreign key, so one
// waits for the other:
// - cancel first: the link waits, then fails on the connection gone (409 `parent_gone`);
// - link first: the cancel waits, then reads the link under its lock and is refused (403
//   `CREATION_CANCEL_EXPIRED`), the connection and the link stay.
// Never a link lost without a refusal. When the link comes first, the interface case is the
// connection's second binding, after the creator's own first one: a first binding writes the only
// history row a binding leaves (its risk-mode switch), a second one none. The document case starts
// from an unlinked connection: only the read under the lock sees its link.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'connection-cancel-linked-race-spec-secret';

const SETTINGS = {
  lifecycleStates: [{ code: 'active' }],
  connectionTypes: [{ code: 'https' }],
  entities: [{ code: 'internet' }],
};

type LinkKind = 'interface' | 'document';

const LINK_TABLE: Record<LinkKind, string> = { interface: 'interface_connection_links', document: 'document_connections' };

function services() {
  const audit = new AuditService(dataSource.getRepository(AuditLog));
  const settings = {
    getSettingsForWrite: async () => SETTINGS,
    getSettings: async () => SETTINGS,
    getClassificationCatalog: async () => DEFAULT_CLASSIFICATION_CATALOG,
  };
  const crud = new ConnectionsCrudService(
    dataSource.getRepository(Connection),
    dataSource.getRepository(ConnectionServer),
    dataSource.getRepository(ConnectionProtocol),
    dataSource.getRepository(ConnectionLeg),
    dataSource.getRepository(Asset),
    settings as any,
    audit,
  );
  const controller = Object.assign(Object.create(ConnectionsController.prototype), {
    svc: {
      create: (body: any, tenantId: string, userId: string | null, opts: any) => crud.create(body, tenantId, userId, opts),
      delete: (id: string, userId: string | null, opts: any) => crud.delete(id, userId, opts),
    },
  }) as ConnectionsController;
  const bindings = Object.assign(Object.create(InterfaceBindingsService.prototype), { audit, repo: dataSource.getRepository(InterfaceBinding) }) as InterfaceBindingsService;
  const knowledge = Object.create(KnowledgeService.prototype) as KnowledgeService;
  return { controller, bindings, knowledge };
}

const reqOf = (tenantId: string, userId: string, manager: EntityManager) => ({ tenant: { id: tenantId }, user: { sub: userId }, queryRunner: { manager } });

/**
 * Two people, the creator's connection with its token, two bindings and a document. With
 * `creatorLinkedFirst`, the creator linked the first binding, so the other person's link is the
 * connection's second binding, which leaves no history row.
 */
async function seedRace(race: Race, opts: { creatorLinkedFirst: boolean }) {
  const tag = randomUUID().slice(0, 8);
  const base = await race.seedWith(async (runner) => {
    const id = async (text: string, params: unknown[]) => (await runner.query(`${text} RETURNING id`, params))[0].id as string;
    const [role] = await runner.query(
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, 'Infrastructure member', 'Infrastructure member', false, false, now(), now()) RETURNING id`,
      [race.tenantId],
    );
    const user = (name: string) => id(
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
       VALUES ($1, $2, 'Tester', $3, null, $4, false, 'enabled', now(), now())`,
      [race.tenantId, name, `${name.toLowerCase()}-${tag}@example.com`, role.id],
    );
    const creatorId = await user('Creator');
    const otherId = await user('Other');
    const web = await id(
      `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
       VALUES ($1, 'web-1', 'virtual_machine', 'on_prem', 'prod', 'active', now(), now())`,
      [race.tenantId],
    );
    const app = (name: string) => id(`INSERT INTO applications (tenant_id, name, status) VALUES ($1, $2, 'enabled')`, [race.tenantId, `${name}-${tag}`]);
    const [source, target] = [await app('Orders'), await app('Billing')];
    const instance = (applicationId: string) => id(`INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod')`, [race.tenantId, applicationId]);
    const [sourceInstance, targetInstance] = [await instance(source), await instance(target)];
    const interfaceId = await id(
      `INSERT INTO interfaces (tenant_id, interface_reference, name, source_application_id, target_application_id, business_purpose, data_category, integration_route_type)
       VALUES ($1, $2, 'Orders flow', $3, $4, 'Orders', 'orders', 'direct')`,
      [race.tenantId, `INT-${tag}`, source, target],
    );
    const binding = async (order: number) => {
      const leg = await id(
        `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type, integration_pattern, data_format, order_index)
         VALUES ($1, $2, 'source', 'source', 'target', 'schedule', 'batch', 'json', $3)`,
        [race.tenantId, interfaceId, order],
      );
      return id(
        `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id)
         VALUES ($1, $2, $3, 'prod', $4, $5)`,
        [race.tenantId, interfaceId, leg, sourceInstance, targetInstance],
      );
    };
    const firstBinding = await binding(1);
    const secondBinding = await binding(2);
    const library = await id(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, $2, $3)`, [race.tenantId, `Library ${tag}`, `library-${tag}`]);
    const document = await id(
      `INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, 'Firewall rules', 1, 'published')`,
      [race.tenantId, library],
    );
    return { creatorId, otherId, web, firstBinding, secondBinding, document };
  });
  const { controller, bindings } = services();
  const setupParty = await race.open('setup');
  const created: any = await race.start(setupParty, async (manager) => {
    const connection: any = await (controller as any).create(
      { name: 'Web out', source_asset_id: base.web, destination_entity_code: 'internet', protocol_codes: ['https'] },
      reqOf(race.tenantId, base.creatorId, manager),
    );
    // The creator's own first binding: the risk-mode switch is a history row of the creator.
    if (opts.creatorLinkedFirst) await bindings.createConnectionLink(base.firstBinding, { connection_id: connection.id }, race.tenantId, base.creatorId, { manager });
    return connection;
  });
  return { ...base, connectionId: created.id as string, token: created.creation_token as string };
}

/** The other person's link, as its writer sets it. */
function link(kind: LinkKind, seeded: Awaited<ReturnType<typeof seedRace>>, manager: EntityManager, tenantId: string): Promise<unknown> {
  const { bindings, knowledge } = services();
  return kind === 'interface'
    ? bindings.createConnectionLink(seeded.secondBinding, { connection_id: seeded.connectionId }, tenantId, seeded.otherId, { manager })
    : knowledge.addDocumentRelationByEntity(seeded.document, 'connections', seeded.connectionId, manager);
}

async function stateOf(race: Race, kind: LinkKind, connectionId: string) {
  const row = await race.readOne(
    `SELECT (SELECT count(*)::int FROM connections WHERE tenant_id = $1 AND id = $2) AS connection,
            (SELECT count(*)::int FROM ${LINK_TABLE[kind]} WHERE tenant_id = $1 AND connection_id = $2) AS links`,
    [race.tenantId, connectionId],
  );
  return { connection: Number(row.connection), links: Number(row.links) };
}

function assertParentGone(outcome: Outcome, who: string) {
  assert.ok(!outcome.ok, `${who} must fail on the connection gone; it ${describe(outcome)}`);
  const mapped = mapDatabaseError((outcome as { error: unknown }).error);
  assert.equal(mapped?.code, 'parent_gone', `${who} must end as 409 parent_gone; it ended with ${describe(outcome)}`);
  assert.equal(mapped?.exception.getStatus(), 409);
}

function assertCancelRefused(outcome: Outcome, who: string) {
  assert.ok(!outcome.ok, `${who} must be refused; it ${describe(outcome)}`);
  const error = (outcome as { error: unknown }).error;
  assert.ok(error instanceof ForbiddenException, `${who} must be a 403; it ended with ${describe(outcome)}`);
  assert.equal((error.getResponse() as any).code, 'CREATION_CANCEL_EXPIRED');
}

async function cancelFirst(kind: LinkKind) {
  await withRace(`conn-cancel-${kind}-a`, async (race) => {
    const seeded = await seedRace(race, { creatorLinkedFirst: false });
    const { controller } = services();
    const canceller = await race.open('canceller');
    const linker = await race.open('linker');
    // The cancel pauses once it holds the connection's lock.
    const locked = race.gate(canceller, { label: 'after its lock', when: 'after', match: sql.lockOn('connections') });
    const cancel = race.start(canceller, (manager) =>
      controller.cancelCreation(seeded.connectionId, { token: seeded.token }, reqOf(race.tenantId, seeded.creatorId, manager)));
    assert.equal(await progress(cancel, { party: canceller, gate: locked }), 'gated', 'the cancel holds the lock');
    const linking = race.start(linker, (manager) => link(kind, seeded, manager, race.tenantId));
    assert.equal(await progress(linking, { party: linker }), 'blocked', 'the link waits for the lock through its foreign key');
    locked.release();
    const cancelled = await settle(cancel);
    assert.ok(cancelled.ok, `the cancel must succeed; it ${describe(cancelled)}`);
    assertParentGone(await settle(linking), 'the link');
    assert.deepEqual(await stateOf(race, kind, seeded.connectionId), { connection: 0, links: 0 }, 'the connection is gone, and no link was set');
  });
}

async function linkFirst(kind: LinkKind) {
  await withRace(`conn-cancel-${kind}-b`, async (race) => {
    const seeded = await seedRace(race, { creatorLinkedFirst: kind === 'interface' });
    const { controller } = services();
    const canceller = await race.open('canceller');
    const linker = await race.open('linker');
    // The link pauses right after its insert, its transaction open.
    const inserted = race.gate(linker, { label: 'after its insert', when: 'after', match: sql.insertInto(LINK_TABLE[kind]) });
    const linking = race.start(linker, (manager) => link(kind, seeded, manager, race.tenantId));
    assert.equal(await progress(linking, { party: linker, gate: inserted }), 'gated', 'the link is inserted, not committed');
    const cancel = race.start(canceller, (manager) =>
      controller.cancelCreation(seeded.connectionId, { token: seeded.token }, reqOf(race.tenantId, seeded.creatorId, manager)));
    assert.equal(await progress(cancel, { party: canceller }), 'blocked', 'the cancel waits for the link');
    inserted.release();
    const linked = await settle(linking);
    assert.ok(linked.ok, `the link must succeed; it ${describe(linked)}`);
    assertCancelRefused(await settle(cancel), 'the cancel');
    const before = kind === 'interface' ? 2 : 1;
    assert.deepEqual(await stateOf(race, kind, seeded.connectionId), { connection: 1, links: before }, 'the connection and the link stay');
  });
}

void runRaceSpecs('Connection cancel and links', [
  ['cancel first, then an interface binding: the link fails on the connection gone', () => cancelFirst('interface')],
  ['cancel first, then a document: the link fails on the connection gone', () => cancelFirst('document')],
  ['an interface binding first, then the cancel: refused under the lock', () => linkFirst('interface')],
  ['a document first, then the cancel: refused under the lock', () => linkFirst('document')],
]);
