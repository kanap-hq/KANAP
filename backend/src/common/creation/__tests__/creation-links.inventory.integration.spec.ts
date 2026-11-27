// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import dataSource from '../../../data-source';
import { recordHistoryChildKind, recordHistoryEntry, type RecordHistoryRecord } from '../../../audit/record-history.inventory';
import { backendPath } from '../../__tests__/backend-root';
import { CREATION_CANCEL_LINKS, type CreationLink } from '../creation-links';
import { CREATION_CANCEL_KEPT } from '../creation-links.inventory';

// Every cascade child of a record that has a "Cancel" of its creation is in one of four cases
// (`creation-links.inventory.ts`): declared in `CREATION_CANCEL_LINKS` (it stops Cancel), read by
// the family's history, refused by its delete, or kept with its reason. The families are found in
// the source (the creation routes and `assertCreatorAloneSinceCreation` name their table); the
// children in the database: the tables that reference the record ON DELETE CASCADE, and those that
// reference such a child, under every child neither declared nor refused by the delete. A new
// table nobody classified, a declaration or an entry that matches nothing, fails here.

type Cascade = { child: string; parent: string; column: string };

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'migrations') sourceFiles(path, out);
    } else if (name.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** The record tables whose creation can be cancelled, as their routes name them. */
function creationFamilies(): string[] {
  const families = new Set<string>();
  const pattern = /\b(?:cancelCreation|readCreationChanges|assertCreatorAloneSinceCreation)\([^;]*?'([a-z_]+)'/gs;
  for (const file of sourceFiles(backendPath('src'))) {
    if (file.includes(`${join('common', 'creation')}`)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) families.add(match[1]);
  }
  return [...families].filter((table) => recordHistoryEntry(table)).sort();
}

/** One row per cascade foreign key, with its column other than `tenant_id`. */
async function cascades(): Promise<Cascade[]> {
  return dataSource.query(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
            (SELECT a.attname FROM unnest(c.conkey) k(n) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n
              WHERE a.attname <> 'tenant_id' LIMIT 1) AS column
       FROM pg_constraint c
      WHERE c.contype = 'f' AND c.confdeltype = 'c' AND c.conrelid <> c.confrelid`,
  );
}

function readByHistory(entry: RecordHistoryRecord, table: string): boolean {
  return !!(recordHistoryChildKind(entry, table) || (entry as any).childReads?.[table] || (entry.auditLabels as readonly string[]).includes(table));
}

async function main() {
  await dataSource.initialize();
  try {
    const all = await cascades();
    const families = creationFamilies();
    assert.ok(families.length >= 20, `the creation families are found in the source (${families.join(', ')})`);
    for (const family of Object.keys(CREATION_CANCEL_LINKS)) assert.ok(families.includes(family), `${family} has a Cancel of its creation`);
    for (const family of Object.keys(CREATION_CANCEL_KEPT)) assert.ok(families.includes(family), `${family} has a Cancel of its creation`);

    const used = new Set<string>();
    const unclassified: string[] = [];
    for (const family of families) {
      const entry = recordHistoryEntry(family)!;
      const links = CREATION_CANCEL_LINKS[family] ?? [];
      const kept = CREATION_CANCEL_KEPT[family] ?? {};
      const declared = (match: (link: CreationLink) => boolean) => {
        const found = links.find(match);
        if (found) used.add(`${family}:${found.table}:${found.column}`);
        return !!found;
      };
      const keptReason = (key: string) => {
        if (!(key in kept)) return null;
        used.add(`${family}:${key}`);
        return kept[key];
      };
      for (const first of all.filter((row) => row.parent === family)) {
        if (declared((link) => !link.through && link.table === first.child && link.column === first.column)) continue;
        const reason = keptReason(first.child);
        const read = readByHistory(entry, first.child);
        if (!reason && !read) unclassified.push(`${family}: ${first.child}.${first.column}`);
        if (reason?.startsWith('the delete refuses')) continue;
        // The tables that reference this child of the record.
        for (const second of all.filter((row) => row.parent === first.child && row.child !== family)) {
          if (declared((link) => link.through?.table === first.child && link.table === second.child && link.column === second.column)) continue;
          if (keptReason(`${first.child}>${second.child}`) || readByHistory(entry, second.child)) continue;
          unclassified.push(`${family}: ${first.child} > ${second.child}.${second.column}`);
        }
      }
      for (const link of links) {
        assert.ok(used.has(`${family}:${link.table}:${link.column}`), `${family}: the declaration ${link.table}.${link.column} matches a cascade foreign key`);
      }
      for (const key of Object.keys(kept)) assert.ok(used.has(`${family}:${key}`), `${family}: the kept entry ${key} matches a cascade foreign key`);
      for (const link of links.filter((row) => row.author)) {
        const [found] = await dataSource.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
          [link.table, link.author],
        );
        assert.ok(found, `${link.table}.${link.author} exists`);
      }
    }
    assert.deepEqual(unclassified, [], 'every cascade child of a record being created is declared, read by its history, or kept with its reason');
  } finally {
    await dataSource.destroy();
  }
  console.log('creation-links.inventory.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
