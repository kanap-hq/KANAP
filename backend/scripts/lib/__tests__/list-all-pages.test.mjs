// Unit tests of the fixture loader's list walk (node --test).
//
//   node --test backend/scripts/lib/__tests__/list-all-pages.test.mjs
//
// A list answer pages with `page` (the API ignores `offset`). 450 rows are
// three pages of 200. A server that ignores `page` and keeps returning a full
// page stops at the page cap.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LIST_PAGE_CAP, LIST_PAGE_SIZE, listAllPages } from '../list-all-pages.mjs';

const PAGE = 200;

function rows(count, start = 0) {
  return Array.from({ length: count }, (_, index) => ({ id: start + index }));
}

function pageOf(route) {
  return Number(new URL(route, 'http://list.test').searchParams.get('page'));
}

test('450 rows served by page come back in three calls', async () => {
  assert.equal(LIST_PAGE_SIZE, PAGE);
  const all = rows(450);
  const calls = [];
  const apiGet = async (route) => {
    calls.push(route);
    const url = new URL(route, 'http://list.test');
    // Honours `page` only: `limit` and `offset` do not change the slice.
    const page = Number(url.searchParams.get('page'));
    const start = (page - 1) * PAGE;
    return { items: all.slice(start, start + PAGE) };
  };

  const listed = await listAllPages(apiGet)('/spend-items?status=enabled');

  assert.equal(calls.length, 3);
  assert.equal(listed.length, 450);
  assert.deepEqual(listed.map((row) => row.id), all.map((row) => row.id));
  assert.deepEqual(calls, [
    '/spend-items?status=enabled&limit=200&page=1',
    '/spend-items?status=enabled&limit=200&page=2',
    '/spend-items?status=enabled&limit=200&page=3',
  ]);
  for (const route of calls) {
    assert.equal(new URL(route, 'http://list.test').searchParams.get('offset'), null);
  }
});

test('a full last page stops once total is reached', async () => {
  let calls = 0;
  const apiGet = async (route) => {
    calls += 1;
    const page = pageOf(route);
    return {
      items: rows(LIST_PAGE_SIZE, (page - 1) * LIST_PAGE_SIZE),
      total: LIST_PAGE_SIZE * 2,
    };
  };

  const listed = await listAllPages(apiGet)('/capex-items?status=enabled');

  assert.equal(calls, 2);
  assert.equal(listed.length, LIST_PAGE_SIZE * 2);
});

test('a server that ignores page stops at the cap', { timeout: 2000 }, async () => {
  let calls = 0;
  const apiGet = async () => {
    calls += 1;
    return { items: rows(LIST_PAGE_SIZE) };
  };

  const listed = await listAllPages(apiGet)('/working-day-profiles');

  assert.equal(calls, LIST_PAGE_CAP);
  assert.equal(listed.length, LIST_PAGE_CAP * LIST_PAGE_SIZE);
});

test('a route without a query string gets the page on its own', async () => {
  const calls = [];
  const apiGet = async (route) => {
    calls.push(route);
    return [];
  };

  const listed = await listAllPages(apiGet)('/working-day-profiles');

  assert.deepEqual(listed, []);
  assert.deepEqual(calls, ['/working-day-profiles?limit=200&page=1']);
});
