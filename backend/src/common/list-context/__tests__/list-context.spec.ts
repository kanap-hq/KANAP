import * as assert from 'node:assert/strict';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import * as express from 'express';
import { lastValueFrom, of } from 'rxjs';
import { parseListRequest } from '../../list-engine/list-state';
import { parseExportPagination, parsePagination } from '../../pagination';
import {
  canonicalJson,
  isListContextId,
  listContextId,
  MAX_LIST_CONTEXT_STATE_BYTES,
  mergeListContextQuery,
  normalizeListContextState,
  normalizeListKey,
} from '../list-context';
import { applyListContext, ListContextInterceptor } from '../list-context.interceptor';
import { ListContextsService } from '../list-contexts.service';

// Saved list states (lot 2B, PR B2), without a database: the content-addressed
// id, what a state may hold, how a request's own parameters override its
// context, and the interceptor on a real Express 5 request (whose `query` is a
// getter computed from the URL).

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SUPPLIERS = Array.from({ length: 1500 }, (_, i) => `Supplier ${String(i).padStart(4, '0')} — Société Générale d'Équipement`);
const bigFilters = { supplier_name: { filterType: 'set', values: SUPPLIERS } };

function testCanonicalJson() {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
  assert.equal(canonicalJson({ a: undefined, b: 'é' }), '{"b":"é"}');
}

function testIdIsContentAddressed() {
  const state = normalizeListContextState({ filters: bigFilters, sort: 'supplier_name:ASC' });
  const id = listContextId(TENANT_A, 'spend-items', state);
  assert.equal(id.length, 22);
  assert.ok(isListContextId(id), id);
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  // Same state, other key order, or filters spelled as a JSON string: same id.
  const reordered = normalizeListContextState({ sort: 'supplier_name:ASC', filters: JSON.stringify({ supplier_name: { values: SUPPLIERS, filterType: 'set' } }) });
  assert.equal(listContextId(TENANT_A, 'spend-items', reordered), id);
  // Another tenant, list or state: another id.
  assert.notEqual(listContextId(TENANT_B, 'spend-items', state), id);
  assert.notEqual(listContextId(TENANT_A, 'capex-items', state), id);
  assert.notEqual(listContextId(TENANT_A, 'spend-items', { ...state, sort: 'supplier_name:DESC' }), id);
  // Order of set values is part of the state (values are kept as given).
  const reversed = normalizeListContextState({ filters: { supplier_name: { filterType: 'set', values: [...SUPPLIERS].reverse() } }, sort: 'supplier_name:ASC' });
  assert.notEqual(listContextId(TENANT_A, 'spend-items', reversed), id);
}

function testStateValidation() {
  const bad = (raw: unknown) => assert.throws(() => normalizeListContextState(raw), BadRequestException, JSON.stringify(raw)?.slice(0, 80));
  bad(null);
  bad([1, 2]);
  bad('filters');
  bad({ ctx: 'abc' });
  bad({ __proto__x: 1 });
  bad({ '1sort': 'a' });
  bad({ filters: '{not json' });
  bad({ filters: '[1,2]' });
  bad({ filters: [1, 2] });
  bad({ sort: { field: 'a' } });
  bad({ years: [2026, { y: 1 }] });
  bad(Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, 'v'])));
  assert.throws(
    () => normalizeListContextState({ filters: { a: { filterType: 'set', values: ['x'.repeat(MAX_LIST_CONTEXT_STATE_BYTES)] } } }),
    PayloadTooLargeException,
  );
  // Empty values are dropped; scalars and scalar lists kept; `filters` as an object.
  assert.deepEqual(
    normalizeListContextState({ q: '', status: null, sort: 'a:ASC', includeDisabled: true, years: [2026, '2027'], limit: 50, filters: '{"a":{"filterType":"text","filter":"x"}}' }),
    { sort: 'a:ASC', includeDisabled: true, years: [2026, '2027'], limit: 50, filters: { a: { filterType: 'text', filter: 'x' } } },
  );
  assert.deepEqual(normalizeListContextState({ filters: '  ' }), {});
  assert.equal(normalizeListKey('/spend-items'), 'spend-items');
  assert.equal(normalizeListKey('portfolio/projects'), 'portfolio/projects');
  assert.throws(() => normalizeListKey(''), BadRequestException);
  assert.throws(() => normalizeListKey('a b'), BadRequestException);
  assert.throws(() => normalizeListKey(42), BadRequestException);
  assert.throws(() => normalizeListKey('x'.repeat(129)), BadRequestException);
}

function testExplicitParametersOverride() {
  const state = { filters: bigFilters, sort: 'supplier_name:ASC', q: 'cloud', status: 'enabled', years: ['2026', '2027'], page: 3 };
  const merged = mergeListContextQuery(state, { ctx: 'x'.repeat(22), page: '1', limit: '50', sort: 'yBudget:DESC', shape: 'grid' });
  assert.equal(merged.ctx, undefined, 'ctx is consumed');
  assert.equal(merged.page, '1', 'explicit page wins');
  assert.equal(merged.limit, '50');
  assert.equal(merged.sort, 'yBudget:DESC', 'explicit sort wins');
  assert.equal(merged.q, 'cloud', 'the context fills what the request leaves out');
  assert.equal(merged.status, 'enabled');
  assert.equal(merged.shape, 'grid');
  assert.deepEqual(merged.years, ['2026', '2027']);
  assert.equal(typeof merged.filters, 'string', 'filters travel as the JSON a client would send');
  assert.deepEqual(JSON.parse(merged.filters as string), bigFilters);
  // Explicit filters win over the context's.
  const own = mergeListContextQuery(state, { filters: '{"currency":{"filterType":"set","values":["EUR"]}}' });
  assert.deepEqual(JSON.parse(own.filters as string), { currency: { filterType: 'set', values: ['EUR'] } });

  // Every parser downstream reads the merged query as an inline one.
  const inline = { filters: JSON.stringify(bigFilters), sort: 'supplier_name:ASC', q: 'cloud', status: 'enabled', page: '2', limit: '50' };
  const fromContext = mergeListContextQuery({ filters: bigFilters, sort: 'supplier_name:ASC', q: 'cloud', status: 'enabled' }, { page: '2', limit: '50' });
  assert.deepEqual(parsePagination(fromContext), parsePagination(inline));
  assert.deepEqual(parseExportPagination(fromContext), parseExportPagination(inline));
  assert.deepEqual(parseListRequest(fromContext), parseListRequest(inline));
}

/** A real Express 5 request for `url`: its `query` is the prototype's getter, parsed from the URL. */
function expressRequest(url: string, method = 'GET'): any {
  const app = express();
  const req = Object.create(app.request);
  req.app = app;
  req.url = url;
  req.method = method;
  return req;
}

class FakeContexts extends ListContextsService {
  constructor(private readonly states: Record<string, Record<string, unknown>>) { super(); }
  override async find(_manager: any, tenantId: string, id: string) {
    const state = this.states[`${tenantId}/${id}`];
    return state ? { id, list: 'spend-items', state } : null;
  }
}

async function testInterceptorOnExpressRequest() {
  const id = listContextId(TENANT_A, 'spend-items', { filters: bigFilters });
  const contexts = new FakeContexts({ [`${TENANT_A}/${id}`]: { filters: bigFilters, sort: 'supplier_name:ASC' } });
  const req = expressRequest(`/spend-items/summary?ctx=${id}&page=2&limit=50&sort=yBudget:DESC`);
  assert.equal(req.query.ctx, id, 'Express parses the URL');
  await applyListContext(contexts, req, {} as any, TENANT_A);
  assert.equal(req.query.ctx, undefined);
  assert.equal(req.query.sort, 'yBudget:DESC');
  assert.equal(req.query.page, '2');
  assert.deepEqual(JSON.parse(req.query.filters), bigFilters);
  assert.equal(req.query, req.query, 'the merged query stays the request query');

  // Another tenant's id, an unknown id, a malformed id: 400.
  for (const [label, url, tenant, code] of [
    ['other tenant', `/x?ctx=${id}`, TENANT_B, 'list_context_not_found'],
    ['unknown', `/x?ctx=${'A'.repeat(22)}`, TENANT_A, 'list_context_not_found'],
    ['malformed', '/x?ctx=short', TENANT_A, 'list_context_invalid'],
    ['repeated', `/x?ctx=${id}&ctx=${id}`, TENANT_A, 'list_context_invalid'],
  ] as const) {
    await assert.rejects(
      () => applyListContext(contexts, expressRequest(url), {} as any, tenant),
      (err: unknown) => err instanceof BadRequestException && (err.getResponse() as { code?: string }).code === code,
      label,
    );
  }

  // The interceptor: GET with ctx and a tenant transaction only.
  const interceptor = new ListContextInterceptor(contexts);
  const run = async (req: any) => {
    const http = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any;
    let handled = false;
    const result = interceptor.intercept(http, { handle: () => { handled = true; return of('handled'); } });
    assert.equal(await lastValueFrom(result), 'handled');
    return handled;
  };
  const withTenant = (r: any) => Object.assign(r, { tenant: { id: TENANT_A }, queryRunner: { manager: {} } });
  const get = withTenant(expressRequest(`/x?ctx=${id}`));
  await run(get);
  assert.equal(get.query.sort, 'supplier_name:ASC', 'GET with ctx: merged');
  const post = withTenant(expressRequest(`/x?ctx=${id}`, 'POST'));
  await run(post);
  assert.equal(post.query.ctx, id, 'POST: left alone');
  const noTenant = expressRequest(`/x?ctx=${id}`);
  await run(noTenant);
  assert.equal(noTenant.query.ctx, id, 'no tenant transaction: left alone');
  const plain = withTenant(expressRequest('/x?sort=a:ASC'));
  await run(plain);
  assert.equal(plain.query.sort, 'a:ASC', 'no ctx: untouched');
}

async function main() {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ['canonical JSON', testCanonicalJson],
    ['content-addressed id', testIdIsContentAddressed],
    ['state validation', testStateValidation],
    ['explicit parameters override the context', testExplicitParametersOverride],
    ['interceptor on an Express 5 request', testInterceptorOnExpressRequest],
  ];
  for (const [label, test] of tests) {
    await test();
    console.log(`ok - ${label}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
