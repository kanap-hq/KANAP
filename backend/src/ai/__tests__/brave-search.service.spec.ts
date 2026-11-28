import * as assert from 'node:assert/strict';
import { BraveSearchService } from '../web-search/brave-search.service';

const service = new BraveSearchService();

async function testSearchReturnsResults() {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(
      JSON.stringify({
        web: {
          results: [
            { title: 'Result 1', url: 'https://example.com/1', description: 'First result' },
            { title: 'Result 2', url: 'https://example.com/2', description: 'Second result' },
          ],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    const results = await service.search('test query', { count: 2 });

    assert.equal(results.length, 2);
    assert.equal(results[0].title, 'Result 1');
    assert.equal(results[0].url, 'https://example.com/1');
    assert.equal(results[1].description, 'Second result');
  } finally {
    delete process.env.BRAVE_SEARCH_API_KEY;
    globalThis.fetch = originalFetch;
  }
}

async function testSearchThrowsWithoutApiKey() {
  delete process.env.BRAVE_SEARCH_API_KEY;
  await assert.rejects(
    () => service.search('test'),
    (error: Error) => error.message === 'Web search is not available on this installation.',
  );
}

async function testSearchHandlesNon200Response() {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });

    process.env.BRAVE_SEARCH_API_KEY = 'bad-key';
    await assert.rejects(
      () => service.search('test'),
      (error: Error) => error.message.includes('401'),
    );
  } finally {
    delete process.env.BRAVE_SEARCH_API_KEY;
    globalThis.fetch = originalFetch;
  }
}

async function testSearchScrubsInternalIdentifiersBeforeCallingBrave() {
  const originalFetch = globalThis.fetch;
  try {
    let requestedUrl = '';
    globalThis.fetch = async (input: any) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({ web: { results: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    await service.search('PRJ-42 Windows Server 2019 123e4567-e89b-12d3-a456-426614174000', { count: 1 });

    const url = new URL(requestedUrl);
    const publicQuery = url.searchParams.get('q') || '';
    assert.equal(publicQuery, 'Windows Server 2019');
  } finally {
    delete process.env.BRAVE_SEARCH_API_KEY;
    globalThis.fetch = originalFetch;
  }
}

async function testSearchRejectsQueriesThatOnlyContainInternalIdentifiers() {
  process.env.BRAVE_SEARCH_API_KEY = 'test-key';
  try {
    await assert.rejects(
      () => service.search('PRJ-42 123e4567-e89b-12d3-a456-426614174000'),
      (error: Error) => error.message.includes('generic, publicly meaningful terms'),
    );
  } finally {
    delete process.env.BRAVE_SEARCH_API_KEY;
  }
}

async function testTestConnectivityReturnsShape() {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ web: { results: [{ title: 'Test', url: 'https://example.com', description: 'OK' }] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    const result = await service.testConnectivity();

    assert.equal(result.ok, true);
    assert.equal(typeof result.message, 'string');
    assert.equal(typeof result.latency_ms, 'number');
    assert.ok(result.latency_ms! >= 0);
  } finally {
    delete process.env.BRAVE_SEARCH_API_KEY;
    globalThis.fetch = originalFetch;
  }
}

async function testTestConnectivityWithoutApiKey() {
  delete process.env.BRAVE_SEARCH_API_KEY;
  const result = await service.testConnectivity();

  assert.equal(result.ok, false);
  assert.equal(result.message, 'Web search is not available on this installation.');
  assert.equal(result.latency_ms, null);
}

async function run() {
  await testSearchReturnsResults();
  await testSearchThrowsWithoutApiKey();
  await testSearchHandlesNon200Response();
  await testSearchScrubsInternalIdentifiersBeforeCallingBrave();
  await testSearchRejectsQueriesThatOnlyContainInternalIdentifiers();
  await testTestConnectivityReturnsShape();
  await testTestConnectivityWithoutApiKey();
}

void run();
