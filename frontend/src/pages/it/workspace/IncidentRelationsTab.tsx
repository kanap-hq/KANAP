import React from 'react';
import { Alert, Stack } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../auth/AuthContext';
import EntityTasksPanel from '../../../components/EntityTasksPanel';
import {
  RelationSections,
  RelationSuggestions,
  applicationsSection,
  assetsSection,
  technologiesSection,
  useRelations,
  type ApplicationRelationRow,
  type AssetRelationRow,
  type SectionSpec,
  type TechnologyRelationRow,
} from '../../../components/workspace/relations';
import { useRelationLabels } from '../../../components/workspace/relations/labels';
import { buildItemPath } from '../../../utils/item-ref';
import { incidentEntriesQueryKey } from './IncidentJournalTab';

type Suggestion = {
  type: 'technology';
  id: string;
  reference: string;
  name: string;
  family: string;
  vendor: string | null;
  via: { kind: 'asset_technology' | 'application_technology'; label: string };
};

type IncidentRelationsData = {
  assets: AssetRelationRow[] | null;
  applications: ApplicationRelationRow[] | null;
  technologies: TechnologyRelationRow[] | null;
  /** False on a closed or cancelled incident: nothing can be linked. */
  editable: boolean;
  suggestions: Suggestion[];
};

type LinkKind = 'assets' | 'applications' | 'technologies';

/** The module a section reads. Assets and technologies are the infrastructure. */
const SECTION_READ: Record<LinkKind, string> = {
  assets: 'infrastructure',
  applications: 'applications',
  technologies: 'infrastructure',
};

const LINK_KINDS = Object.keys(SECTION_READ) as LinkKind[];

type Props = {
  incidentId: string;
  readOnly: boolean;
  /** The page sets the tab badge from the length of each section the caller can see. */
  onLinksChange: (kind: LinkKind, count: number) => void;
  onTasksChange: () => void;
};

/**
 * The Relations tab of an incident: assets, applications and technologies in one round trip
 * (`GET /incidents/:id/relations`), then technologies suggested by those links, then tasks.
 * A row opens its record. A contributor adds from a server search and unlinks on hover, each
 * saved at once. A section the response leaves null is absent. Add and unlink also need a read
 * of that section's module. A closed or cancelled incident leaves Add, unlink and Link out.
 */
export default function IncidentRelationsTab({ incidentId, readOnly, onLinksChange, onTasksChange }: Props) {
  const { t } = useTranslation('it');
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const labels = useRelationLabels();
  const relationsKey = React.useMemo(() => ['incident-relations', incidentId] as const, [incidentId]);
  const contributor = hasLevel('incidents', 'contributor');

  const onWritten = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: incidentEntriesQueryKey(incidentId) });
    const fresh = queryClient.getQueryData<IncidentRelationsData>(relationsKey);
    if (!fresh) return;
    // A null section stays out of the badge: the detail already stores null for it.
    LINK_KINDS.forEach((kind) => {
      const rows = fresh[kind];
      if (rows) onLinksChange(kind, rows.length);
    });
  }, [incidentId, onLinksChange, queryClient, relationsKey]);

  const { data, error, setError, link, unlink } = useRelations<IncidentRelationsData>({
    path: `/incidents/${incidentId}/relations`,
    queryKey: relationsKey,
    onChange: onWritten,
    dropLinkedSuggestion: true,
  });

  // The page passes readOnly for a closed or cancelled incident. The payload says the same.
  const canWrite = contributor && !readOnly && data?.editable !== false;
  const canRead = (kind: string) => hasLevel(SECTION_READ[kind as LinkKind], 'reader');
  const withRights = <T extends { id: string }>(section: SectionSpec<T>): SectionSpec<T> => ({
    ...section,
    editable: canRead(section.kind),
  });

  const sections: Array<SectionSpec<any>> = [
    withRights(assetsSection({
      t,
      rows: data?.assets ?? null,
      kindLabel: labels.assetKind,
      environmentLabel: labels.environment,
      statusLabel: labels.status,
    })),
    withRights(applicationsSection({
      t,
      rows: data?.applications ?? null,
      lifecycleLabel: labels.lifecycle,
      criticalityLabel: labels.criticality,
    })),
    withRights(technologiesSection({
      t,
      rows: data?.technologies ?? null,
      familyLabel: labels.family,
    })),
  ];

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <RelationSections
        sections={sections}
        loaded={!!data}
        canEdit={canWrite}
        searchKeyPrefix="incident"
        onLink={(kind, targetId) => { void link(kind, targetId); }}
        onUnlink={(kind, targetId) => { void unlink(kind, targetId); }}
      />

      <RelationSuggestions
        suggestions={data?.suggestions ?? []}
        canEdit={canWrite && canRead('technologies')}
        referenceOf={(row) => row.reference}
        href={(row) => `${buildItemPath('technology', row.reference || row.id)}/overview`}
        onLink={(row) => { void link('technologies', row.id); }}
      />

      <EntityTasksPanel entityType="incident" entityId={incidentId} disabled={readOnly} onTasksChange={onTasksChange} />
    </Stack>
  );
}
