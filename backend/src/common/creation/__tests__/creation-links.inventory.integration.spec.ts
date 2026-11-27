// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import dataSource from '../../../data-source';
import { recordHistoryEntry } from '../../../audit/record-history.inventory';
import { CREATION_CANCEL_LINKS } from '../creation-links';

// The children that stop "Cancel" of a record being created (`creation-links.ts`), against the
// database:
// - every declared child references its record ON DELETE CASCADE through its column, and its
//   author column exists;
// - every document relation table (`document_*`) that a record with a history references in
//   cascade is declared: a document linked by anyone leaves no row of the record's history.

type Cascade = { child: string; parent: string; column: string };

async function cascades(): Promise<Cascade[]> {
  return dataSource.query(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent, a.attname AS column
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confdeltype = 'c' AND array_length(c.conkey, 1) = 1`,
  );
}

async function main() {
  await dataSource.initialize();
  try {
    const all = await cascades();
    for (const [table, links] of Object.entries(CREATION_CANCEL_LINKS)) {
      assert.ok(recordHistoryEntry(table), `${table} is a record of the history inventory`);
      for (const link of links) {
        assert.ok(
          all.some((row) => row.child === link.table && row.parent === table && row.column === link.column),
          `${link.table}.${link.column} references ${table} ON DELETE CASCADE`,
        );
        if (link.author) {
          const [found] = await dataSource.query(
            `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
            [link.table, link.author],
          );
          assert.ok(found, `${link.table}.${link.author} exists`);
        }
      }
    }
    const documentLinks = all.filter((row) => row.child.startsWith('document_') && row.parent !== 'documents' && recordHistoryEntry(row.parent));
    assert.ok(documentLinks.length >= 9, 'the document relation tables are found');
    for (const row of documentLinks) {
      assert.ok(
        (CREATION_CANCEL_LINKS[row.parent] ?? []).some((link) => link.table === row.child && link.column === row.column && link.managedDocuments),
        `${row.child} (a document linked to ${row.parent}) is declared in CREATION_CANCEL_LINKS`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
  console.log('creation-links.inventory.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
