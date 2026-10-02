import * as assert from 'node:assert/strict';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import * as express from 'express';
import { lastValueFrom, of } from 'rxjs';
import { RATE_LIMITS } from '../../rate-limit';
import { UserRateLimitGuard } from '../../rate-limit.guard';
import { ListContextsController } from '../list-contexts.controller';
import { parseListRequest } from '../../list-engine/list-state';
import { parseExportPagination, parsePagination } from '../../pagination';
import {
  canonicalJson,
  isListContextId,
  listContextId,
  MAX_LIST_CONTEXT_FILTER_DEPTH,
  MAX_LIST_CONTEXT_STATE_BYTES,
  mergeListContextQuery,
  normalizeListContextState,
  normalizeListKey,
} from '../list-context';
import { applyListContext, ListContextInterceptor } from '../list-context.interceptor';
import { ListContextsService } from '../list-contexts.service';

// Saved list states (lot 2B, PR B2), without a database: the content-addressed
// id (set values in any order give one id), what a state may hold (the column
// filters only, bounded in size and depth), that a context only ever brings
// its filters into a request (inline filters first), and the interceptor on a
// real Express 5 request (whose `query` is a getter computed from the URL).

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SUPPLIERS = Array.from({ length: 1500 }, (_, i) => `Supplier ${String(i).padStart(4, '0')} — Société Générale d'Équipement`);
const bigFilters = { supplier_name: { filterType: 'set', values: SUPPLIERS } };

function testCanonicalJson() {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
  assert.equal(canonicalJson({ a: undefined, b: 'é' }), '{"b":"é"}');
}

function testIdIsContentAddressed() {
  const state = normalizeListContextState({ filters: bigFilters });
  const id = listContextId(TENANT_A, 'spend-items', state);
  assert.equal(id.length, 22);
  assert.ok(isListContextId(id), id);
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  // Same filters, other key order, or spelled as a JSON string: same id.
  const reordered = normalizeListContextState({ filters: JSON.stringify({ supplier_name: { values: SUPPLIERS, filterType: 'set' } }) });
  assert.equal(listContextId(TENANT_A, 'spend-items', reordered), id);
  // The same selection in another order is the same state: set values are sorted before the id.
  const reversed = normalizeListContextState({ filters: { supplier_name: { filterType: 'set', values: [...SUPPLIERS].reverse() } } });
  assert.equal(listContextId(TENANT_A, 'spend-items', reversed), id);
  const mixed = normalizeListContextState({ filters: { s: { filterType: 'set', mode: 'exclude', values: ['b', null, 'a', 'B'] } } });
  assert.deepEqual(mixed, { filters: { s: { filterType: 'set', mode: 'exclude', values: ['"B"', '"a"', '"b"', 'null'].map((v) => JSON.parse(v)) } } });
  assert.equal(
    listContextId(TENANT_A, 'x', mixed),
    listContextId(TENANT_A, 'x', normalizeListContextState({ filters: { s: { values: [null, 'B', 'a', 'b'], mode: 'exclude', filterType: 'set' } } })),
  );
  // Another tenant, list or filters: another id.
  assert.notEqual(listContextId(TENANT_B, 'spend-items', state), id);
  assert.notEqual(listContextId(TENANT_A, 'capex-items', state), id);
  assert.notEqual(listContextId(TENANT_A, 'spend-items', normalizeListContextState({ filters: { supplier_name: { filterType: 'set', values: SUPPLIERS.slice(1) } } })), id);
}

function testStateValidation() {
  const bad = (raw: unknown) => assert.throws(() => normalizeListContextState(raw), BadRequestException, JSON.stringify(raw)?.slice(0, 80));
  bad(null);
  bad([1, 2]);
  bad('filters');
  bad({ ctx: 'abc' });
  bad({ filters: '{not json' });
  bad({ filters: '[1,2]' });
  bad({ filters: [1, 2] });
  bad({ filters: 'text' });
  // Only the column filters are saved: any other list parameter is refused, even empty.
  for (const key of ['sort', 'q', 'status', 'includeDisabled', 'limit', 'page', 'years', 'shape', 'fte', 'amounts']) {
    bad({ filters: { a: { filterType: 'text', filter: 'x' } }, [key]: '1' });
  }
  bad({ sort: '' });
  assert.throws(
    () => normalizeListContextState({ filters: { a: { filterType: 'set', values: ['x'.repeat(MAX_LIST_CONTEXT_STATE_BYTES)] } } }),
    PayloadTooLargeException,
  );
  // Nesting: a real model is kept; past the bound, 400 (not a stack overflow in the serialization).
  const conditions = { a: { filterType: 'number', operator: 'AND', conditions: [{ filterType: 'number', type: 'inRange', filter: 1, filterTo: 9 }] } };
  assert.deepEqual(normalizeListContextState({ filters: conditions }), { filters: conditions });
  let deep: unknown = 'leaf';
  for (let i = 0; i < MAX_LIST_CONTEXT_FILTER_DEPTH; i++) deep = { n: deep };
  assert.doesNotThrow(() => normalizeListContextState({ filters: deep }), 'exactly at the bound');
  deep = { n: deep };
  bad({ filters: deep });
  // 100,000 levels, as an object and as the JSON text a client posts.
  let abyss: unknown = 0;
  for (let i = 0; i < 100_000; i++) abyss = [abyss];
  assert.throws(() => normalizeListContextState({ filters: { a: abyss } }), BadRequestException);
  assert.throws(() => normalizeListContextState({ filters: `{"a":${'['.repeat(100_000)}0${']'.repeat(100_000)}}` }), BadRequestException);
  // `filters` as an object; empty filters give an empty state.
  assert.deepEqual(
    normalizeListContextState({ filters: '{"a":{"filterType":"text","filter":"x"}}' }),
    { filters: { a: { filterType: 'text', filter: 'x' } } },
  );
  assert.deepEqual(normalizeListContextState({ filters: '  ' }), {});
  assert.deepEqual(normalizeListContextState({ filters: {} }), {});
  assert.deepEqual(normalizeListContextState({ filters: null }), {});
  assert.deepEqual(normalizeListContextState({}), {});
  assert.equal(normalizeListKey('/spend-items'), 'spend-items');
  assert.equal(normalizeListKey('portfolio/projects'), 'portfolio/projects');
  assert.throws(() => normalizeListKey(''), BadRequestException);
  assert.throws(() => normalizeListKey('a b'), BadRequestException);
  assert.throws(() => normalizeListKey(42), BadRequestException);
  assert.throws(() => normalizeListKey('x'.repeat(129)), BadRequestException);
}

function testContextBringsFiltersOnly() {
  // A row holding more than filters (crafted, or saved before contexts held filters only): only
  // its filters reach the request; the request's own parameters stay as sent.
  const state = { filters: bigFilters, sort: 'supplier_name:ASC', q: 'cloud', status: 'all', includeDisabled: 'true', limit: '100000', years: ['2026', '2027'], page: 3 };
  const merged = mergeListContextQuery(state, { ctx: 'x'.repeat(22), page: '1', limit: '50', sort: 'yBudget:DESC', shape: 'grid' });
  assert.deepEqual(Object.keys(merged).sort(), ['filters', 'limit', 'page', 'shape', 'sort']);
  assert.equal(merged.ctx, undefined, 'ctx is consumed');
  assert.equal(merged.page, '1');
  assert.equal(merged.limit, '50');
  assert.equal(merged.sort, 'yBudget:DESC');
  assert.equal(merged.shape, 'grid');
  assert.equal(typeof merged.filters, 'string', 'filters travel as the JSON a client would send');
  assert.deepEqual(JSON.parse(merged.filters as string), bigFilters);
  const bare = mergeListContextQuery(state, { ctx: 'x'.repeat(22) });
  assert.deepEqual(Object.keys(bare), ['filters'], 'no status, search, page size or years from a context');
  // Inline filters win over the context's.
  const own = mergeListContextQuery(state, { filters: '{"currency":{"filterType":"set","values":["EUR"]}}' });
  assert.deepEqual(JSON.parse(own.filters as string), { currency: { filterType: 'set', values: ['EUR'] } });
  // A context without filters adds nothing.
  assert.deepEqual(mergeListContextQuery({}, { ctx: 'x', page: '2' }), { page: '2' });
  assert.deepEqual(mergeListContextQuery({ filters: {} }, { page: '2' }), { page: '2' });
  assert.deepEqual(mergeListContextQuery({ filters: '[]' }, { page: '2' }), { page: '2' });

  // Every parser downstream reads the merged query as an inline one.
  const inline = { filters: JSON.stringify(bigFilters), sort: 'supplier_name:ASC', q: 'cloud', status: 'enabled', page: '2', limit: '50' };
  const fromContext = mergeListContextQuery({ filters: bigFilters }, { sort: 'supplier_name:ASC', q: 'cloud', status: 'enabled', page: '2', limit: '50' });
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
  assert.deepEqual(JSON.parse(get.query.filters), bigFilters, 'GET with ctx: merged');
  assert.equal(get.query.sort, undefined, 'the stored sort is not a filter: not merged');
  const post = withTenant(expressRequest(`/x?ctx=${id}`, 'POST'));
  await run(post);
  assert.equal(post.query.ctx, id, 'POST: left alone');
  const plain = withTenant(expressRequest('/x?sort=a:ASC'));
  await run(plain);
  assert.equal(plain.query.sort, 'a:ASC', 'no ctx: untouched');
  // A route without a tenant transaction (public, @SkipTenantTransaction): ctx answers 400, the
  // handler never runs, rather than a list silently shown unfiltered.
  for (const [label, req] of [
    ['no tenant', Object.assign(expressRequest(`/x?ctx=${id}`), { queryRunner: { manager: {} } })],
    ['no transaction', Object.assign(expressRequest(`/x?ctx=${id}`), { tenant: { id: TENANT_A } })],
  ] as const) {
    let handled = false;
    const http = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any;
    await assert.rejects(
      () => lastValueFrom(interceptor.intercept(http, { handle: () => { handled = true; return of('handled'); } })),
      (err: unknown) => err instanceof BadRequestException && (err.getResponse() as { code?: string }).code === 'list_context_unavailable',
      label,
    );
    assert.equal(handled, false, label);
  }
}

/** POST /list-contexts goes through the app's throttler, per user: the route's limit, then 429. */
async function testSavesAreRateLimitedPerUser() {
  const previous = process.env.RATE_LIMIT_ENABLED;
  process.env.RATE_LIMIT_ENABLED = 'true';
  const storage = new ThrottlerStorageService();
  try {
    // The app-wide default (app.module.ts) is 10 a minute; the route's own limit applies.
    const guard = new UserRateLimitGuard([{ ttl: 60_000, limit: 10 }], storage, new Reflector());
    await guard.onModuleInit();
    const headers: Record<string, unknown> = {};
    const call = (user: string | null, ip = '10.0.0.1') => guard.canActivate({
      getHandler: () => ListContextsController.prototype.save,
      getClass: () => ListContextsController,
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ ip, headers: {}, tenant: { id: TENANT_A }, ...(user ? { user: { sub: user } } : {}) }),
        getResponse: () => ({ header: (name: string, value: unknown) => { headers[name] = value; } }),
      }),
    } as any);
    const { limit } = RATE_LIMITS.listContextSave;
    assert.ok(limit > 10, 'more than the app-wide default');
    for (let i = 0; i < limit; i++) assert.equal(await call('user-1'), true, `save ${i + 1}`);
    assert.equal(headers['X-RateLimit-Limit'], limit);
    await assert.rejects(() => call('user-1'), ThrottlerException, 'one more: 429');
    // Counted per user, not per address: a colleague behind the same proxy still saves.
    assert.equal(await call('user-2'), true);
    assert.equal(await call('user-2', '10.9.9.9'), true);
    // Without a user (never on this route, behind JwtAuthGuard): per address.
    assert.equal(await call(null, '10.0.0.7'), true);
  } finally {
    storage.onApplicationShutdown();
    if (previous === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = previous;
  }
}

async function main() {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ['canonical JSON', testCanonicalJson],
    ['content-addressed id', testIdIsContentAddressed],
    ['state validation', testStateValidation],
    ['a context brings its filters only, inline filters first', testContextBringsFiltersOnly],
    ['interceptor on an Express 5 request', testInterceptorOnExpressRequest],
    ['saving is rate limited per user', testSavesAreRateLimitedPerUser],
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
