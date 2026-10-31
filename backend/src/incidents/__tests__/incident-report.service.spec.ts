import * as assert from 'node:assert/strict';
import {
  buildMarkdown,
  escapeMd,
  isSystemTemplateOnlyReview,
  formatDateTime,
  IncidentReportService,
  labelsFor,
  normalizeReportLang,
  normalizeReportTimeZone,
  reportHeading,
  reportPdfFilename,
  type IncidentReportRecord,
} from '../services/incident-report.service';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const REVIEW_DOC_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

/** The five system H2 headings of the §3.2 template, verbatim. */
const SYSTEM_TEMPLATE = [
  '## Detailed description',
  '',
  '## Impact',
  '',
  '## Root cause',
  '',
  '## Corrective actions',
  '',
  '## Lessons learned',
  '',
].join('\n');

function fixture(overrides: Partial<IncidentReportRecord> = {}): IncidentReportRecord {
  return {
    incident: {
      id: UUID,
      item_number: 12,
      title: 'Mail outage | #1 *urgent*',
      category: 'infrastructure',
      severity: 'major',
      status: 'resolved',
      detected_at: '2026-03-10T08:00:00.000Z',
      started_at: '2026-03-10T07:30:00.000Z',
      resolved_at: '2026-03-10T11:00:00.000Z',
      closed_at: null,
      reporter_name: 'Thomas Berger',
      owner_name: 'Thomas Berger',
      source_ref: 'GLPI-4821',
      description: 'Mail stopped for the Lyon office.',
      personal_data_affected: true,
      authority_notification_required: false,
      authority_notified_at: null,
      notified_parties: 'Security team',
      created_at: '2026-03-10T08:05:00.000Z',
      updated_at: '2026-03-10T11:00:00.000Z',
    },
    categoryLabel: 'Infrastructure',
    review: {
      document_id: REVIEW_DOC_ID,
      item_number: 44,
      content_markdown: '## Impact\n\n**Lyon** offline.\n\n![shot](https://cdn.example/a.png)',
    },
    entries: [
      {
        kind: 'system',
        content: 'Incident logged',
        changed_fields: null,
        occurred_at: '2026-03-10T08:05:00.000Z',
        created_at: '2026-03-10T08:05:00.000Z',
        author_name: null,
      },
      {
        kind: 'note',
        content: 'Failover | #step *done*',
        changed_fields: null,
        occurred_at: '2026-03-10T09:00:00.000Z',
        created_at: '2026-03-10T09:10:00.000Z',
        author_name: 'Thomas Berger',
      },
      {
        kind: 'status_change',
        content: null,
        changed_fields: { status: { from: 'in_progress', to: 'resolved' } },
        occurred_at: '2026-03-10T11:00:00.000Z',
        created_at: '2026-03-10T11:00:00.000Z',
        author_name: 'Thomas Berger',
      },
    ],
    assets: [],
    applications: [],
    technologies: [],
    tasks: [{
      item_number: 28,
      title: 'Restore mail flow',
      status: 'open',
      assignee_name: 'Ada Martin',
      due_date: '2026-03-20',
    }],
    documents: { access: 'granted', items: [] },
    attachments: [
      { original_filename: 'screenshot | #1.png', size: 2048, uploaded_at: '2026-03-10T09:15:00.000Z' },
    ],
    ...overrides,
  };
}

function headingIndex(markdown: string, heading: string): number {
  const index = markdown.indexOf(`## ${heading}`);
  assert.ok(index >= 0, `missing heading: ${heading}`);
  return index;
}

function testNormalizeLang() {
  assert.equal(normalizeReportLang('fr'), 'fr');
  assert.equal(normalizeReportLang('DE'), 'de');
  assert.equal(normalizeReportLang('es'), 'es');
  assert.equal(normalizeReportLang(undefined), 'en');
  assert.equal(normalizeReportLang('pt'), 'en');
  assert.equal(normalizeReportLang(''), 'en');
}

function testFilenameAndHeaderRef() {
  assert.equal(reportPdfFilename(12), 'INC-12-incident-report.pdf');
  assert.equal(reportHeading(12, 'Mail outage | #1 *urgent*'), 'INC-12 · Mail outage | #1 *urgent*');
  assert.equal(reportHeading(12, ''), 'INC-12');
  const markdown = buildMarkdown(fixture(), 'en', labelsFor('en'));
  assert.equal(markdown.includes('# INC-12'), false);
  assert.match(markdown, /^- \*\*Severity:\*\*/);
  assert.doesNotMatch(markdown, new RegExp(UUID));
  assert.equal(markdown.includes(UUID), false);
}

function testSectionOrder() {
  const labels = labelsFor('en');
  const markdown = buildMarkdown(fixture(), 'en', labels);
  const positions = [
    markdown.indexOf('**Severity:**'),
    headingIndex(markdown, labels.properties),
    headingIndex(markdown, labels.description),
    // The review document sits between the short description and the journal.
    headingIndex(markdown, 'Impact'),
    headingIndex(markdown, labels.journal),
    headingIndex(markdown, labels.linkedObjects),
    headingIndex(markdown, labels.compliance),
    headingIndex(markdown, labels.attachments),
    markdown.indexOf('Generated on '),
  ];
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `section ${i} is out of order`);
  }
}

function testJournalChronologicalAndChangeRendering() {
  const markdown = buildMarkdown(fixture(), 'en', labelsFor('en'));
  const first = markdown.indexOf('Incident logged');
  const second = markdown.indexOf('Failover');
  const third = markdown.indexOf('Status: In progress → Resolved');
  assert.ok(first >= 0 && second > first && third > second, 'journal is not chronological');
  assert.match(markdown, /Status: In progress → Resolved/);
  assert.match(markdown, /\| System \|/);
}

function testEmptySectionsOmitted() {
  const labels = labelsFor('en');
  const markdown = buildMarkdown(fixture(), 'en', labels);
  assert.equal(markdown.includes(`### ${labels.assets}`), false);
  assert.equal(markdown.includes(`### ${labels.applications}`), false);
  assert.equal(markdown.includes(`### ${labels.technologies}`), false);
  assert.equal(markdown.includes(`### ${labels.documents}`), false);
  assert.ok(markdown.includes(`### ${labels.tasks}`));
  assert.ok(markdown.includes('T-28 · Restore mail flow · Open'));

  const empty = buildMarkdown(
    fixture({
      incident: {
        ...fixture().incident,
        description: '   ',
        personal_data_affected: false,
        authority_notification_required: false,
        notified_parties: null,
      },
      review: { document_id: REVIEW_DOC_ID, item_number: 44, content_markdown: '   \n\n  ' },
      tasks: [],
      attachments: [],
      entries: [],
    }),
    'en',
    labels,
  );
  assert.equal(empty.includes(`## ${labels.description}`), false);
  assert.equal(empty.includes('## Impact'), false, 'a blank review body is omitted');
  assert.equal(empty.includes(`## ${labels.journal}`), false);
  assert.equal(empty.includes(`## ${labels.linkedObjects}`), false);
  assert.equal(empty.includes(`## ${labels.compliance}`), false);
  assert.equal(empty.includes(`## ${labels.attachments}`), false);
}

function testLinkedTechnologiesAndTaskFollowUp() {
  const labels = labelsFor('en');
  const markdown = buildMarkdown(fixture({
    assets: [{ reference: 'AST-1', name: 'Alpha srv' }],
    applications: [{ reference: 'APP-1', name: 'Alpha app' }],
    technologies: [{ reference: 'TEC-7', name: 'PostgreSQL' }],
    tasks: [{
      item_number: 28,
      title: 'Restore mail flow',
      status: 'open',
      assignee_name: 'Ada Martin',
      due_date: '2026-03-20',
    }],
  }), 'en', labels);

  // The three linked sections keep the Relations tab's order: assets, applications, technologies.
  const assets = markdown.indexOf(`### ${labels.assets}`);
  const applications = markdown.indexOf(`### ${labels.applications}`);
  const technologies = markdown.indexOf(`### ${labels.technologies}`);
  const tasks = markdown.indexOf(`### ${labels.tasks}`);
  assert.ok(assets >= 0 && applications > assets && technologies > applications && tasks > technologies);
  assert.ok(markdown.includes('TEC-7 · PostgreSQL'));
  assert.ok(markdown.includes('T-28 · Restore mail flow · Open · Assignee: Ada Martin · Due 20 Mar 2026'));

  // A task without an assignee or a due date keeps its former line.
  const bare = buildMarkdown(fixture({
    tasks: [{ item_number: 29, title: 'Archive logs', status: 'done' }],
  }), 'en', labels);
  assert.ok(bare.includes('T-29 · Archive logs · Done'));
  assert.equal(bare.includes('Assignee:'), false);
  assert.equal(bare.includes('Due:'), false);

  // No linked technology, or none the caller may read (null): the subsection is absent.
  const none = buildMarkdown(fixture({ technologies: null }), 'en', labels);
  assert.equal(none.includes(`### ${labels.technologies}`), false);
}

/** The labels table of the PDF carries the new subsection in the four report languages. */
function testTechnologyAndTaskLabelsInFourLanguages() {
  const expected: Record<string, { technologies: string; assignee: string; due: string }> = {
    en: { technologies: 'Technologies', assignee: 'Assignee', due: 'Due' },
    fr: { technologies: 'Technologies', assignee: 'Assigné à', due: 'Échéance' },
    de: { technologies: 'Technologien', assignee: 'Zugewiesen an', due: 'Fällig am' },
    es: { technologies: 'Tecnologías', assignee: 'Asignada a', due: 'Vence el' },
  };
  for (const [lang, labels] of Object.entries(expected)) {
    const markdown = buildMarkdown(fixture({
      technologies: [{ reference: 'TEC-7', name: 'PostgreSQL' }],
    }), lang as any, labelsFor(lang as any));
    assert.ok(markdown.includes(`### ${labels.technologies}`), `${lang}: technology heading`);
    assert.ok(markdown.includes('TEC-7 · PostgreSQL'), `${lang}: technology line`);
    assert.ok(markdown.includes(`${labels.assignee}: Ada Martin`), `${lang}: assignee label`);
    assert.ok(markdown.includes(`${labels.due} `), `${lang}: due label`);
  }
}

/**
 * Date columns fit a numeric day and, on the next line, the time with its zone.
 * The content column stays wider than the two date columns together.
 */
function testJournalDatesFitAndContentStaysWidest() {
  const markdown = buildMarkdown(fixture(), 'en', labelsFor('en'), 'Europe/Paris');
  const journalAt = markdown.indexOf('## Journal');
  const journal = markdown.slice(journalAt);
  assert.ok(journal.includes('<!-- kanap:table-widths=12,12,5,5,26 -->'), 'the exporter carries the widths past Pandoc');
  const separator = journal.split('\n').find((line) => /^\| -+ \|/.test(line));
  assert.ok(separator, 'journal separator row');
  const widths = separator!.split('|').slice(1, -1).map((cell) => cell.trim().length);
  assert.equal(widths.length, 5);
  assert.ok(widths[4] > widths[0] + widths[1], `content column ${widths[4]} against the dates ${widths[0]}+${widths[1]}`);

  // 10 Mar 2026 08:05 UTC is 09:05 in Paris. The day and the clock are two lines, not a long month name.
  const nextHeading = journal.indexOf('\n## ', 3);
  const table = nextHeading >= 0 ? journal.slice(0, nextHeading) : journal;
  assert.match(table, /10\/03\/2026<br>09:05/);
  assert.equal(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(table), false);
  const properties = markdown.slice(0, journalAt);
  assert.match(properties, /Mar/);
  assert.equal(properties.includes('<br>'), false);

  for (const lang of ['fr', 'de', 'es'] as const) {
    const labels = labelsFor(lang);
    const local = buildMarkdown(fixture(), lang, labels, 'Europe/Paris');
    const at = local.indexOf(`## ${labels.journal}`);
    const section = local.slice(at);
    const end = section.indexOf('\n## ', 3);
    const rows = end >= 0 ? section.slice(0, end) : section;
    assert.match(rows, /10[./]03[./]2026<br>09:05/, `${lang}: numeric day, then the time`);
    assert.equal(local.slice(0, at).includes('<br>'), false, `${lang}: properties keep the long date`);
  }
}

function testMarkdownEscaping() {
  const markdown = buildMarkdown(fixture(), 'en', labelsFor('en'));
  assert.ok(markdown.includes('Failover \\| \\#step \\*done\\*'));
  assert.ok(markdown.includes('screenshot \\| \\#1.png'));
  assert.equal(markdown.includes('\n#1'), false);
  assert.equal(markdown.includes('| Mail outage |'), false);
}

function testMarkdownLinkAndFenceEscaping() {
  assert.equal(escapeMd('![x](http://evil.example/a.png)').includes('!['), false);
  assert.match(escapeMd('![x](http://evil.example/a.png)'), /!\\\[x\\\]/);
  assert.equal(escapeMd('[texte](https://example.com)').includes('[texte]'), false);
  assert.match(escapeMd('[texte](https://example.com)'), /\\\[texte\\\]/);
  assert.match(escapeMd('A & B'), /A &amp; B/);

  const fences = escapeMd('para\n===\n---\n~~~\n- item\n1. numbered\n2) also\n    indented');
  assert.match(fences, /^\\===/m);
  assert.match(fences, /^\\---/m);
  assert.match(fences, /^\\~~~/m);
  assert.match(fences, /^\\- item/m);
  // The delimiter is escaped, not the digit: "\1." would print literally.
  assert.match(fences, /^1\\\. numbered/m);
  assert.match(fences, /^2\\\) also/m);
  assert.equal(fences.includes('\\1.'), false);
  // Leading indentation is dropped so a line cannot open an indented code block.
  assert.match(fences, /^indented/m);

  // Single newlines become hard breaks (two trailing spaces) so the author's
  // line structure survives GFM's soft-break joining; blank lines stay blank.
  const breaks = escapeMd('line one\nline two\n\npara two');
  assert.equal(breaks, 'line one  \nline two  \n  \npara two');

  const table = escapeMd('![x](http://evil.example/a.png)', true);
  assert.equal(table.includes('\n'), false);
  assert.match(table, /!\\\[x\\\]/);
}

function testReportTimestampsUseTimezone() {
  assert.equal(normalizeReportTimeZone(undefined), 'UTC');
  assert.equal(normalizeReportTimeZone('Not/AZone'), 'UTC');
  assert.equal(normalizeReportTimeZone('Europe/Paris'), 'Europe/Paris');

  const utc = formatDateTime('2026-03-10T08:00:00.000Z', 'en', 'UTC') || '';
  assert.match(utc, /GMT|UTC/);
  const paris = formatDateTime('2026-03-10T08:00:00.000Z', 'en', 'Europe/Paris') || '';
  assert.match(paris, /09:00/);
  assert.notEqual(utc, paris);

  const markdown = buildMarkdown(fixture(), 'en', labelsFor('en'), 'UTC');
  assert.match(markdown, /Generated on .*(GMT|UTC)/);
}

function testRestrictedDocumentsOmitted() {
  const labels = labelsFor('en');
  const markdown = buildMarkdown(
    fixture({
      documents: { access: 'restricted', items: [{ item_number: 9, title: 'Secret post-mortem' }] },
    }),
    'en',
    labels,
  );
  assert.equal(markdown.includes('Secret post-mortem'), false);
  assert.equal(markdown.includes('DOC-9'), false);
}

/** Spanish and German reports use the same reporter and journal words as the workspace. */
function testReporterAndJournalWords() {
  const es = labelsFor('es');
  assert.equal(es.reporter, 'Notificante');
  assert.equal(es.journal, 'Diario');
  const esMarkdown = buildMarkdown(fixture(), 'es', es);
  assert.ok(esMarkdown.includes('- **Notificante:** Thomas Berger'));
  assert.ok(esMarkdown.includes('## Diario'));
  assert.equal(esMarkdown.includes('Declarante'), false);
  assert.equal(esMarkdown.includes('## Registro'), false);

  const de = labelsFor('de');
  assert.equal(de.reporter, 'Melder');
  assert.equal(de.journal, 'Verlauf');
  const deMarkdown = buildMarkdown(fixture(), 'de', de);
  assert.ok(deMarkdown.includes('- **Melder:** Thomas Berger'));
  assert.ok(deMarkdown.includes('## Verlauf'));
  assert.equal(deMarkdown.includes('Meldende'), false);
}

function testFrenchChangeLabels() {
  const markdown = buildMarkdown(fixture(), 'fr', labelsFor('fr'));
  assert.match(markdown, /Statut: En cours → Résolu/);
  assert.ok(markdown.includes('Généré le '));
  assert.ok(markdown.includes(' par KANAP'));
  assert.ok(markdown.includes('T-28 · Restore mail flow · Ouvert'));
}

// QA lot 14: the creation entry is stored as "Incident logged"; a report in another language shows
// it in that language. A note with the same words is someone's text and stays as written.
function testSystemEntriesInReportLanguage() {
  const markdown = buildMarkdown(fixture(), 'fr', labelsFor('fr'));
  assert.ok(markdown.includes('Incident enregistré'));
  assert.ok(!markdown.includes('Incident logged'));
  assert.ok(buildMarkdown(fixture(), 'de', labelsFor('de')).includes('Vorfall erfasst'));
  assert.ok(buildMarkdown(fixture(), 'es', labelsFor('es')).includes('Incidente registrado'));
  assert.ok(buildMarkdown(fixture(), 'en', labelsFor('en')).includes('Incident logged'));
  const withNote = fixture();
  withNote.entries = [{ ...fixture().entries![0], kind: 'note' }];
  assert.ok(buildMarkdown(withNote, 'fr', labelsFor('fr')).includes('Incident logged'));
}

function testLinkChangeUsesContentOnly() {
  const markdown = buildMarkdown(
    fixture({
      entries: [
        {
          kind: 'link_change',
          content: 'Assets linked: PAR-ESX-01',
          changed_fields: { assets: { from: [], to: [UUID] } },
          occurred_at: '2026-03-10T10:00:00.000Z',
          created_at: '2026-03-10T10:00:00.000Z',
          author_name: 'Thomas Berger',
        },
      ],
    }),
    'en',
    labelsFor('en'),
  );
  assert.ok(markdown.includes('Assets linked: PAR-ESX-01'));
  assert.equal(markdown.includes(UUID), false);
}

/**
 * §3.5: the review is inserted as Markdown, never escaped — bold, headings and
 * images must survive intact — while the short description stays escaped.
 */
function testReviewMarkdownIsNotEscaped() {
  const markdown = buildMarkdown(fixture(), 'en', labelsFor('en'));
  assert.ok(markdown.includes('**Lyon** offline.'), 'bold must survive');
  assert.ok(markdown.includes('![shot](https://cdn.example/a.png)'), 'the image must survive');
  assert.equal(markdown.includes('\\*\\*Lyon\\*\\*'), false);
  assert.equal(markdown.includes('!\\[shot\\]'), false);
  // No wrapping heading is added and the author's headings keep their level.
  assert.match(markdown, /^## Impact$/m);
}

/** Only a blank body or exactly the five system headings are omitted. */
function testReviewOmissionIsConservative() {
  const labels = labelsFor('en');
  const only = (content: string) =>
    buildMarkdown(fixture({ review: { document_id: REVIEW_DOC_ID, item_number: 44, content_markdown: content } }), 'en', labels);

  assert.equal(isSystemTemplateOnlyReview(SYSTEM_TEMPLATE), true);
  assert.equal(isSystemTemplateOnlyReview(SYSTEM_TEMPLATE.replace(/\n/g, '\r\n')), true);
  assert.equal(isSystemTemplateOnlyReview('\n\n' + SYSTEM_TEMPLATE + '\n\n\n'), true);
  assert.equal(isSystemTemplateOnlyReview(''), true);
  assert.equal(isSystemTemplateOnlyReview('   \n  '), true);
  assert.equal(only(SYSTEM_TEMPLATE).includes('## Root cause'), false, 'the untouched template is omitted');

  // A free heading is real content: never stripped to decide emptiness.
  const freeHeading = only('## Main router outage');
  assert.ok(freeHeading.includes('## Main router outage'));
  assert.equal(isSystemTemplateOnlyReview('## Main router outage'), false);

  // One of the five sections filled in: kept.
  const filled = SYSTEM_TEMPLATE.replace('## Impact\n', '## Impact\n\nMail down for 2 h\n');
  assert.equal(isSystemTemplateOnlyReview(filled), false);
  assert.ok(only(filled).includes('Mail down for 2 h'));

  // A customised template (extra prose or extra headings) is kept as it is,
  // even untouched by the author.
  const custom = `${SYSTEM_TEMPLATE}\n## Timeline\n`;
  assert.equal(isSystemTemplateOnlyReview(custom), false);
  assert.ok(only(custom).includes('## Timeline'));

  // Reordering or dropping a heading is content too.
  assert.equal(isSystemTemplateOnlyReview('## Impact\n\n## Detailed description'), false);
  assert.equal(isSystemTemplateOnlyReview('## Detailed description\n\n## Impact'), false);
}

/**
 * The omission never consults the current library template: changing it later
 * cannot make an already stored body disappear from an older report.
 */
function testTemplateChangeDoesNotAffectOmission() {
  const labels = labelsFor('en');
  const changedTemplate = '## Summary\n\n## What happened\n';
  const markdown = buildMarkdown(
    fixture({ review: { document_id: REVIEW_DOC_ID, item_number: 44, content_markdown: changedTemplate } }),
    'en',
    labels,
  );
  assert.ok(markdown.includes('## What happened'), 'a body matching a NEW template is still rendered');
  assert.equal(isSystemTemplateOnlyReview(changedTemplate), false);
}

/** The closure entry shows the version and the DOC-N reference, in each language. */
function testClosureVersionReferenceInJournal() {
  const record = fixture({
    entries: [
      {
        kind: 'status_change',
        content: null,
        changed_fields: {
          status: { from: 'in_progress', to: 'closed' },
          review_version: { from: null, to: { document_id: REVIEW_DOC_ID, version_number: 3, revision: 5 } },
        },
        occurred_at: '2026-03-11T11:00:00.000Z',
        created_at: '2026-03-11T11:00:00.000Z',
        author_name: 'Thomas Berger',
      },
    ],
  });

  const expected: Record<string, string> = {
    en: 'Incident review version 3 (DOC-44)',
    fr: "Revue d'incident version 3 (DOC-44)",
    de: 'Vorfallanalyse Version 3 (DOC-44)',
    es: 'Revisión del incidente versión 3 (DOC-44)',
  };
  for (const [lang, text] of Object.entries(expected)) {
    const markdown = buildMarkdown(record, lang as any, labelsFor(lang as any));
    assert.ok(markdown.includes(text), `${lang}: missing "${text}"`);
    assert.equal(markdown.includes(REVIEW_DOC_ID), false, `${lang}: the document UUID must never be printed`);
    assert.equal(markdown.includes('[object Object]'), false, `${lang}: raw object rendering`);
  }

  // No review loaded (or another document): the version alone, still no UUID.
  const orphan = buildMarkdown({ ...record, review: null }, 'en', labelsFor('en'));
  assert.ok(orphan.includes('Incident review version 3'));
  assert.equal(orphan.includes('DOC-44'), false);
  assert.equal(orphan.includes(REVIEW_DOC_ID), false);
}

/** Shipped categories follow the report language. A name the tenant typed, or an unknown code, stays. */
async function testPdfCategoryFollowsTheReportLanguage() {
  const exportCalls: any[][] = [];
  let category = 'data';
  const records = {
    load: async () => {
      const record = fixture();
      record.incident.category = category;
      return record;
    },
  };
  const documentExport = {
    exportMarkdown: async (...args: any[]) => {
      exportCalls.push(args);
      return { buffer: Buffer.from('pdf'), contentType: 'application/pdf' };
    },
  };
  const itOps = {
    getSettings: async () => ({
      incidentCategories: [
        { code: 'data', label: 'Data' },
        { code: 'plant_stop', label: 'Arrêt usine' },
        { code: 'security', label: 'Security renamed' },
      ],
    }),
  };
  const service = new IncidentReportService(records as any, documentExport as any, itOps as any);
  const opts = { manager: {} as any, tenantId: 'tenant-1', userId: 'u1' };

  const expectCategory = async (lang: string, code: string, line: string) => {
    category = code;
    await service.exportPdf(UUID, lang, opts);
    const markdown = String(exportCalls.at(-1)?.[0] ?? '');
    assert.ok(markdown.includes(line), `${lang} ${code}: missing "${line}"`);
  };

  await expectCategory('fr', 'data', '**Catégorie:** Données');
  await expectCategory('de', 'data', '**Kategorie:** Daten');
  await expectCategory('es', 'data', '**Categoría:** Datos');
  await expectCategory('en', 'data', '**Category:** Data');
  await expectCategory('fr', 'plant_stop', '**Catégorie:** Arrêt usine');
  await expectCategory('fr', 'security', '**Catégorie:** Security renamed');
  await expectCategory('fr', 'legacy-free-text', '**Catégorie:** legacy-free-text');
  assert.equal(String(exportCalls[0][0]).includes('**Catégorie:** Data'), false);
}

async function testExportPdfForwardsViewerAndCookie() {
  const captured: Array<{ viewer?: unknown }> = [];
  const exportCalls: any[][] = [];
  const records = {
    load: async (_id: string, opts: { viewer?: unknown }) => {
      captured.push(opts);
      return fixture();
    },
  };
  const documentExport = {
    exportMarkdown: async (...args: any[]) => {
      exportCalls.push(args);
      return { buffer: Buffer.from('pdf'), contentType: 'application/pdf' };
    },
  };
  const itOps = {
    getSettings: async () => ({ incidentCategories: [] }),
  };
  const service = new IncidentReportService(records as any, documentExport as any, itOps as any);
  const viewer = { userId: 'u1', isAdmin: false };
  await service.exportPdf(UUID, 'en', {
    manager: {} as any,
    tenantId: 'tenant-1',
    userId: 'u1',
    viewer,
    imageFetchCookie: 'refresh_token=abc',
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].viewer, viewer);
  // Inline images of the review are behind an authenticated route.
  assert.deepEqual(exportCalls[0][3], { imageFetchHeaders: { Cookie: 'refresh_token=abc' } });

  // No cookie on the request: no forged header.
  await service.exportPdf(UUID, 'en', { manager: {} as any, tenantId: 'tenant-1', userId: 'u1', viewer });
  assert.equal(exportCalls[1][3], undefined);

  // The reader's module rights and application scope reach the record loader.
  await service.exportPdf(UUID, 'en', {
    manager: {} as any,
    tenantId: 'tenant-1',
    userId: 'u1',
    viewer,
    technologies: true,
    applications: false,
    tasks: true,
    applicationScope: { userId: 'u1' },
  });
  assert.deepEqual(captured[2], {
    manager: {},
    tenantId: 'tenant-1',
    userId: 'u1',
    viewer,
    technologies: true,
    applications: false,
    applicationScope: { userId: 'u1' },
    tasks: true,
  });
}

async function run() {
  testNormalizeLang();
  testFilenameAndHeaderRef();
  testSectionOrder();
  testJournalChronologicalAndChangeRendering();
  testEmptySectionsOmitted();
  testLinkedTechnologiesAndTaskFollowUp();
  testTechnologyAndTaskLabelsInFourLanguages();
  testJournalDatesFitAndContentStaysWidest();
  testMarkdownEscaping();
  testMarkdownLinkAndFenceEscaping();
  testReportTimestampsUseTimezone();
  testRestrictedDocumentsOmitted();
  testReporterAndJournalWords();
  testFrenchChangeLabels();
  testSystemEntriesInReportLanguage();
  testLinkChangeUsesContentOnly();
  testReviewMarkdownIsNotEscaped();
  testReviewOmissionIsConservative();
  testTemplateChangeDoesNotAffectOmission();
  testClosureVersionReferenceInJournal();
  await testPdfCategoryFollowsTheReportLanguage();
  await testExportPdfForwardsViewerAndCookie();
  console.log('incident-report.service.spec.ts: ok');
}

void run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
