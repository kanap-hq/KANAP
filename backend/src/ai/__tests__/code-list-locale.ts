import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import type { AiCodeList } from '../ai-code-names';

/**
 * The locale objects that hold more than one list's words (`common:statuses` names every status
 * kind) or a word that is not a code (`renewedOn`, the legacy `production`): their copy holds part
 * of them.
 */
const SHARED_SCREENS = new Set(['common:statuses', 'master-data:contacts.status', 'ops:contracts.list.states', 'it:enums.environment']);

/**
 * A fixed list is the screens' (`ai-code-names.ts`): each code of the copy has the words of the
 * locale object in the four languages, and the copy holds every code that object names. A catalog
 * list is the workspace's: nothing to compare.
 */
export function assertCodeListIsTheScreens(name: string, list: AiCodeList): void {
  if (list.kind !== 'fixed') return;
  const [namespace, path] = list.screen.split(':');
  assert.ok(namespace && path, `${name}: screen is namespace:path`);
  const keyOf = (code: string) => list.keys?.[code] ?? code;
  const codes = Object.keys(list.labels.en);
  assert.ok(codes.length > 0, `${name}: an empty list`);
  assertLocaleLabels(namespace, Object.fromEntries(codes.map((code) => [code, `${path}.${keyOf(code)}`])), list.labels as any);
  if (SHARED_SCREENS.has(list.screen)) return;
  const json = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', 'en', `${namespace}.json`), 'utf8'));
  const object = path.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), json);
  const copied = new Set(codes.map(keyOf));
  for (const key of Object.keys(object ?? {})) assert.ok(copied.has(key), `${name}: ${list.screen}.${key} is not in the copy`);
}
