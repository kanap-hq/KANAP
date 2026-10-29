import React from 'react';
import { Alert, Stack } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import ItemContactsSection from '../../../components/contacts/ItemContactsSection';
import { useKanapDialogs } from '../../../components/design';
import LinksAndFilesSection, { type LinkDraft, type LinksAndFilesFile, type LinksAndFilesLink } from '../../../components/workspace/LinksAndFilesSection';
import {
  RelationSections,
  RelationSuggestions,
  applicationsSection,
  assetsSection,
  contractsSection,
  projectsSection,
  technologiesSection,
  useRelations,
  type ApplicationRelationRow,
  type AssetRelationRow,
  type ContractRow,
  type ProjectRow,
  type SectionSpec,
  type TechnologyRelationRow,
} from '../../../components/workspace/relations';
import { useRelationLabels } from '../../../components/workspace/relations/labels';
import type { LineType } from '../../../constants/lineTypeUsage';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { buildItemPath } from '../../../utils/item-ref';
import { BUDGET_NATURE_CONFIG } from '../natureConfig';

type Suggestion = {
  type: 'application' | 'contract';
  id: string;
  /** `APP-n` for an application. Null for a contract: a contract has no business reference. */
  reference: string | null;
  name: string;
  via: { kind: 'same_supplier'; label: string | null };
};

type BudgetLineRelationsData = {
  projects: ProjectRow[] | null;
  applications: ApplicationRelationRow[] | null;
  technologies: TechnologyRelationRow[] | null;
  contracts: ContractRow[] | null;
  /** The linked contracts `contracts` leaves out: outside the caller's data access. */
  contracts_hidden?: number;
  assets: AssetRelationRow[] | null;
  suggestions: Suggestion[];
};

type WebLinkRow = { id: string; description: string | null; url: string; created_at: string | null };
type AttachmentRow = { id: string; original_filename: string; size: number | null; uploaded_at: string | null };

const SUGGESTION_KIND: Record<Suggestion['type'], 'applications' | 'contracts'> = {
  application: 'applications',
  contract: 'contracts',
};

/** The module a section reads. Technologies and assets are the infrastructure. The server refuses a link without it. */
const SECTION_READ: Record<string, string> = {
  projects: 'portfolio_projects',
  applications: 'applications',
  technologies: 'infrastructure',
  contracts: 'contracts',
  assets: 'infrastructure',
};

/**
 * The Relations tab of an OPEX or CAPEX line: projects, applications, technologies, contracts and
 * assets in one round trip (`GET /budget-lines/:id/relations`), then supplier suggestions, contacts,
 * and links and files. A row opens its record. A member adds from a server search and unlinks on
 * hover, each saved at once. A section the response leaves null is absent. Add is left out when the
 * caller cannot read that module. Technologies and assets also need a read of the infrastructure.
 */
export default function BudgetLineRelationsTab({
  lineId,
  nature,
  lineEditable = true,
  onRelationsChange,
}: {
  lineId: string;
  nature: LineType;
  /** False when the person's data access leaves the line read only: no add, remove or upload. */
  lineEditable?: boolean;
  /** The page reads the relations badge again. */
  onRelationsChange: () => void;
}) {
  const { t, i18n } = useTranslation(['it', 'common', 'portfolio', 'ops']);
  const { hasLevel } = useAuth();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const labels = useRelationLabels();
  const { itemsApi } = BUDGET_NATURE_CONFIG[nature];
  const contactsItemType = nature === 'opex' ? 'spend-items' : 'capex-items';
  const canEdit = hasLevel('budget', 'member') && lineEditable;
  const [uploading, setUploading] = React.useState(0);
  const relationsKey = ['budget-line-relations', lineId] as const;
  const linksKey = ['budget-line-links', itemsApi, lineId] as const;
  const attachmentsKey = ['budget-line-attachments', itemsApi, lineId] as const;
  const { data, error, setError, link, unlink } = useRelations<BudgetLineRelationsData>({
    path: `/budget-lines/${lineId}/relations`,
    queryKey: relationsKey,
    onChange: onRelationsChange,
    dropLinkedSuggestion: true,
  });

  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: async ({ signal }) => (await api.get<WebLinkRow[]>(`${itemsApi}/${lineId}/links`, { signal })).data || [],
  });
  const attachmentsQuery = useQuery({
    queryKey: attachmentsKey,
    queryFn: async ({ signal }) => (await api.get<AttachmentRow[]>(`${itemsApi}/${lineId}/attachments`, { signal })).data || [],
  });

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [setError, t]);

  const links: LinksAndFilesLink[] = (linksQuery.data ?? []).map((row) => ({
    id: row.id,
    name: row.description,
    url: row.url,
    added_at: row.created_at,
  }));
  const files: LinksAndFilesFile[] = (attachmentsQuery.data ?? []).map((row) => ({
    id: row.id,
    name: row.original_filename,
    size: row.size,
    added_at: row.uploaded_at,
  }));

  const saveLink = async (linkRow: LinksAndFilesLink | null, draft: LinkDraft) => {
    setError(null);
    const body = { description: draft.name, url: draft.url };
    if (linkRow) await api.patch(`${itemsApi}/${lineId}/links/${linkRow.id}`, body);
    else await api.post(`${itemsApi}/${lineId}/links`, body);
    await queryClient.invalidateQueries({ queryKey: linksKey });
    onRelationsChange();
  };

  const removeLink = async (linkRow: LinksAndFilesLink) => {
    setError(null);
    const previous = queryClient.getQueryData<WebLinkRow[]>(linksKey);
    queryClient.setQueryData<WebLinkRow[]>(linksKey, (rows) => (rows ? rows.filter((row) => row.id !== linkRow.id) : rows));
    try {
      await api.delete(`${itemsApi}/${lineId}/links/${linkRow.id}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(linksKey, previous);
      failed(e);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: linksKey });
    onRelationsChange();
  };

  const uploadFiles = async (chosen: File[]) => {
    setError(null);
    setUploading(chosen.length);
    let landed = false;
    try {
      for (const file of chosen) {
        const form = new FormData();
        form.append('file', file);
        await api.post(`${itemsApi}/${lineId}/attachments`, form);
        landed = true;
      }
    } catch (e) {
      failed(e);
    } finally {
      setUploading(0);
    }
    if (!landed) return;
    await queryClient.invalidateQueries({ queryKey: attachmentsKey });
    onRelationsChange();
  };

  const openFile = async (file: LinksAndFilesFile) => {
    try {
      const res = await api.get(`${itemsApi}/attachments/${file.id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      failed(e);
    }
  };

  // Deleting a file removes the stored document: it keeps its confirmation.
  const removeFile = async (file: LinksAndFilesFile) => {
    const ok = await dialogs.confirm({
      message: t('ops:confirmations.deleteAttachment', { name: file.name }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    });
    if (!ok) return;
    setError(null);
    try {
      await api.patch(`${itemsApi}/attachments/${file.id}/delete`, {});
    } catch (e) {
      failed(e);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: attachmentsKey });
    onRelationsChange();
  };

  const lang = i18n.language;
  // A missing read leaves the rows null, and the section is absent. When rows are present anyway,
  // Add stays out: the server refuses the link.
  const readable = <T extends { id: string }>(section: SectionSpec<T>): SectionSpec<T> => ({
    ...section,
    editable: hasLevel(SECTION_READ[section.kind], 'reader'),
  });
  const sections: Array<SectionSpec<any>> = [
    readable(projectsSection({ t, rows: data?.projects ?? null, lang })),
    readable(applicationsSection({
      t,
      rows: data?.applications ?? null,
      lifecycleLabel: labels.lifecycle,
      criticalityLabel: labels.criticality,
    })),
    readable(technologiesSection({
      t,
      rows: data?.technologies ?? null,
      familyLabel: labels.family,
    })),
    readable(contractsSection({ t, rows: data?.contracts ?? null, lang, hidden: data?.contracts_hidden, lineId })),
    readable(assetsSection({
      t,
      rows: data?.assets ?? null,
      kindLabel: labels.assetKind,
      environmentLabel: labels.environment,
      statusLabel: labels.status,
    })),
  ];

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <RelationSections
        sections={sections}
        loaded={!!data}
        canEdit={canEdit}
        searchKeyPrefix="budget-line"
        onLink={(kind, targetId) => { void link(kind, targetId); }}
        onUnlink={(kind, targetId) => { void unlink(kind, targetId); }}
      />

      <RelationSuggestions
        suggestions={data?.suggestions ?? []}
        canEdit={canEdit}
        referenceOf={(row) => (row.type === 'application' ? row.reference : null)}
        href={(row) => (row.type === 'application'
          ? `${buildItemPath('application', row.reference || row.id)}/overview`
          : `/ops/contracts/${row.id}/overview`)}
        onLink={(row) => { void link(SUGGESTION_KIND[row.type], row.id); }}
      />

      <ItemContactsSection itemType={contactsItemType} itemId={lineId} canManage={canEdit} />

      <LinksAndFilesSection
        links={links}
        files={files}
        loaded={linksQuery.isSuccess && attachmentsQuery.isSuccess}
        canEdit={canEdit}
        uploading={uploading}
        onAddLink={(draft) => saveLink(null, draft)}
        onEditLink={(linkRow, draft) => saveLink(linkRow, draft)}
        onRemoveLink={(linkRow) => { void removeLink(linkRow); }}
        onUploadFiles={(chosen) => { void uploadFiles(chosen); }}
        onOpenFile={(file) => { void openFile(file); }}
        onRemoveFile={(file) => { void removeFile(file); }}
      />
    </Stack>
  );
}
