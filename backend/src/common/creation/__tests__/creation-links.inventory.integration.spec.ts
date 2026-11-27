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

// Every cascade foreign key towards a record that has a "Cancel" of its creation is in one of four
// cases (`creation-links.inventory.ts`), column by column: declared in `CREATION_CANCEL_LINKS` (it
// stops Cancel), read by the family's history (a table with a single column towards the family),
// refused by its delete, or kept with its reason. The families are found in the source (the
// creation routes and `assertCreatorAloneSinceCreation` name their table); the keys in the
// database: those that reference the record ON DELETE CASCADE, and those that reference such a
// child, under every child neither declared nor refused by the delete. A new key nobody classified,
// a declaration or an entry that matches nothing, fails here. A family whose cancel does not take
// the framework's lock declares nothing that needs it.

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

const CALL = /\b(cancelCreation|readCreationChanges|assertCreatorAloneSinceCreation)\(([^;]*?)'([a-z_]+)'([^;]*)/gs;

/** The record tables whose creation can be cancelled, as their routes name them, and those whose cancel takes no lock of the framework. */
function creationFamilies(): { families: string[]; unlocked: string[] } {
  const families = new Set<string>();
  const unlocked = new Set<string>();
  for (const file of sourceFiles(backendPath('src'))) {
    if (file.includes(`${join('common', 'creation')}`)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(CALL)) {
      families.add(match[3]);
      if (match[1] === 'assertCreatorAloneSinceCreation' && !/\block:\s*true\b/.test(match[4])) unlocked.add(match[3]);
    }
  }
  const known = (table: string) => !!recordHistoryEntry(table);
  return { families: [...families].filter(known).sort(), unlocked: [...unlocked].filter(known).sort() };
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
    const { families, unlocked } = creationFamilies();
    assert.ok(families.length >= 20, `the creation families are found in the source (${families.join(', ')})`);
    assert.deepEqual(unlocked, ['contracts', 'spend_items'], 'the families that lock their record themselves');
    for (const family of Object.keys(CREATION_CANCEL_LINKS)) assert.ok(families.includes(family), `${family} has a Cancel of its creation`);
    for (const family of Object.keys(CREATION_CANCEL_KEPT)) assert.ok(families.includes(family), `${family} has a Cancel of its creation`);

    // The `through` rows and the managed documents are locked by the framework's lock only.
    const [{ def }] = await dataSource.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'integrated_document_bindings'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%source_entity_type%'`,
    );
    for (const family of unlocked) {
      for (const link of CREATION_CANCEL_LINKS[family] ?? []) {
        assert.ok(!link.through && !link.managedDocuments, `${family} cancels without the framework's lock: ${link.table} needs it`);
      }
      assert.ok(!String(def).includes(`'${family}'`), `${family} cancels without the framework's lock: its managed documents need it`);
    }

    const used = new Set<string>();
    const unclassified: string[] = [];
    const towards = (parent: string, child: string) => all.filter((row) => row.parent === parent && row.child === child).length;
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
      // The history reads a child by its label: that is the record's side only when the table has
      // a single column towards the record.
      const read = (parent: string, child: string) => towards(parent, child) === 1 && readByHistory(entry, child);
      for (const first of all.filter((row) => row.parent === family)) {
        const key = `${first.child}.${first.column}`;
        if (declared((link) => !link.through && link.table === first.child && link.column === first.column)) continue;
        const reason = keptReason(key);
        if (!reason && !read(family, first.child)) unclassified.push(`${family}: ${key}`);
        if (reason?.startsWith('the delete refuses')) continue;
        for (const second of all.filter((row) => row.parent === first.child && row.child !== family)) {
          if (declared((link) => link.through?.table === first.child && link.through.column === first.column && link.table === second.child && link.column === second.column)) continue;
          if (keptReason(`${key}>${second.child}.${second.column}`) || read(first.child, second.child)) continue;
          unclassified.push(`${family}: ${key} > ${second.child}.${second.column}`);
        }
      }
      for (const link of links) {
        assert.ok(used.has(`${family}:${link.table}:${link.column}`), `${family}: the declaration ${link.table}.${link.column} matches a cascade foreign key`);
      }
      for (const key of Object.keys(kept)) assert.ok(used.has(`${family}:${key}`), `${family}: the kept entry ${key} matches a cascade foreign key`);
      for (const link of links) {
        for (const column of [link.author, link.live, link.afterRecord ? 'created_at' : undefined].filter(Boolean) as string[]) {
          const [found] = await dataSource.query(
            `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
            [link.table, column],
          );
          assert.ok(found, `${link.table}.${column} exists`);
        }
      }
    }
    assert.deepEqual(unclassified, [], 'every cascade key towards a record being created is declared, read by its history, or kept with its reason');
  } finally {
    await dataSource.destroy();
  }
  console.log('creation-links.inventory.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
