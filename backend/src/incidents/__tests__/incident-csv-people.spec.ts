import * as assert from 'node:assert/strict';
import { CsvImportContext } from '../../common/csv';
import { incidentCsvConfig } from '../incident-csv.config';

/**
 * Owner and Reporter are resolved by `importTransformFn` against the users cache the CSV
 * resolver preloads (keyed by lower-case e-mail, with `first_name` and `last_name`). That
 * cache does not filter on status, so a disabled account sits next to an enabled one and
 * makes a shared name ambiguous.
 */
const THOMAS = '10000000-0000-4000-8000-000000000001';
const ANNA_MARTIN = '10000000-0000-4000-8000-000000000002';
const MARTIN_ANNA = '10000000-0000-4000-8000-000000000003';
const LEA = '10000000-0000-4000-8000-000000000004';
const LEA_DISABLED = '10000000-0000-4000-8000-000000000005';
const ANNA_ANNA = '10000000-0000-4000-8000-000000000006';
const KELLER = '10000000-0000-4000-8000-000000000007';

const ANNA_MARTIN_EMAIL = 'anna.martin@example.test';
const MARTIN_ANNA_EMAIL = 'martin.anna@example.test';
const LEA_EMAIL = 'lea.roux@example.test';
const LEA_DISABLED_EMAIL = 'lea.roux.disabled@example.test';

type CachedUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  status: 'enabled' | 'disabled';
};

function user(
  id: string,
  firstName: string | null,
  lastName: string | null,
  status: CachedUser['status'] = 'enabled',
): CachedUser {
  return { id, first_name: firstName, last_name: lastName, status };
}

const users = new Map<string, CachedUser>([
  ['thomas.berger@example.test', user(THOMAS, 'Thomas', 'Berger')],
  [ANNA_MARTIN_EMAIL, user(ANNA_MARTIN, 'Anna', 'Martin')],
  [MARTIN_ANNA_EMAIL, user(MARTIN_ANNA, 'Martin', 'Anna')],
  [LEA_EMAIL, user(LEA, 'Lea', 'Roux')],
  [LEA_DISABLED_EMAIL, user(LEA_DISABLED, 'Lea', 'Roux', 'disabled')],
  ['anna.anna@example.test', user(ANNA_ANNA, 'Anna', 'Anna')],
  ['keller@example.test', user(KELLER, null, 'Keller')],
]);

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  manager: {},
  params: { dryRun: true },
  resolverCache: new Map([['users', users]]),
} as CsvImportContext;

const COLUMNS = ['owner', 'reporter'] as const;

function transform(column: (typeof COLUMNS)[number]) {
  const field = incidentCsvConfig.fields.find((item) => item.csvColumn === column);
  assert.ok(field?.importTransformFn, `${column} has an import transform`);
  return field.importTransformFn;
}

async function resolve(column: (typeof COLUMNS)[number], value: string): Promise<unknown> {
  return transform(column)(value, {}, context);
}

async function refusal(column: (typeof COLUMNS)[number], value: string): Promise<string> {
  try {
    await resolve(column, value);
  } catch (error) {
    assert.ok(error instanceof Error, `${column} "${value}" refuses with an Error`);
    return error.message;
  }
  assert.fail(`${column} "${value}" must be refused`);
}

function ambiguous(column: string, value: string, emails: string[]): string {
  const listed = [...emails].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join(', ');
  return `Several people match ${column} "${value}": ${listed}. Use the account e-mail.`;
}

function unknown(column: string, value: string): string {
  return `User not found for ${column}: "${value}". Use the account e-mail or the name in either order ("First Last" or "Last First").`;
}

const ELODIE = '10000000-0000-4000-8000-000000000008';
const ELODIE_EMAIL = 'elodie.lefevre@example.test';
const HELENE = '10000000-0000-4000-8000-000000000009';
const HELENE_2 = '10000000-0000-4000-8000-000000000010';

/** Lot I3 of 26.11.9: a context with the person's rights, a few accented people, and the import's lists of matches. */
function accentContext(params: Record<string, unknown> = {}): CsvImportContext {
  const people = new Map<string, CachedUser>([
    ...users,
    [ELODIE_EMAIL, user(ELODIE, 'Élodie', 'Lefèvre')],
    ['helene.a@example.test', user(HELENE, 'Hélène', 'Petit')],
    ['helene.b@example.test', user(HELENE_2, 'Hélene', 'Petit')],
  ]);
  return {
    ...context,
    params: { dryRun: true, ...params },
    access: { isAdmin: false, permissions: {} },
    resolverCache: new Map([['users', people]]),
    nameMatches: new Map(),
    refusedProposals: new Map(),
  } as CsvImportContext;
}

async function cellError(run: () => unknown): Promise<{ code?: string; params?: unknown; message: string }> {
  try {
    await run();
  } catch (error: any) {
    return { code: error.code, params: error.params, message: error.message };
  }
  assert.fail('must be refused');
}

async function testCodesAndAccents(): Promise<void> {
  for (const column of COLUMNS) {
    const unknownCell = await cellError(() => transform(column)('Camille Moreau', {}, context, 2));
    assert.equal(unknownCell.code, 'CSV_REFERENCE_NOT_FOUND', `${column}: unknown has a code`);
    assert.deepEqual(unknownCell.params, { value: 'Camille Moreau' });
    const several = await cellError(() => transform(column)('Lea Roux', {}, context, 2));
    assert.equal(several.code, 'CSV_NAME_AMBIGUOUS_AMONG', `${column}: several people has a code`);
    assert.deepEqual(several.params, { value: 'Lea Roux', names: [LEA_EMAIL, LEA_DISABLED_EMAIL].sort().join(', ') });

    const accents = accentContext();
    assert.equal(await transform(column)('Lefevre Elodie', {}, accents, 3), ELODIE, `${column}: accents aside, either order`);
    assert.deepEqual([...accents.nameMatches!.values()], [{
      column, name: null, value: 'Lefevre Elodie', target: 'Élodie Lefèvre', ref: null,
      origin: 'server', reason: 'accents', lines: [3], count: 1, undoable: true,
    }], `${column}: the match is listed`);
    assert.equal(await transform(column)('Élodie LEFÈVRE', {}, accents, 4), ELODIE, `${column}: case aside is no listed match`);
    assert.equal(accents.nameMatches!.size, 1);
    const twoHelene = await cellError(() => transform(column)('Helene Petit', {}, accents, 5));
    assert.equal(twoHelene.code, 'CSV_NAME_AMBIGUOUS_AMONG', `${column}: two people accents aside`);
    assert.deepEqual(twoHelene.params, { value: 'Helene Petit', names: 'helene.a@example.test, helene.b@example.test' });
    assert.equal(await transform(column)('Hélène Petit', {}, accents, 6), HELENE, `${column}: the exact spelling wins`);

    const undone = accentContext({ unmatched: [{ column, value: 'Lefevre Elodie' }] });
    assert.equal((await cellError(() => transform(column)('Lefevre Elodie', {}, undone, 2))).code, 'CSV_REFERENCE_NOT_FOUND', `${column}: undone`);
    const internal = { ...accentContext(), access: undefined } as CsvImportContext;
    assert.equal((await cellError(() => transform(column)('Lefevre Elodie', {}, internal, 2))).code, 'CSV_REFERENCE_NOT_FOUND', `${column}: no rights given, case aside only`);

    const proposed = accentContext({ proposals: { [column]: { 'E. Lefèvre': ELODIE_EMAIL, 'X. Inconnu': 'Personne Absente' } } });
    assert.equal(await transform(column)('E. Lefèvre', {}, proposed, 2), ELODIE, `${column}: Kad's proposal of an existing person`);
    assert.deepEqual([...proposed.nameMatches!.values()].map((m) => [m.value, m.target, m.origin, m.reason]), [['E. Lefèvre', 'Élodie Lefèvre', 'model', 'model']]);
    assert.equal((await cellError(() => transform(column)('X. Inconnu', {}, proposed, 3))).code, 'CSV_REFERENCE_NOT_FOUND');
    assert.deepEqual([...proposed.refusedProposals!.values()].map((r) => [r.column, r.value, r.target, r.reason]), [[column, 'X. Inconnu', 'Personne Absente', 'missing']]);
  }
}

async function run(): Promise<void> {
  await testCodesAndAccents();
  for (const column of COLUMNS) {
    assert.equal(await resolve(column, 'Berger Thomas'), THOMAS, `${column}: Last First`);
    assert.equal(await resolve(column, 'thomas  berger'), THOMAS, `${column}: case and repeated spaces`);

    assert.equal(
      await refusal(column, 'Anna Martin'),
      ambiguous(column, 'Anna Martin', [ANNA_MARTIN_EMAIL, MARTIN_ANNA_EMAIL]),
      `${column}: Anna Martin names both people`,
    );
    assert.equal(
      await refusal(column, 'Martin Anna'),
      ambiguous(column, 'Martin Anna', [ANNA_MARTIN_EMAIL, MARTIN_ANNA_EMAIL]),
      `${column}: Martin Anna names both people`,
    );

    assert.equal(
      await refusal(column, 'Lea Roux'),
      ambiguous(column, 'Lea Roux', [LEA_EMAIL, LEA_DISABLED_EMAIL]),
      `${column}: two Lea Roux, one disabled, are both named`,
    );

    assert.equal(await resolve(column, 'Anna Anna'), ANNA_ANNA, `${column}: a repeated name counts once`);
    assert.equal(await resolve(column, 'Keller'), KELLER, `${column}: a last name alone counts once`);

    assert.equal(await resolve(column, 'Thomas.Berger@example.test'), THOMAS, `${column}: e-mail, any case`);
    assert.equal(
      await resolve(column, LEA_DISABLED_EMAIL),
      LEA_DISABLED,
      `${column}: an e-mail finds its person even when the name is shared`,
    );

    assert.equal(await resolve(column, ''), null, `${column}: an empty cell`);
    assert.equal(await resolve(column, '   '), null, `${column}: a blank cell`);

    assert.equal(
      await refusal(column, 'Camille Moreau'),
      unknown(column, 'Camille Moreau'),
      `${column}: an unknown name says either order is accepted`,
    );
  }
  console.log('incident-csv-people.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
