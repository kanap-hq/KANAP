import React from 'react';
import { Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { RelationRef, RelationsSection, RelationsTable, type RelationsColumn } from '../RelationsTable';

/** One suggested link. `type` names a `workspace.application.relations.types` key. */
export type RelationSuggestion = {
  type: string;
  id: string;
  name: string;
  via: { kind: string; label: string | null };
};

type Props<T extends RelationSuggestion> = {
  suggestions: T[];
  /** Readers see the table without the Link button. */
  canEdit: boolean;
  /** The business reference shown before the name, or null when the row has none. */
  referenceOf: (row: T) => string | null;
  href: (row: T) => string;
  /** Creates the link. The caller drops the row from this list. */
  onLink: (row: T) => void;
};

/**
 * The "Related" suggestions of a Relations tab: type, object, why, and Link.
 * Absent when there is nothing to suggest.
 */
export default function RelationSuggestions<T extends RelationSuggestion>({
  suggestions, canEdit, referenceOf, href, onLink,
}: Props<T>) {
  const { t } = useTranslation('it');
  if (suggestions.length === 0) return null;

  const columns: Array<RelationsColumn<T>> = [
    {
      key: 'type',
      header: t('workspace.application.relations.columns.type'),
      width: 130,
      render: (row) => t(`workspace.application.relations.types.${row.type}`),
    },
    {
      key: 'object',
      header: t('workspace.application.relations.columns.object'),
      render: (row) => {
        const ref = referenceOf(row);
        return <>{ref && <><RelationRef>{ref}</RelationRef>{'\u00a0 '}</>}{row.name}</>;
      },
    },
    {
      key: 'via',
      header: t('workspace.application.relations.columns.via'),
      width: 200,
      hideOrder: 1,
      render: (row) => (
        <Box component="span" sx={{ color: 'kanap.text.secondary' }}>
          {t(`workspace.application.relations.via.${row.via.kind}`, { label: row.via.label ?? '' })}
        </Box>
      ),
    },
  ];

  return (
    <RelationsSection title={t('workspace.application.relations.sections.related')} count={t('workspace.application.relations.suggestions', { count: suggestions.length })}>
      <RelationsTable
        ariaLabel={t('workspace.application.relations.sections.related')}
        columns={columns}
        rows={suggestions}
        rowKey={(row) => `${row.type}:${row.id}`}
        rowHref={href}
        action={canEdit ? {
          width: 56,
          render: (row) => (
            <Button
              variant="text"
              size="small"
              onClick={() => { onLink(row); }}
              aria-label={t('workspace.application.relations.linkNamed', { name: row.name })}
              sx={{ fontSize: 12, minWidth: 0, p: '0 4px' }}
            >
              {t('workspace.application.relations.link')}
            </Button>
          ),
        } : undefined}
      />
    </RelationsSection>
  );
}
