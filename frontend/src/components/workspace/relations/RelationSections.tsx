import React from 'react';
import { useTranslation } from 'react-i18next';
import RelationAddPicker from '../RelationAddPicker';
import { RelationsEmpty, RelationsSection, RelationsTable } from '../RelationsTable';
import { TOTALS_FROM } from './helpers';
import type { AnyRow, SectionSpec } from './types';

type Props = {
  /** One entry per kind. Row types differ, so the list is not one `SectionSpec<T>`. */
  sections: Array<SectionSpec<any>>;
  /** The relations payload is in: counts and Add show. While it loads, each section is its empty line. */
  loaded: boolean;
  /** The caller's right to edit this object. A section may still refuse (`editable: false`). */
  canEdit: boolean;
  /** Picker cache key prefix (`application`, `technology`), kept per object. */
  searchKeyPrefix: string;
  /** `label` is the name the picker showed, for the message that follows. */
  onLink: (kind: string, targetId: string, label?: string) => void;
  onUnlink: (kind: string, targetId: string) => void;
};

/**
 * The linked sections of a Relations tab: one dense table per kind, Add anchored to its button,
 * unlink on hover. A section whose rows are null (the caller cannot read the module) is left out.
 */
export default function RelationSections({ sections, loaded, canEdit, searchKeyPrefix, onLink, onUnlink }: Props) {
  const { t } = useTranslation('it');
  const [adding, setAdding] = React.useState<{ kind: string; anchor: HTMLElement } | null>(null);

  return (
    <>
      {sections.filter((section) => section.rows !== null).map((section) => {
        const rows = section.rows as AnyRow[];
        const linkedIds = section.linkedIds ? section.linkedIds(rows) : new Set(rows.map((row) => row.id));
        const editable = canEdit && (section.editable ?? true);
        return (
          <RelationsSection
            key={section.kind}
            title={section.title}
            count={loaded ? rows.length : undefined}
            onAdd={editable && loaded ? (anchor) => setAdding({ kind: section.kind, anchor }) : undefined}
            adding={adding?.kind === section.kind}
            addLabel={t('workspace.application.relations.add')}
          >
            {adding?.kind === section.kind && (
              <RelationAddPicker
                anchorEl={adding.anchor}
                searchKey={`${searchKeyPrefix}-${section.kind}`}
                search={section.search}
                excludeIds={linkedIds}
                placeholder={section.searchPlaceholder}
                ariaLabel={section.searchPlaceholder}
                onPick={(option) => { setAdding(null); onLink(section.kind, option.id, option.label); }}
                onClose={() => setAdding(null)}
              />
            )}
            {rows.length === 0 ? (
              <RelationsEmpty>{section.empty}</RelationsEmpty>
            ) : (
              <RelationsTable
                ariaLabel={section.title}
                columns={section.columns}
                rows={rows}
                rowKey={(row) => row.id}
                rowHref={section.href}
                linkRows
                rowMuted={section.muted}
                onRemove={editable ? (row) => { onUnlink(section.kind, row.id); } : undefined}
                removeLabel={(row) => t('workspace.application.relations.remove', { name: section.label(row) })}
                canRemove={section.removable}
                totals={rows.length >= TOTALS_FROM ? section.totals?.(rows) : undefined}
              />
            )}
            {rows.length > 0 && section.notice?.(rows)}
          </RelationsSection>
        );
      })}
    </>
  );
}
