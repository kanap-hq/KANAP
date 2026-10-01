import React from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { KanapDialog } from '../../components/design';
import { type IntegratedDocumentEditorHandle } from '../../components/IntegratedDocumentEditor';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import InterfaceBindingsMatrix from './components/InterfaceBindingsMatrix';
import type {
  InterfaceCompany,
  InterfaceDataResidency,
  InterfaceDependency,
  InterfaceDetail,
  InterfaceKeyIdentifier,
  InterfaceLeg,
  InterfaceLink,
  InterfaceOwner,
} from './components/interface-workspace/types';
import PortfolioDetailWorkspaceShell, {
  type PortfolioDetailWorkspaceTab,
} from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import InterfaceFlowTab from './workspace/InterfaceFlowTab';
import InterfaceMappingTab, { type InterfaceMappingTabHandle } from './workspace/InterfaceMappingTab';
import InterfaceMetadataBar from './workspace/InterfaceMetadataBar';
import InterfaceOverviewTab from './workspace/InterfaceOverviewTab';
import InterfacePropertyPanel from './workspace/InterfacePropertyPanel';
import InterfaceRelationsTab from './workspace/InterfaceRelationsTab';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useInterfaceItemNav } from '../../hooks/useModuleItemNav';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';

type WorkspaceTabKey = 'overview' | 'flow' | 'environments' | 'data-mapping' | 'relations';
type LegacyTabKey = 'specification' | 'mapping' | 'technical' | 'functional' | 'ownership' | 'compliance';
type RouteTabKey = WorkspaceTabKey | LegacyTabKey;

const WORKSPACE_TABS = new Set<WorkspaceTabKey>([
  'overview',
  'flow',
  'environments',
  'data-mapping',
  'relations',
]);

const LEGACY_ROUTE_MAP: Record<LegacyTabKey, WorkspaceTabKey> = {
  specification: 'overview',
  mapping: 'data-mapping',
  technical: 'flow',
  functional: 'overview',
  ownership: 'overview',
  compliance: 'overview',
};

const INTERFACE_REFERENCE_ROUTE_RE = /^INT-\d+(?:-.+)?$/i;

function normalizeUrl(raw: string) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createInitialForm(): Partial<InterfaceDetail> {
  return {
    interface_id: '',
    name: '',
    specification_markdown: '',
    business_process_id: null,
    business_purpose: '',
    source_application_id: '',
    target_application_id: '',
    data_category: '',
    integration_route_type: 'direct',
    lifecycle: 'active',
    overview_notes: null,
    criticality: '',
    impact_of_failure: null,
    business_objects: null,
    main_use_cases: null,
    functional_rules: null,
    core_transformations_summary: null,
    error_handling_summary: null,
    data_class: '',
    contains_pii: false,
    pii_description: null,
    typical_data: null,
    audit_logging: null,
    security_controls_summary: null,
    middleware_application_ids: [],
    owners: [],
    companies: [],
    dependencies: [],
    key_identifiers: [],
    data_residency: [],
    links: [],
    attachments: [],
    legs: [],
  };
}

function buildCreatePayload(current: Partial<InterfaceDetail>) {
  return {
    interface_id: String(current.interface_id || '').trim() || null,
    name: String(current.name || '').trim(),
    specification_markdown: String(current.specification_markdown || '').trim() || null,
    business_process_id: current.business_process_id || null,
    business_purpose: String(current.business_purpose || current.name || '').trim(),
    source_application_id: current.source_application_id,
    target_application_id: current.target_application_id,
    data_category: current.data_category,
    integration_route_type: current.integration_route_type || 'direct',
    lifecycle: current.lifecycle || 'active',
    overview_notes: current.overview_notes ?? null,
    criticality: current.criticality || null,
    impact_of_failure: current.impact_of_failure ?? null,
    business_objects: current.business_objects ?? null,
    main_use_cases: current.main_use_cases ?? null,
    functional_rules: current.functional_rules ?? null,
    core_transformations_summary: current.core_transformations_summary ?? null,
    error_handling_summary: current.error_handling_summary ?? null,
    data_class: current.data_class || null,
    contains_pii: !!current.contains_pii,
    pii_description: current.pii_description ?? null,
    typical_data: current.typical_data ?? null,
    audit_logging: current.audit_logging ?? null,
    security_controls_summary: current.security_controls_summary ?? null,
    middleware_application_ids: (current.middleware_application_ids || []) as string[],
  };
}

export default function InterfaceWorkspacePage() {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addToRecent } = useRecentlyViewed();

  const canManage = hasLevel('applications', 'member');
  const idParam = String(params.id || '');
  const isCreate = idParam === 'new';
  const id = idParam;
  const isInterfaceReferenceRoute = INTERFACE_REFERENCE_ROUTE_RE.test(idParam);
  const rawRouteTab = (params.tab as RouteTabKey | undefined) || 'overview';
  const routeTab: WorkspaceTabKey = WORKSPACE_TABS.has(rawRouteTab as WorkspaceTabKey)
    ? rawRouteTab as WorkspaceTabKey
    : LEGACY_ROUTE_MAP[rawRouteTab as LegacyTabKey] || 'overview';

  const [createForm, setCreateForm] = React.useState<Partial<InterfaceDetail>>(createInitialForm);
  const [data, setData] = React.useState<InterfaceDetail | null>(null);
  const dataRef = React.useRef<InterfaceDetail | null>(null);
  const specificationEditorRef = React.useRef<IntegratedDocumentEditorHandle>(null);
  const mappingEditorRef = React.useRef<InterfaceMappingTabHandle>(null);
  const [createDirty, setCreateDirty] = React.useState(false);
  const [mappingDirty, setMappingDirty] = React.useState(false);
  const [mappingActivated, setMappingActivated] = React.useState(() => rawRouteTab === 'data-mapping' || rawRouteTab === 'mapping');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [createSubmitting, setCreateSubmitting] = React.useState(false);
  const [discardCreateOpen, setDiscardCreateOpen] = React.useState(false);

  React.useEffect(() => {
    if (routeTab === 'data-mapping') {
      setMappingActivated(true);
    }
  }, [routeTab]);

  const replaceCurrent = React.useCallback((next: Partial<InterfaceDetail> | InterfaceDetail | null) => {
    if (isCreate) {
      setCreateForm((next || createInitialForm()) as Partial<InterfaceDetail>);
      return;
    }
    dataRef.current = (next || null) as InterfaceDetail | null;
    setData((next || null) as InterfaceDetail | null);
  }, [isCreate]);

  const applyLocalUpdater = React.useCallback((
    updater: (prev: Partial<InterfaceDetail>) => Partial<InterfaceDetail>,
    options?: { markCreateDirty?: boolean },
  ) => {
    if (isCreate) {
      setCreateForm((prev) => updater((prev || {}) as Partial<InterfaceDetail>));
      if (options?.markCreateDirty) {
        setCreateDirty(true);
      }
      return;
    }
    const base = (dataRef.current || data || {}) as Partial<InterfaceDetail>;
    const next = updater(base);
    dataRef.current = next as InterfaceDetail;
    setData(next as InterfaceDetail);
  }, [data, isCreate]);

  const applyLocalPatch = React.useCallback((
    patch: Partial<InterfaceDetail>,
    options?: { markCreateDirty?: boolean },
  ) => {
    applyLocalUpdater((prev) => ({ ...prev, ...patch }), options);
  }, [applyLocalUpdater]);

  const getCurrentState = React.useCallback(() => (
    (isCreate ? createForm : (dataRef.current || data || {})) as Partial<InterfaceDetail>
  ), [createForm, data, isCreate]);

  const current = (isCreate ? createForm : data) as InterfaceDetail | null;
  const interfaceApiId = !isCreate ? (current?.id || (!isInterfaceReferenceRoute ? idParam : '')) : '';
  const workspaceRouteId = current?.interface_reference || (isCreate ? 'new' : idParam);
  const navSort = searchParams.get('sort') || null;
  const navQ = searchParams.get('q') || null;
  const navFilters = searchParams.get('filters') || null;
  const nav = useInterfaceItemNav({
    id: interfaceApiId,
    sort: navSort,
    q: navQ,
    filters: navFilters,
  });
  const routeMatchesLoadedInterface = React.useMemo(() => {
    if (isCreate || !data) return false;
    if (idParam === data.id) return true;
    const routeKey = idParam.toUpperCase();
    const reference = data.interface_reference?.toUpperCase();
    const legacyCode = data.interface_id?.toUpperCase();
    return (!!reference && (routeKey === reference || routeKey.startsWith(`${reference}-`)))
      || (!!legacyCode && routeKey === legacyCode);
  }, [data, idParam, isCreate]);
  const routeEntityKey = routeMatchesLoadedInterface && data?.id ? data.id : idParam;

  React.useEffect(() => {
    setMappingDirty(false);
    setMappingActivated(rawRouteTab === 'data-mapping' || rawRouteTab === 'mapping');
  }, [rawRouteTab, routeEntityKey]);

  const load = React.useCallback(async () => {
    if (isCreate) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<InterfaceDetail>(`/interfaces/${id}`, {
        params: { include: 'relations,legs' },
      });
      setData(response.data);
      dataRef.current = response.data;
    } catch (loadError: any) {
      setError(getApiErrorMessage(loadError, t, t('messages.loadInterfaceFailed')));
      setData(null);
      dataRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [id, isCreate, t]);

  React.useEffect(() => {
    if (!params.tab) {
      navigate(`/it/interfaces/${workspaceRouteId}/overview`, { replace: true });
      return;
    }

    const legacyRoute = !WORKSPACE_TABS.has(rawRouteTab as WorkspaceTabKey)
      ? LEGACY_ROUTE_MAP[rawRouteTab as LegacyTabKey]
      : null;
    if (legacyRoute) {
      navigate(`/it/interfaces/${workspaceRouteId}/${legacyRoute}`, { replace: true });
      return;
    }

    if (!WORKSPACE_TABS.has(rawRouteTab as WorkspaceTabKey)) {
      navigate(`/it/interfaces/${workspaceRouteId}/overview`, { replace: true });
      return;
    }

    if (isCreate && rawRouteTab !== 'overview') {
      navigate(`/it/interfaces/${workspaceRouteId}/overview`, { replace: true });
    }
  }, [isCreate, navigate, params.tab, rawRouteTab, workspaceRouteId]);

  React.useEffect(() => {
    if (isCreate || routeMatchesLoadedInterface) return;
    void load();
  }, [isCreate, load, routeMatchesLoadedInterface]);

  React.useEffect(() => {
    if (isCreate || !data?.interface_reference) return;
    if (!routeMatchesLoadedInterface) return;
    if (idParam.toUpperCase() === data.interface_reference.toUpperCase()) return;
    const qs = searchParams.toString();
    window.history.replaceState(null, '', `/it/interfaces/${data.interface_reference}/${routeTab}${qs ? `?${qs}` : ''}`);
  }, [data?.interface_reference, idParam, isCreate, navigate, routeMatchesLoadedInterface, routeTab, searchParams]);

  React.useEffect(() => {
    if (data?.id && data?.name) {
      addToRecent('interface', data.interface_reference || data.id, data.name);
    }
  }, [addToRecent, data?.id, data?.interface_reference, data?.name]);

  const persistPatch = React.useCallback(async (patch: Partial<InterfaceDetail>) => {
    if (isCreate) {
      applyLocalPatch(patch, { markCreateDirty: true });
      return;
    }
    if (!canManage) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }
    if (!interfaceApiId) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }

    const previous = cloneState(getCurrentState());
    applyLocalPatch(patch);

    try {
      await api.patch(`/interfaces/${interfaceApiId}`, patch);
      const needsDetailRefresh = ['integration_route_type', 'source_application_id', 'target_application_id', 'business_process_id']
        .some((key) => Object.prototype.hasOwnProperty.call(patch, key));
      if (needsDetailRefresh) {
        const response = await api.get<InterfaceDetail>(`/interfaces/${interfaceApiId}`, { params: { include: 'relations,legs' } });
        replaceCurrent(response.data);
      }
    } catch (panelError) {
      replaceCurrent(previous);
      throw panelError;
    }
  }, [applyLocalPatch, canManage, getCurrentState, interfaceApiId, isCreate, replaceCurrent, t]);

  const persistOwners = React.useCallback(async (ownerType: 'business' | 'it', userIds: string[]) => {
    const current = getCurrentState();
    const otherOwners = ((current.owners || []) as InterfaceOwner[]).filter((owner) => owner.owner_type !== ownerType);
    const nextOwners: InterfaceOwner[] = [
      ...otherOwners,
      ...Array.from(new Set(userIds.filter(Boolean))).map((userId) => ({ owner_type: ownerType, user_id: userId })),
    ];

    if (isCreate) {
      applyLocalPatch({ owners: nextOwners }, { markCreateDirty: true });
      return;
    }
    if (!canManage) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }
    if (!interfaceApiId) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }

    const previous = cloneState(current);
    applyLocalPatch({ owners: nextOwners });
    try {
      const payload = nextOwners
        .filter((owner) => owner.user_id)
        .map((owner) => ({ user_id: owner.user_id, owner_type: owner.owner_type }));
      await api.post(`/interfaces/${interfaceApiId}/owners/bulk-replace`, { owners: payload });
    } catch (panelError) {
      replaceCurrent(previous);
      throw panelError;
    }
  }, [applyLocalPatch, canManage, getCurrentState, interfaceApiId, isCreate, replaceCurrent, t]);

  const persistCompanies = React.useCallback(async (companyIds: string[]) => {
    const uniqueIds = Array.from(new Set(companyIds.filter(Boolean)));
    const nextRows: InterfaceCompany[] = uniqueIds.map((company_id) => ({ company_id }));

    if (isCreate) {
      applyLocalPatch({ companies: nextRows }, { markCreateDirty: true });
      return;
    }
    if (!canManage) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }
    if (!interfaceApiId) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }

    const previous = cloneState(getCurrentState());
    applyLocalPatch({ companies: nextRows });
    try {
      await api.post(`/interfaces/${interfaceApiId}/companies/bulk-replace`, { company_ids: uniqueIds });
    } catch (saveError) {
      replaceCurrent(previous);
      throw saveError;
    }
  }, [applyLocalPatch, canManage, getCurrentState, interfaceApiId, isCreate, replaceCurrent, t]);

  const persistDataResidency = React.useCallback(async (codes: string[]) => {
    const uniqueCodes = Array.from(new Set(
      codes.map((code) => String(code || '').trim().toUpperCase()).filter((code) => code.length === 2),
    ));
    const nextRows: InterfaceDataResidency[] = uniqueCodes.map((country_iso) => ({ country_iso }));

    if (isCreate) {
      applyLocalPatch({ data_residency: nextRows }, { markCreateDirty: true });
      return;
    }
    if (!canManage) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }
    if (!interfaceApiId) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }

    const previous = cloneState(getCurrentState());
    applyLocalPatch({ data_residency: nextRows });
    try {
      await api.post(`/interfaces/${interfaceApiId}/data-residency/bulk-replace`, { countries: uniqueCodes });
    } catch (saveError) {
      replaceCurrent(previous);
      throw saveError;
    }
  }, [applyLocalPatch, canManage, getCurrentState, interfaceApiId, isCreate, replaceCurrent, t]);

  const persistDependencies = React.useCallback(async (rows: InterfaceDependency[]) => {
    if (isCreate) {
      applyLocalPatch({ dependencies: rows }, { markCreateDirty: true });
      return;
    }
    if (!canManage) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }
    if (!interfaceApiId) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }

    const upstreamIds = rows
      .filter((item) => item.direction === 'upstream')
      .map((item) => item.related_interface_id)
      .filter(Boolean);
    const downstreamIds = rows
      .filter((item) => item.direction === 'downstream')
      .map((item) => item.related_interface_id)
      .filter(Boolean);
    const previous = cloneState(getCurrentState());
    applyLocalPatch({ dependencies: rows });
    try {
      await api.post(`/interfaces/${interfaceApiId}/dependencies/bulk-replace`, {
        upstream_ids: upstreamIds,
        downstream_ids: downstreamIds,
      });
    } catch (saveError) {
      replaceCurrent(previous);
      throw saveError;
    }
  }, [applyLocalPatch, canManage, getCurrentState, interfaceApiId, isCreate, replaceCurrent, t]);

  const persistLinks = React.useCallback(async (rows: InterfaceLink[]) => {
    const nextRows = rows
      .filter((item) => String(item.url || '').trim())
      .map((item) => ({
        kind: String(item.kind || 'functional').trim() || 'functional',
        description: String(item.description || '').trim() || null,
        url: normalizeUrl(item.url),
      }));

    if (isCreate) {
      applyLocalPatch({ links: nextRows as InterfaceLink[] }, { markCreateDirty: true });
      return;
    }
    if (!canManage) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }
    if (!interfaceApiId) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }

    const previous = cloneState(getCurrentState());
    applyLocalPatch({ links: rows });
    try {
      await api.post(`/interfaces/${interfaceApiId}/links/bulk-replace`, { links: nextRows });
    } catch (saveError) {
      replaceCurrent(previous);
      throw saveError;
    }
  }, [applyLocalPatch, canManage, getCurrentState, interfaceApiId, isCreate, replaceCurrent, t]);

  const persistLegs = React.useCallback(async (nextLegs: InterfaceLeg[]) => {
    if (isCreate) {
      applyLocalPatch({ legs: nextLegs }, { markCreateDirty: true });
      return;
    }
    if (!canManage) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }
    if (!interfaceApiId) {
      throw new Error(t('messages.saveInterfaceFailed'));
    }

    const previous = cloneState(getCurrentState());
    applyLocalPatch({ legs: nextLegs });
    try {
      const response = await api.patch<{ items: InterfaceLeg[] }>(`/interfaces/${interfaceApiId}/legs`, {
        items: nextLegs.map((leg) => ({
          id: leg.id,
          trigger_type: leg.trigger_type,
          integration_pattern: leg.integration_pattern,
          data_format: leg.data_format,
          job_name: leg.job_name,
        })),
      });
      applyLocalPatch({ legs: response.data.items || nextLegs });
    } catch (saveError) {
      replaceCurrent(previous);
      throw saveError;
    }
  }, [applyLocalPatch, canManage, getCurrentState, interfaceApiId, isCreate, replaceCurrent, t]);

  const persistAdditionalState = React.useCallback(async (interfaceId: string, current: Partial<InterfaceDetail>) => {
    const companies = Array.from(new Set(
      ((current.companies || []) as InterfaceCompany[])
        .map((item) => item.company_id)
        .filter((item) => typeof item === 'string' && item.trim() !== ''),
    ));

    const dependencies = (current.dependencies || []) as InterfaceDependency[];
    const upstreamIds = dependencies
      .filter((item) => item.direction === 'upstream')
      .map((item) => item.related_interface_id)
      .filter((item) => typeof item === 'string' && item.trim() !== '');
    const downstreamIds = dependencies
      .filter((item) => item.direction === 'downstream')
      .map((item) => item.related_interface_id)
      .filter((item) => typeof item === 'string' && item.trim() !== '');

    const keyIdentifiers = ((current.key_identifiers || []) as InterfaceKeyIdentifier[])
      .filter((item) => String(item.source_identifier || '').trim() || String(item.destination_identifier || '').trim())
      .map((item) => ({
        source_identifier: String(item.source_identifier || '').trim(),
        destination_identifier: String(item.destination_identifier || '').trim(),
        identifier_notes: String(item.identifier_notes || '').trim() || null,
      }))
      .filter((item) => item.source_identifier || item.destination_identifier);

    const countries = Array.from(new Set(
      ((current.data_residency || []) as InterfaceDataResidency[])
        .map((item) => String(item.country_iso || '').toUpperCase())
        .filter((item) => item.length === 2),
    ));

    const links = ((current.links || []) as InterfaceLink[])
      .filter((item) => String(item.url || '').trim())
      .map((item) => ({
        kind: String(item.kind || 'functional').trim() || 'functional',
        description: String(item.description || '').trim() || null,
        url: normalizeUrl(item.url),
      }));

    await Promise.all([
      api.post(`/interfaces/${interfaceId}/companies/bulk-replace`, { company_ids: companies }),
      api.post(`/interfaces/${interfaceId}/dependencies/bulk-replace`, {
        upstream_ids: upstreamIds,
        downstream_ids: downstreamIds,
      }),
      api.post(`/interfaces/${interfaceId}/key-identifiers/bulk-replace`, { items: keyIdentifiers }),
      api.post(`/interfaces/${interfaceId}/data-residency/bulk-replace`, { countries }),
      api.post(`/interfaces/${interfaceId}/links/bulk-replace`, { links }),
    ]);
  }, []);

  const handleCreate = React.useCallback(async () => {
    if (!canManage) return;
    setError(null);
    setCreateSubmitting(true);
    try {
      const current = getCurrentState();
      const payload = buildCreatePayload(current);
      if (!payload.name) {
        setError(t('messages.nameRequired'));
        return;
      }
      if (!payload.source_application_id || !payload.target_application_id) {
        setError(t('workspace.interface.create.applicationsRequired'));
        return;
      }
      if (!payload.data_category) {
        setError(t('workspace.interface.create.dataCategoryRequired'));
        return;
      }

      const response = await api.post<InterfaceDetail>('/interfaces', payload);
      const newId = (response.data as any)?.id as string | undefined;
      if (!newId) {
        setError(t('workspace.interface.create.noIdentifier'));
        return;
      }

      await persistAdditionalState(newId, current);
      setCreateDirty(false);
      navigate(`/it/interfaces/${response.data.interface_reference || newId}/overview`, { replace: true });
    } catch (saveError: any) {
      setError(getApiErrorMessage(saveError, t, t('messages.saveInterfaceFailed')));
    } finally {
      setCreateSubmitting(false);
    }
  }, [canManage, getCurrentState, navigate, persistAdditionalState, t]);

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    const sort = searchParams.get('sort');
    const q = searchParams.get('q');
    const filters = searchParams.get('filters');
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters) sp.set('filters', filters);
    return sp;
  }, [searchParams]);

  const closeWorkspace = React.useCallback(() => {
    if (isCreate && createDirty) {
      setDiscardCreateOpen(true);
      return;
    }
    const qs = listContextParams.toString();
    navigate(`/it/interfaces${qs ? `?${qs}` : ''}`);
  }, [createDirty, isCreate, listContextParams, navigate]);

  const discardCreateAndClose = React.useCallback(() => {
    setDiscardCreateOpen(false);
    const qs = listContextParams.toString();
    navigate(`/it/interfaces${qs ? `?${qs}` : ''}`);
  }, [listContextParams, navigate]);

  const handleTabChange = React.useCallback((nextTab: string) => {
    if (nextTab === routeTab) return;
    const qs = searchParams.toString();
    navigate(`/it/interfaces/${workspaceRouteId}/${nextTab}${qs ? `?${qs}` : ''}`);
  }, [navigate, routeTab, searchParams, workspaceRouteId]);

  const navigateToInterface = React.useCallback((targetId: string | null) => {
    if (!targetId) return;
    const qs = searchParams.toString();
    navigate(`/it/interfaces/${targetId}/${routeTab}${qs ? `?${qs}` : ''}`);
  }, [navigate, routeTab, searchParams]);

  const relationCount = (current?.dependencies?.length || 0) + (current?.links?.length || 0) + (current?.attachments?.length || 0);

  const tabs: PortfolioDetailWorkspaceTab[] = React.useMemo(() => [
    { key: 'overview', label: t('workspace.interface.tabs.overview') },
    { key: 'flow', label: t('workspace.interface.tabs.flow'), disabled: isCreate },
    { key: 'environments', label: t('workspace.interface.tabs.environments'), disabled: isCreate },
    { key: 'data-mapping', label: t('workspace.interface.tabs.dataMapping'), disabled: isCreate },
    { key: 'relations', label: t('workspace.interface.tabs.relations'), badge: relationCount || undefined, disabled: isCreate },
  ], [isCreate, relationCount, t]);

  const handleTitleSave = React.useCallback((next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    if (isCreate) {
      applyLocalPatch({ name: trimmed }, { markCreateDirty: true });
      return;
    }
    if (trimmed !== dataRef.current?.name) {
      void persistPatch({ name: trimmed });
    }
  }, [applyLocalPatch, isCreate, persistPatch]);

  const actions = (
    <>
      {isCreate && (
        <Button
          variant="contained"
          onClick={() => void handleCreate()}
          disabled={createSubmitting || !canManage}
          size="small"
        >
          {t('common:buttons.create')}
        </Button>
      )}
      {!isCreate && current && (
        <SendLinkButton
          itemType="interface"
          itemId={current.id}
          itemRef={current.interface_reference || null}
          itemName={current.name || t('workspace.interface.untitled')}
        />
      )}
      {!isCreate && current && (
        <Button
          variant="action"
          startIcon={<HubOutlinedIcon sx={{ fontSize: '14px !important' }} />}
          size="small"
          onClick={() => navigate(`/it/interface-map?focusInterfaceId=${current.id}`)}
        >
          {t('workspace.interface.viewInMap')}
        </Button>
      )}
      <IconButton
        aria-label={t('common:buttons.close')}
        title={t('common:buttons.close')}
        onClick={closeWorkspace}
        size="small"
      >
        <CloseIcon />
      </IconButton>
    </>
  );

  const metadata = !isCreate && current ? (
    <InterfaceMetadataBar
      lifecycle={current.lifecycle || 'active'}
      criticality={current.criticality || ''}
      classificationIncomplete={!!current.classification_incomplete}
      sourceName={current.source_application_name}
      targetName={current.target_application_name}
      routeType={current.integration_route_type || 'direct'}
      dataClass={current.data_class || ''}
      containsPii={!!current.contains_pii}
      disabled={!canManage}
      onLifecycleChange={(value) => { void persistPatch({ lifecycle: value }); }}
      onCriticalityChange={(value) => { void persistPatch({ criticality: (value || null) as InterfaceDetail['criticality'] }); }}
      onDataClassChange={(value) => { void persistPatch({ data_class: value }); }}
      onFlowClick={() => handleTabChange('flow')}
    />
  ) : undefined;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!!error && <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && !isCreate && !current && (
        <Typography sx={{ mx: 3, mt: 1, fontSize: 12, color: 'kanap.text.tertiary' }}>
          {t('workspace.interface.loading')}
        </Typography>
      )}

      <PortfolioDetailWorkspaceShell
        activeTab={routeTab}
        tabs={tabs}
        onTabChange={handleTabChange}
        drawerStorageKey="kanap.interfaces.drawerOpen"
        backLabel={t('pages.interfaces.title')}
        onBack={closeWorkspace}
        itemReference={!isCreate ? current?.interface_reference || null : null}
        onCopyReference={
          !isCreate && current?.interface_reference
            ? () => { void navigator.clipboard?.writeText(current.interface_reference); }
            : undefined
        }
        title={current?.name || ''}
        titleFallback={isCreate ? t('workspace.interface.newTitle') : t('workspace.interface.untitled')}
        canEditTitle={canManage}
        onTitleSave={handleTitleSave}
        isCreate={isCreate}
        metadata={metadata}
        actions={actions}
        nav={!isCreate && current && nav.total > 0 ? {
          currentIndex: nav.index + 1,
          totalCount: nav.total,
          hasPrev: nav.hasPrev,
          hasNext: nav.hasNext,
          onPrev: () => navigateToInterface(nav.prevId),
          onNext: () => navigateToInterface(nav.nextId),
          previousLabel: t('workspace.interface.previous'),
          nextLabel: t('workspace.interface.next'),
        } : undefined}
        onSaveShortcut={() => {
          void specificationEditorRef.current?.save();
          void mappingEditorRef.current?.save();
        }}
        properties={(
          <InterfacePropertyPanel
            canManage={canManage}
            data={current}
            isCreate={isCreate}
            onPatch={persistPatch}
            onReplaceCompanies={persistCompanies}
            onReplaceDataResidency={persistDataResidency}
            onReplaceOwners={persistOwners}
          />
        )}
      >
        {routeTab === 'overview' && (
          <InterfaceOverviewTab
            canManage={canManage}
            data={current}
            isCreate={isCreate}
            specificationEditorRef={specificationEditorRef}
            onPatch={persistPatch}
          />
        )}

        {routeTab === 'flow' && !isCreate && (
          <InterfaceFlowTab
            canManage={canManage}
            data={current}
            onPatch={persistPatch}
            onReplaceLegs={persistLegs}
          />
        )}

        {routeTab === 'environments' && (
          !isCreate && current?.source_application_id && current?.target_application_id ? (
            <InterfaceBindingsMatrix
              interfaceId={current.id}
              interfaceName={current.name}
              sourceApplicationId={current.source_application_id}
              targetApplicationId={current.target_application_id}
              sourceApplicationName={current.source_application_name}
              targetApplicationName={current.target_application_name}
              middlewareApplicationIds={(current.middleware_application_ids || []) as string[]}
              legs={(current.legs || []) as InterfaceLeg[]}
              integrationRouteType={current.integration_route_type || 'direct'}
            />
          ) : !isCreate ? (
            <Alert severity="info">{t('workspace.interface.selectSourceTarget')}</Alert>
          ) : (
            <Alert severity="info">{t('workspace.interface.environmentsAfterCreate')}</Alert>
          )
        )}

        {!isCreate && interfaceApiId && mappingActivated && (
          <Box sx={{ display: routeTab === 'data-mapping' ? 'block' : 'none' }}>
            <InterfaceMappingTab
              ref={mappingEditorRef}
              canManage={canManage}
              interfaceId={interfaceApiId}
              data={current}
              onDirtyChange={setMappingDirty}
            />
            {mappingDirty && (
              <Typography sx={{ mt: 1, fontSize: 11, color: 'kanap.text.tertiary' }}>
                {t('workspace.interface.unsavedMappingHint')}
              </Typography>
            )}
          </Box>
        )}

        {routeTab === 'relations' && !isCreate && (
          <InterfaceRelationsTab
            canManage={canManage}
            data={current}
            update={applyLocalPatch}
            markDirty={() => undefined}
            onReplaceDependencies={persistDependencies}
            onReplaceLinks={persistLinks}
          />
        )}
      </PortfolioDetailWorkspaceShell>

      <KanapDialog
        open={discardCreateOpen}
        title={t('workspace.interface.discardDialog.title')}
        onClose={() => setDiscardCreateOpen(false)}
        saveLabel={t('common:buttons.discard')}
        onSave={discardCreateAndClose}
      >
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {t('workspace.interface.discardDialog.message')}
        </Typography>
      </KanapDialog>
    </Box>
  );
}
