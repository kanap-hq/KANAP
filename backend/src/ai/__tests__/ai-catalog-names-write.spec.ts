import * as assert from 'node:assert/strict';
import { catalogValueName } from '../ai-code-names';
import { findCatalogOption } from '../../it-ops-settings/catalog-resolve';
import { SHIPPED_CATALOG_LABELS, withShippedLabels } from '../../it-ops-settings/catalog-shipped-labels';
import type { ItOpsSettings } from '../../it-ops-settings/it-ops-settings.service';

/**
 * Kad reads a catalog value by its name (`catalogValueName`, lot K2d) and writes it back by that name
 * (`findCatalogOption` on the lists `withShippedLabels` completes, rule P7): one naming, read and
 * written. Every name Kad reads, in each of the four languages, designates the same value on write.
 */
function testEveryNameKadReadsIsWrittenBack(): void {
  let checked = 0;
  for (const [list, shipped] of Object.entries(SHIPPED_CATALOG_LABELS)) {
    const options = Object.entries(shipped).map(([code, text]) => ({ code, label: text.source }));
    const settings = withShippedLabels({ [list]: options } as unknown as ItOpsSettings) as unknown as Record<string, typeof options>;
    for (const option of options) {
      for (const language of ['en', 'fr', 'de', 'es'] as const) {
        const name = catalogValueName(list as Parameters<typeof catalogValueName>[0], option, language);
        assert.ok(name, `${list}.${option.code} has a name in ${language}`);
        assert.equal(findCatalogOption(name, settings[list])?.code, option.code, `${list}: "${name}" (${language}) is written as ${option.code}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 100, `the shipped lists are checked (${checked} names)`);
}

function testATenantTranslationIsWrittenBack(): void {
  const options = [
    { code: 'vm', label: 'Virtual machine', translations: { fr: { label: 'Machine virtuelle maison' } } },
    { code: 'physical', label: 'Physical server' },
  ];
  const name = catalogValueName('serverKinds', options[0], 'fr');
  assert.equal(name, 'Machine virtuelle maison');
  assert.equal(findCatalogOption(name, options)?.code, 'vm');
}

testEveryNameKadReadsIsWrittenBack();
testATenantTranslationIsWrittenBack();
console.log('ai-catalog-names-write.spec: ok');
