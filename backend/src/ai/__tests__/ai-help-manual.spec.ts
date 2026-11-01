import * as assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Features } from '../../config/features';
import {
  AiHelpManualService,
  HELP_SECTION_MAX_CHARS,
  cleanHelpMarkdown,
  findHelpManualRoot,
  helpHeadingSlug,
  parseHelpPage,
} from '../ai-help-manual.service';
import { AiToolRegistry } from '../ai-tool.registry';

// The user manual for Plaid and the MCP server (list_help_topics, read_help_section): read from the
// repository's doc/help/docs here, from /app/help-docs in the API image (backend/Dockerfile).

const manual = new AiHelpManualService();

async function withSingleTenant<T>(singleTenant: boolean, fn: () => T | Promise<T>): Promise<T> {
  const previous = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = singleTenant;
  try {
    return await fn();
  } finally {
    (Features as any).SINGLE_TENANT = previous;
  }
}

function registry(helpManual: AiHelpManualService | undefined) {
  const policy = {
    assertSurfaceAccess: async () => undefined,
    listReadableEntityTypes: async () => [],
    canReadKnowledge: async () => false,
    assertWriteAccess: async () => { throw new Error('no write'); },
  };
  return new AiToolRegistry(
    {} as any, {} as any, policy as any, {} as any, {} as any,
    { find: async () => ({ web_search_enabled: false }) } as any,
    {} as any,
    { hasExecutedUndoablePreviewInConversation: async () => false } as any,
    { listOperations: () => [], getOperationOrNull: () => null } as any,
    undefined,
    undefined,
    helpManual,
  );
}

/** A person who reads nothing and whose interface is in `locale`. */
function context(surface: 'chat' | 'mcp', locale: string | null) {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    isPlatformHost: false,
    surface,
    authMethod: surface === 'mcp' ? 'api_key' as const : 'jwt' as const,
    manager: { query: async (sql: string) => (/SELECT locale FROM users/.test(sql) ? [{ locale }] : []) } as any,
  };
}

function testEveryLanguageIsLoaded() {
  assert.ok(findHelpManualRoot(), 'the manual is found above the backend sources');
  assert.ok(manual.available());
  const english = withSingleTenantSync(true, () => manual.listTopics('en'));
  assert.ok(english.total >= 60, `the English manual has its pages (${english.total})`);
  for (const language of ['fr', 'de', 'es'] as const) {
    const topics = withSingleTenantSync(true, () => manual.listTopics(language));
    assert.equal(topics.language, language, `${language} is served in its own language`);
    assert.equal(topics.total, english.total, `${language} has every page`);
    assert.ok(topics.pages.some((page) => page.page === 'contracts'), `${language} has the contracts page`);
  }
}

function withSingleTenantSync<T>(singleTenant: boolean, fn: () => T): T {
  const previous = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = singleTenant;
  try {
    return fn();
  } finally {
    (Features as any).SINGLE_TENANT = previous;
  }
}

function testKnownSectionsInEnglishAndFrench() {
  const coverage = manual.readSection('en', 'contracts', 'Commitment and coverage');
  assert.equal(coverage.page_title, 'Contracts');
  assert.equal(coverage.section, 'Commitment and coverage');
  assert.equal(coverage.url, 'https://doc.kanap.net/contracts/#commitment-and-coverage');
  assert.match(coverage.text, /^#### Commitment and coverage\n/);
  assert.match(coverage.text, /Committed by the contract/);
  assert.doesNotMatch(coverage.text, /^### Compliance/m, 'the section stops at the next heading of its level or above');
  assert.equal(coverage.truncated, false);

  const french = manual.readSection('fr', 'contracts', 'Engagement et couverture');
  assert.equal(french.language, 'fr');
  assert.equal(french.url, 'https://doc.kanap.net/fr/contracts/#engagement-et-couverture');
  assert.match(french.text, /^#### Engagement et couverture\n/);

  // A section by its anchor, its parent path, or its title in any case; the page by its address.
  assert.equal(manual.readSection('fr', 'contracts', 'conformite').url, 'https://doc.kanap.net/fr/contracts/#conformite');
  assert.equal(manual.readSection('fr', 'contracts', 'La fiche contrat › Relations').url, 'https://doc.kanap.net/fr/contracts/#relations');
  assert.equal(manual.readSection('fr', 'https://doc.kanap.net/fr/contracts/#budget', 'BUDGET').section, 'Budget');

  // The links to other pages are doc.kanap.net addresses in the page's language.
  const relations = manual.readSection('fr', 'contracts', 'Relations');
  assert.match(relations.text, /\]\(https:\/\/doc\.kanap\.net\/fr\/contracts\/#budget\)/);
  assert.doesNotMatch(relations.text, /\]\((?!https?:)[^)]*\.md/, 'no relative .md link is left');

  assert.throws(() => manual.readSection('en', 'contracts', 'No such section'), (error: unknown) =>
    error instanceof NotFoundException && /Its sections: .*Renewal decisions/.test(error.message));
  assert.throws(() => manual.readSection('en', 'no-such-page'), NotFoundException);
}

function testTheCapAndTheSubsections() {
  const page = manual.readSection('en', 'budget-lines');
  assert.equal(page.truncated, true);
  assert.equal(page.complete, false);
  assert.ok(page.text.length <= HELP_SECTION_MAX_CHARS, 'the text is capped');
  assert.ok(page.chars > HELP_SECTION_MAX_CHARS, '`chars` gives the length of the whole page');
  assert.ok(page.subsections.includes('Getting started'), 'a capped page names its sections');
  assert.equal(page.url, 'https://doc.kanap.net/budget-lines/');
  assert.equal(manual.readSection('en', 'index').url, 'https://doc.kanap.net/');
}

function testTheTableOfContents() {
  const full = withSingleTenantSync(false, () => manual.listTopics('en'));
  assert.equal(full.complete, true);
  const contracts = full.pages.find((page) => page.page === 'contracts')!;
  assert.equal(contracts.url, 'https://doc.kanap.net/contracts/');
  assert.ok(contracts.sections.includes('Renewal decisions'));
  assert.ok(!contracts.sections.includes('Decision window'), 'without words, the main sections only');
  assert.ok(JSON.stringify(full).length < 30_000, 'the full table stays compact');

  const found = manual.listTopics('fr', 'Comment rattacher un contrat à une application ?');
  assert.ok(found.pages.length <= 10);
  const page = found.pages.find((entry) => entry.page === 'contracts');
  assert.ok(page, 'the contracts page holds these words');
  assert.ok(page.sections.includes('La fiche contrat › Relations'), 'with the subsection where they appear');
}

async function testOnPremisePagesInTheCloudOnly() {
  await withSingleTenant(false, () => {
    assert.ok(!manual.listTopics('en').pages.some((page) => page.page.startsWith('on-premise/')));
    assert.ok(!manual.listTopics('en', 'installation docker compose').pages.some((page) => page.page.startsWith('on-premise/')));
    assert.throws(() => manual.readSection('en', 'on-premise/installation'), NotFoundException);
  });
  await withSingleTenant(true, () => {
    assert.ok(manual.listTopics('en').pages.some((page) => page.page === 'on-premise/installation'));
    assert.equal(manual.readSection('de', 'on-premise/installation').url, 'https://doc.kanap.net/de/on-premise/installation/');
    assert.equal(manual.readSection('en', 'on-premise/index').url, 'https://doc.kanap.net/on-premise/');
  });
}

function testMkDocsSyntaxIsRemoved() {
  const markdown = [
    '# Sample',
    '',
    '## Décisions de renouvellement { #renewals }',
    '',
    '![Screen](images/screen.png)',
    '',
    '!!! tip "Prefer one page"',
    '    Keep it short.',
    '',
    '    See [Budget](budget-lines.md#import) and [above](#overview).',
    '',
    'After the tip. <div markdown>Wrapped</div>',
    '',
    '```',
    '!!! not an admonition in code',
    '```',
    '',
    '## Overview',
    '',
    '## Overview',
  ].join('\n');
  const page = parseHelpPage('fr', 'fast-track/index', markdown);
  assert.equal(page.title, 'Sample');
  assert.equal(page.url, 'https://doc.kanap.net/fr/fast-track/');
  assert.deepEqual(page.sections.map((section) => section.id), ['renewals', 'overview', 'overview_1']);
  const text = cleanHelpMarkdown('fr', page.path, page.lines);
  assert.doesNotMatch(text, /!\[|png|<div|\{ #/);
  assert.match(text, /\*\*Prefer one page\*\*\nKeep it short\./);
  assert.match(text, /\[Budget\]\(https:\/\/doc\.kanap\.net\/fr\/fast-track\/budget-lines\/#import\)/);
  assert.match(text, /\[above\]\(https:\/\/doc\.kanap\.net\/fr\/fast-track\/#overview\)/);
  assert.match(text, /After the tip\. Wrapped/);
  assert.match(text, /```\n!!! not an admonition in code\n```/);
  assert.equal(helpHeadingSlug('Décisions de renouvellement'), 'decisions-de-renouvellement');
  assert.equal(helpHeadingSlug("L'espace de travail des Actifs"), 'lespace-de-travail-des-actifs');
}

async function testTheToolsForEveryPlaidUser() {
  const tools = registry(manual);
  for (const surface of ['chat', 'mcp'] as const) {
    const names = (await tools.listAvailableTools(context(surface, null) as any)).map((tool) => tool.name);
    assert.deepEqual(names, ['list_help_topics', 'read_help_section'], `${surface}: offered to a person who reads nothing else`);
  }
  const listed = tools.listRegisteredTools().filter((tool) => tool.name === 'list_help_topics' || tool.name === 'read_help_section');
  assert.deepEqual(listed.map((tool) => [tool.name, tool.category, tool.readOnly]), [
    ['list_help_topics', 'discovery', true],
    ['read_help_section', 'inspection', true],
  ]);

  // The person's interface language by default, the one asked for otherwise, English without either.
  const french = await tools.execute(context('chat', 'fr') as any, 'read_help_section', { page: 'contracts', section: 'Relations' }) as any;
  assert.equal(french.language, 'fr');
  assert.equal(french.url, 'https://doc.kanap.net/fr/contracts/#relations');
  const english = await tools.execute(context('chat', 'fr') as any, 'read_help_section', { page: 'contracts', section: 'Relations', language: 'en' }) as any;
  assert.equal(english.url, 'https://doc.kanap.net/contracts/#relations');
  const fallback = await tools.execute(context('mcp', null) as any, 'list_help_topics', { query: 'contract' }) as any;
  assert.equal(fallback.language, 'en');
  assert.ok(fallback.pages.some((page: any) => page.page === 'contracts'));

  await assert.rejects(tools.execute(context('chat', null) as any, 'read_help_section', { page: 'contracts', language: 'it' }), BadRequestException);

  // Without the manual (an image built without it), the tools are not offered.
  const without = registry(undefined);
  assert.deepEqual((await without.listAvailableTools(context('chat', null) as any)).map((tool) => tool.name), []);
  const empty = new AiHelpManualService();
  empty.load(null);
  assert.deepEqual((await registry(empty).listAvailableTools(context('chat', null) as any)).map((tool) => tool.name), []);
}

async function run() {
  testEveryLanguageIsLoaded();
  testKnownSectionsInEnglishAndFrench();
  testTheCapAndTheSubsections();
  testTheTableOfContents();
  await testOnPremisePagesInTheCloudOnly();
  testMkDocsSyntaxIsRemoved();
  await testTheToolsForEveryPlaidUser();
}

void run();
