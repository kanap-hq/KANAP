import React from 'react';
import { Alert, Box, IconButton, Link, Tooltip } from '@mui/material';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { formatShortDate } from '../../../lib/dateFormat';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import RelationAddPicker, { type RelationOption } from '../../../components/workspace/RelationAddPicker';
import { invalidateTechnologyLinks } from '../components/technologyLinkQueries';
import TechnologyVersionPicker, { type VersionChoice, type VersionOption } from '../components/TechnologyVersionPicker';
import { applicationRelationsKey, type ApplicationRelationsData, type TechnologyRow } from './ApplicationRelationsTab';
import TechnologyServersProposal from './TechnologyServersProposal';

const PAGE = 30;

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

type Declaration = NonNullable<TechnologyRow['declarations']>[number];

/** What a step of the add (or of "Record on a server") holds so far. */
type Flow =
  | { step: 'technology'; anchor: HTMLElement }
  | { step: 'version'; anchor: HTMLElement; technology: RelationOption }
  | { step: 'servers'; anchor: HTMLElement; technology: RelationOption; choice: VersionChoice; version: string | null; mode: 'add' | 'record' };

/**
 * The technologies of an application, the same section the Relations tab used to show (lot T2a):
 * declared rows can be added and removed, hosted rows stay, with the server they come from (the
 * server's page changes them). An add picks the technology, then its version, then, when the
 * application has deployment servers, offers to record it on them (nothing ticked). The version of
 * a declaration changes from the version; a declaration no server of the application carries can
 * be recorded on one. One read of `GET /applications/:id/relations`; each write is one call.
 */
/** What the section lends to the content rendered after it. */
export type ApplicationTechnologyTools = {
  /**
   * Opens "Record on a server" for a declared technology and version, the flow of the section's own
   * row action. Undefined when the user may not record on servers or the application has none.
   */
  recordOnServer?: (
    target: { technologyId: string; name: string; versionId: string | null; version: string | null },
    anchor: HTMLElement,
  ) => void;
};

export default function ApplicationTechnologiesSection({
  id,
  after,
}: {
  id: string;
  /** Rendered after the section, even when the user may not see the technologies. */
  after?: (tools: ApplicationTechnologyTools) => React.ReactNode;
}) {
  const { t, i18n } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const { labelFor } = useItOpsEnumOptions();
  const queryClient = useQueryClient();
  const [flow, setFlow] = React.useState<Flow | null>(null);
  const [versionEdit, setVersionEdit] = React.useState<{ row: TechnologyRow; declaration: Declaration; anchor: HTMLElement } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const key = applicationRelationsKey(id);
  const lang = i18n.language;
  const canEdit = hasLevel('applications', 'manager') && hasLevel('infrastructure', 'manager');
  // Recording on a server writes the server's technologies: the right of the asset side.
  const canRecordOnServers = canEdit && hasLevel('infrastructure', 'manager');

  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<ApplicationRelationsData>(`/applications/${id}/relations`)).data,
  });

  const pickedId = (flow && flow.step !== 'technology' ? flow.technology.id : null) ?? versionEdit?.row.id ?? null;
  const { data: versions } = useQuery({
    queryKey: ['technology-versions', pickedId],
    queryFn: async () => (await api.get<{ items: VersionOption[] }>(`/technologies/${pickedId}/versions`)).data.items,
    enabled: !!pickedId,
  });

  const refresh = React.useCallback(async () => {
    // The servers' own sections show the links recorded from here.
    await invalidateTechnologyLinks(queryClient);
  }, [queryClient]);

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [t]);

  const link = React.useCallback(async (targetId: string, choice: VersionChoice, assetIds: string[] = []) => {
    setError(null);
    try {
      await api.post(`/applications/${id}/relations/technologies`, { id: targetId, ...choice, ...(assetIds.length ? { asset_ids: assetIds } : {}) });
    } catch (e) {
      failed(e);
    }
    await refresh();
  }, [failed, id, refresh]);

  const changeVersion = React.useCallback(async (row: TechnologyRow, declaration: Declaration, choice: VersionChoice) => {
    setError(null);
    try {
      await api.patch(`/technologies/${row.id}/application-links/${declaration.link_id}`, choice);
    } catch (e) {
      failed(e);
    }
    await refresh();
  }, [failed, refresh]);

  const unlink = React.useCallback(async (targetId: string) => {
    setError(null);
    const previous = queryClient.getQueryData<ApplicationRelationsData>(key);
    queryClient.setQueryData<ApplicationRelationsData>(key, (prev) => {
      if (!prev?.technologies) return prev;
      // A technology also hosted by a server stays, as hosted only.
      const technologies = prev.technologies
        .map((row) => (row.id === targetId ? { ...row, declared: false } : row))
        .filter((row) => row.declared || row.hosted);
      return { ...prev, technologies };
    });
    try {
      await api.delete(`/applications/${id}/relations/technologies/${targetId}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(key, previous);
      failed(e);
      return;
    }
    await refresh();
  }, [failed, id, key, queryClient, refresh]);

  // The family of each technology the picker offered: an operating system is not offered on servers.
  const lookedUpFamilies = React.useRef(new Map<string, string | null>());
  const search = React.useCallback(async (q: string, signal?: AbortSignal) => {
    const res = await api.get<{ items: Array<{ id: string; name: string; reference: string | null; editor: string | null; family?: string | null }> }>('/technologies/lookup', {
      params: { limit: PAGE, ...(q ? { q } : {}) },
      signal,
    });
    for (const row of res.data?.items || []) lookedUpFamilies.current.set(row.id, row.family ?? null);
    return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name, ref: row.reference, hint: row.editor }));
  }, []);

  if (data && data.technologies === null) return after ? <>{after({})}</> : null;

  const rows = data?.technologies ?? [];
  const servers = data?.deployment_servers ?? [];
  /** The servers of the application that carry the technology already (installed, or through their host). */
  const carryingOf = (technologyId: string) => new Set(rows.find((row) => row.id === technologyId)?.via.map((via) => via.asset_id) ?? []);
  /** Whether a technology can be recorded on a server from here: an operating system is set on the server's page. */
  const offersServers = (technologyId: string, family: string | null) => {
    if (!canRecordOnServers || family === 'operating_system' || servers.length === 0) return false;
    const carrying = carryingOf(technologyId);
    return servers.some((server) => !carrying.has(server.asset_id));
  };
  const versionText = (choice: VersionChoice): string | null => ('version_label' in choice
    ? choice.version_label.trim()
    : choice.technology_version_id ? versions?.find((v) => v.id === choice.technology_version_id)?.label ?? null : null);
  const familyOf = (technologyId: string) => rows.find((row) => row.id === technologyId)?.family ?? lookedUpFamilies.current.get(technologyId) ?? null;
  const pickVersion = (technology: RelationOption, anchor: HTMLElement, choice: VersionChoice) => {
    if (!offersServers(technology.id, familyOf(technology.id))) {
      setFlow(null);
      void link(technology.id, choice);
      return;
    }
    setFlow({ step: 'servers', anchor, technology, choice, version: versionText(choice), mode: 'add' });
  };
  const recordOnServer: ApplicationTechnologyTools['recordOnServer'] = data && canRecordOnServers && servers.length > 0
    ? (target, anchor) => {
      if (!offersServers(target.technologyId, familyOf(target.technologyId))) return;
      setFlow({
        step: 'servers',
        anchor,
        technology: { id: target.technologyId, label: target.name },
        choice: { technology_version_id: target.versionId },
        version: target.version,
        mode: 'record',
      });
    }
    : undefined;
  const today = todayYmd();
  const dash = '—';
  const title = t('workspace.application.relations.sections.technologies');
  const familyLabel = (code: string | null) => (code ? labelFor('technologyFamily', code) || code : dash);
  const serverLabel = (via: TechnologyRow['via'][number]) => (via.host_name
    ? t('workspace.application.relations.viaHost', { server: via.asset_name ?? dash, host: via.host_name })
    : via.asset_name ?? dash);
  const technologyLink = (row: TechnologyRow) => (row.declared && row.hosted ? 'both' : row.declared ? 'declared' : 'hosted');
  const columns: Array<RelationsColumn<TechnologyRow>> = [
    { key: 'ref', header: t('workspace.application.relations.columns.ref'), width: 72, render: (row) => <RelationRef>{row.reference ?? dash}</RelationRef> },
    { key: 'name', header: t('workspace.application.relations.columns.name'), render: (row) => <span title={row.name ?? undefined}>{row.name ?? dash}</span> },
    { key: 'family', header: t('workspace.application.relations.columns.family'), width: 110, hideOrder: 3, render: (row) => familyLabel(row.family) },
    {
      key: 'version', header: t('workspace.application.relations.columns.version'), width: 72,
      render: (row) => {
        const declarations = canEdit ? row.declarations ?? [] : [];
        if (declarations.length === 0) {
          return row.versions.length > 0
            ? <span title={row.versions.join(', ')}>{row.versions.join(', ')}</span>
            : <Box component="span" title={t('workspace.application.relations.versionUnknown')} sx={{ color: 'kanap.text.tertiary' }}>{dash}</Box>;
        }
        // The declared versions change from here; the versions the servers carry change on their page.
        const declared = new Set(declarations.map((d) => d.version_label).filter(Boolean));
        const hostedOnly = row.versions.filter((label) => !declared.has(label));
        return (
          <Box component="span" title={row.versions.join(', ') || undefined} sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {declarations.map((declaration, index) => (
              <React.Fragment key={declaration.link_id}>
                {index > 0 && ', '}
                <Box
                  component="button"
                  type="button"
                  title={declaration.version_label ?? t('workspace.application.relations.versionUnknown')}
                  aria-label={t('workspace.application.relations.technologyServers.changeVersion', { name: row.name ?? '' })}
                  onClick={(event: React.MouseEvent<HTMLElement>) => {
                    event.stopPropagation();
                    setVersionEdit({ row, declaration, anchor: event.currentTarget });
                  }}
                  sx={{ all: 'unset', cursor: 'pointer', color: declaration.version_label ? 'inherit' : 'kanap.text.tertiary' }}
                >
                  {declaration.version_label ?? dash}
                </Box>
              </React.Fragment>
            ))}
            {hostedOnly.length > 0 && `, ${hostedOnly.join(', ')}`}
          </Box>
        );
      },
    },
    {
      key: 'link', header: t('workspace.application.relations.columns.link'), width: 120, hideOrder: 2,
      render: (row) => {
        const label = t(`workspace.application.relations.technologyLink.${technologyLink(row)}`);
        return <span title={label}>{label}</span>;
      },
    },
    {
      key: 'via', header: t('workspace.application.relations.columns.via'), width: 140, hideOrder: 1,
      render: (row) => {
        const names = row.via.map(serverLabel).join(', ');
        // Each server leads to its page, where what it carries is changed.
        return (
          <Box component="span" title={names || undefined} sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.via.map((via, index) => (
              <React.Fragment key={via.asset_id}>
                {index > 0 && ', '}
                <Link
                  component={RouterLink}
                  to={`/it/assets/${via.asset_id}/operations`}
                  onClick={(event: React.MouseEvent) => event.stopPropagation()}
                  underline="hover"
                  sx={{ color: 'inherit' }}
                >
                  {serverLabel(via)}
                </Link>
              </React.Fragment>
            ))}
          </Box>
        );
      },
    },
    {
      key: 'supportEnd', header: t('workspace.application.relations.columns.supportEnd'), width: 100,
      render: (row) => {
        const ended = !!row.standard_support_end && row.standard_support_end < today;
        return (
          <Box component="span" sx={ended ? { color: 'kanap.orange' } : undefined}>
            {row.standard_support_end ? formatShortDate(row.standard_support_end, lang, { year: 'always' }) : dash}
          </Box>
        );
      },
    },
  ];
  const searchLabel = t('workspace.application.relations.search.technologies');

  return (
    <>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <RelationsSection
        title={title}
        count={data ? rows.length : undefined}
        onAdd={canEdit && data ? (anchor) => setFlow({ step: 'technology', anchor }) : undefined}
        adding={!!flow && !(flow.step === 'servers' && flow.mode === 'record')}
        addLabel={t('workspace.application.relations.add')}
      >
        {flow?.step === 'technology' && (
          <RelationAddPicker
            anchorEl={flow.anchor}
            searchKey={`application-technologies-${id}`}
            search={search}
            excludeIds={new Set(rows.filter((row) => row.declared).map((row) => row.id))}
            placeholder={searchLabel}
            ariaLabel={searchLabel}
            onPick={(technology) => setFlow({ step: 'version', anchor: flow.anchor, technology })}
            onClose={() => setFlow(null)}
          />
        )}
        {flow?.step === 'version' && (
          <TechnologyVersionPicker
            anchorEl={flow.anchor}
            versions={versions}
            onPick={(choice) => pickVersion(flow.technology, flow.anchor, choice)}
            onClose={() => setFlow(null)}
          />
        )}
        {flow?.step === 'servers' && (
          <TechnologyServersProposal
            anchorEl={flow.anchor}
            technology={flow.technology.label}
            version={flow.version}
            servers={servers}
            carrying={carryingOf(flow.technology.id)}
            mode={flow.mode}
            onConfirm={async (assetIds) => {
              const { technology, choice } = flow;
              setFlow(null);
              await link(technology.id, choice, assetIds);
            }}
            onClose={() => setFlow(null)}
          />
        )}
        {versionEdit && (
          <TechnologyVersionPicker
            anchorEl={versionEdit.anchor}
            versions={versions}
            current={versionEdit.declaration.technology_version_id}
            onPick={(choice) => { const { row, declaration } = versionEdit; setVersionEdit(null); void changeVersion(row, declaration, choice); }}
            onClose={() => setVersionEdit(null)}
          />
        )}
        {rows.length === 0 ? (
          <RelationsEmpty>{t('workspace.application.relations.empty.technologies')}</RelationsEmpty>
        ) : (
          <RelationsTable
            ariaLabel={title}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/it/technologies/${row.reference ?? row.id}`}
            onRemove={canEdit ? (row) => { void unlink(row.id); } : undefined}
            removeLabel={(row) => t('workspace.application.relations.remove', { name: row.name ?? row.reference ?? '' })}
            canRemove={(row) => row.declared}
            action={canRecordOnServers && servers.length > 0 ? {
              width: 32,
              render: (row) => {
                const declarations = row.declarations ?? [];
                // A declaration no server of the application carries yet; one version, to record that one.
                if (!row.declared || row.hosted || declarations.length !== 1 || !offersServers(row.id, row.family)) return null;
                const declaration = declarations[0];
                const label = t('workspace.application.relations.technologyServers.actionNamed', { name: row.name ?? '' });
                return (
                  <Tooltip title={t('workspace.application.relations.technologyServers.action')} enterTouchDelay={0}>
                    <IconButton
                      size="small"
                      aria-label={label}
                      onClick={(event) => setFlow({
                        step: 'servers',
                        anchor: event.currentTarget,
                        technology: { id: row.id, label: row.name ?? row.reference ?? '' },
                        choice: { technology_version_id: declaration.technology_version_id },
                        version: declaration.version_label,
                        mode: 'record',
                      })}
                      sx={{ p: '2px', color: 'kanap.text.tertiary' }}
                    >
                      <DnsOutlinedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                );
              },
            } : undefined}
          />
        )}
      </RelationsSection>
      {after?.({ recordOnServer })}
    </>
  );
}
