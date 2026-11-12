// Prepares a bench tenant: the "R2 banc" library and its articles, the GLPI connection to the
// bench's fake GLPI, and the bench agent. Idempotent: a second run changes only what drifted.
import { tenantTitle } from './dataset.mjs';

export const BENCH_LIBRARY_NAME = 'R2 banc';
export const BENCH_AGENT_NAME = 'R2 banc agent';
// The library of the sample data that holds the five support articles of the fixture.
export const FIXTURE_LIBRARY_NAME = 'Service Desk Docs';
const BENCH_GLPI_USER_TOKEN = 'r2-bench-fake-glpi';

async function findLibraries(db) {
  return db.query('SELECT id, name FROM document_libraries WHERE tenant_id = $1', [db.tenantId]);
}

async function documentsOfLibrary(db, libraryId) {
  return db.query(
    `SELECT id, item_number, title, summary, status, content_markdown
       FROM documents WHERE tenant_id = $1 AND library_id = $2`,
    [db.tenantId, libraryId],
  );
}

export async function setupTenant({ api, db, dataset, glpiUrl, log = console.log }) {
  // 1. Libraries.
  let libraries = await findLibraries(db);
  const fixtureLibrary = libraries.find((library) => library.name === FIXTURE_LIBRARY_NAME);
  if (!fixtureLibrary) throw new Error(`library "${FIXTURE_LIBRARY_NAME}" of the sample data is missing on this tenant`);
  let benchLibrary = libraries.find((library) => library.name === BENCH_LIBRARY_NAME);
  if (!benchLibrary) {
    await api.post('/knowledge-libraries', { name: BENCH_LIBRARY_NAME });
    libraries = await findLibraries(db);
    benchLibrary = libraries.find((library) => library.name === BENCH_LIBRARY_NAME);
    log(`library "${BENCH_LIBRARY_NAME}" created`);
  }

  // 2. The fixture articles must be there, published, with a search vector.
  const fixtureDocs = await documentsOfLibrary(db, fixtureLibrary.id);
  for (const article of dataset.articles.filter((a) => a.source === 'fixture')) {
    const doc = fixtureDocs.find((d) => d.title === article.title);
    if (!doc) throw new Error(`fixture article "${article.title}" is missing from "${FIXTURE_LIBRARY_NAME}"`);
  }

  // 3. Bench articles: created when absent, replaced when their text or status drifted.
  let benchDocs = await documentsOfLibrary(db, benchLibrary.id);
  let created = 0;
  let replaced = 0;
  for (const article of dataset.articles.filter((a) => a.source === 'bench')) {
    const title = tenantTitle(article);
    const existing = benchDocs.find((d) => d.title === title);
    const same = existing
      && existing.status === article.status
      && (existing.summary ?? null) === (article.summary ?? null)
      && String(existing.content_markdown ?? '').trim() === article.body.trim();
    if (same) continue;
    if (existing) {
      await api.delete(`/knowledge/${existing.id}`);
      replaced++;
    } else {
      created++;
    }
    await api.post('/knowledge', {
      title,
      summary: article.summary,
      content_markdown: article.body,
      library_id: benchLibrary.id,
      status: article.status,
    });
  }
  const wantedTitles = new Set(dataset.articles.filter((a) => a.source === 'bench').map(tenantTitle));
  benchDocs = await documentsOfLibrary(db, benchLibrary.id);
  const strays = benchDocs.filter((d) => !wantedTitles.has(d.title));
  for (const stray of strays) await api.delete(`/knowledge/${stray.id}`);
  log(`bench articles: ${created} created, ${replaced} replaced, ${strays.length} removed`);

  // 4. GLPI connection of the tenant, pointed at the fake GLPI of the bench.
  await api.patch('/ai/settings', { glpi_enabled: true, glpi_url: glpiUrl, glpi_user_token: BENCH_GLPI_USER_TOKEN });
  log(`GLPI connection set to ${glpiUrl}`);

  // 5. The bench agent: helpdesk, GLPI, both libraries, manual runs only.
  const agents = (await api.get('/ai/admin/control-plane/agents'))?.items ?? [];
  let agent = agents.find((a) => a.name === BENCH_AGENT_NAME);
  if (!agent) {
    agent = (await api.post('/ai/admin/control-plane/agents', {
      name: BENCH_AGENT_NAME,
      agent_type: 'helpdesk',
      description: 'Knowledge search bench (R2). Manual runs on the bench tickets only.',
      provider_bindings_json: { ticketing: { provider_kind: 'ticketing', provider_key: 'glpi' } },
    })).agent_definition;
    log(`agent "${BENCH_AGENT_NAME}" created`);
  }
  await api.post(`/ai/admin/control-plane/agents/${agent.id}`, {
    knowledge_sources: {
      knowledge: { enabled: true, all_libraries: false, library_ids: [fixtureLibrary.id, benchLibrary.id] },
      web: { enabled: false },
    },
  });
  if (agent.status !== 'enabled') {
    await api.post(`/ai/admin/control-plane/agents/${agent.id}/status`, { status: 'enabled', watching: false });
  }
  log(`agent "${BENCH_AGENT_NAME}" searches "${FIXTURE_LIBRARY_NAME}" and "${BENCH_LIBRARY_NAME}"`);
  return { agentId: agent.id, libraryIds: { fixture: fixtureLibrary.id, bench: benchLibrary.id } };
}
