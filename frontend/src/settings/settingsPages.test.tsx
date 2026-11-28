import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, matchPath } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute, { ADMIN_ROUTE_REQUIREMENTS } from '../components/ProtectedRoute';
import { ADMIN_MENU, adminMenuEntries, isInstallationPath, type AdminMenuContext } from '../pages/admin/adminMenu';
import { isReservedInLimitedAccess } from '../auth/dataAccess';
import { getDocSlug } from '../utils/docUrls';
import { customRuleNames, evaluateAccess, type AccessLevel, type AccessRule, type DeploymentMode } from './accessRule';
import { SETTINGS_PAGES, settingsPageHref, settingsPageScope, type SettingsHost, type SettingsPageEntry } from './pages';

// --- Sources read as text -------------------------------------------------------------------

const APP_SOURCE = Object.values(import.meta.glob<string>('../App.tsx', { query: '?raw', import: 'default', eager: true }))[0];
const SOURCES = import.meta.glob<string>(
  ['../pages/**/*.tsx', '../components/about/*.tsx', '!../**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
);
const LOCALES = import.meta.glob<Record<string, unknown>>('../locales/{en,fr,de,es}/*.json', { import: 'default', eager: true });
const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;

// The manual, read at run time from the repository root (same way as `locales/noDashes.test.ts`).
type NodeFs = { existsSync(path: URL): boolean; readFileSync(path: URL, encoding: 'utf8'): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): NodeFs } }).process.getBuiltinModule('node:fs');
const TEST_FILE = import.meta.url;
const MANUAL = new URL('../../../doc/help/docs/en/', TEST_FILE);
const manualFound = fs.existsSync(MANUAL);

/** `App.tsx` routes: path and the component of their element. */
const APP_ROUTES = [...APP_SOURCE.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<([A-Za-z]+)/g)].map(([, path, component]) => ({ path, component }));
/** Lazy page imports of `App.tsx`: component name to its file, relative to `frontend/src`. */
const COMPONENT_FILES: Record<string, string> = Object.fromEntries(
  [...APP_SOURCE.matchAll(/const (\w+) = React\.lazy\(\(\) => import\('\.\/([^']+)'\)\)/g)].map(([, name, file]) => [name, `${file}.tsx`]),
);

// --- Exceptions, each with its reason -------------------------------------------------------

/** Settings-like routes of `App.tsx` that have no line: redirects and record pages. */
const ROUTE_EXCLUSIONS: Record<string, string> = {
  '/admin': 'Redirects to the first administration page the person may open.',
  '/admin/all-settings': 'The list of the settings pages itself.',
  '/admin/installation': 'Redirects to the first page of the Installation section.',
  '/admin/scheduled-tasks': 'Former address of scheduled tasks, redirects to the Installation section.',
  '/admin/choose-plan': 'Redirects to billing.',
  '/admin/agent-control': 'Redirects to the agents.',
  '/admin/agent-control/*': 'Redirects to the agents.',
  '/admin/standard-accounts/:templateId/:id': 'A standard account, opened from the standard accounts list.',
  '/admin/standard-accounts/:templateId/:id/:tab': 'A standard account, opened from the standard accounts list.',
  '/admin/standard-accounts/:templateId/:id/*': 'A standard account, opened from the standard accounts list.',
  '/knowledge/settings/types': 'Redirects to the knowledge page, where the types are managed.',
};

/**
 * Lines whose route lets in someone the line refuses: the page, its menu entry or its button is
 * the stricter part. Each one is checked to still be one.
 */
const ROUTE_WIDER_THAN_OPEN: Record<string, string> = {
  'account.connected-apps': 'The route opens the account page to everyone; without the right the page shows its first tab.',
  'org.sample-data': 'The route asks the users Admin level; the menu entry and the page ask the Administrator role.',
  'platform.tenants': 'The route lets any Administrator in; the page asks the platform administrator.',
  'platform.trials': 'The route lets any Administrator in; the page asks the platform administrator.',
  'platform.coa-templates': 'The route lets any Administrator in; the page asks the platform administrator.',
  'platform.standard-accounts': 'The route lets any Administrator in; the page asks the platform administrator.',
  'platform.platform-ai': 'The route lets any Administrator in; the page asks the platform administrator.',
  'platform.ops-dashboard': 'The route lets any Administrator in; the page asks the platform administrator.',
  'agents.agent-settings': 'The link opens the agents overview; the Settings tab of an agent carries the right.',
  'contracts.decision-window': 'The link opens the contracts list; its Settings button carries the right.',
  'knowledge.types': 'The link opens the knowledge page; its Manage types button carries the right.',
};

/** Where a module menu entry or the page differs from the line, beyond the route. */
const MENU_OR_PAGE_GAPS: Record<string, string> = {
  'org.users': 'The page reads for a users reader; the route and the menu entry ask the Admin level.',
  'it.settings-lists': 'The menu entry and the route also open to an infrastructure administrator, on the Netbox tab.',
  'portfolio.settings-phase-templates': 'The tab reads its list with the portfolio projects Reader level as well: without it, the tab shows its error.',
  'portfolio.settings-teams': 'The tab reads its list with the portfolio requests Reader level as well: without it, the tab shows its error.',
  'portfolio.settings-contract-types': 'The tab reads its list with the portfolio requests Reader level as well: without it, the tab shows its error.',
};

/** Conditions kept in code, named in the lines. */
const CUSTOM_RULES: Record<string, string> = {
  aiSettingsSurface: 'The AI capabilities, loaded from the server, say whether the settings surface is available.',
  aiAgentsInstance: 'The AI capabilities say whether the instance offers the agents.',
  libraryManage: 'A right on each library record (`can_manage`).',
  billingAdmin: 'A claim of the person (`isBillingAdmin`), outside the module rights.',
};

// --- Helpers ----------------------------------------------------------------------------------

const MODES: DeploymentMode[] = ['cloud', 'onprem'];

/** Where a line is checked: each mode it exists in, on its first host there. */
function environments(entry: SettingsPageEntry): Array<{ mode: DeploymentMode; host: SettingsHost }> {
  return MODES.flatMap((mode) => {
    const hosts = entry.availability[mode] ?? ['organization'];
    return hosts === false ? [] : [{ mode, host: hosts[0] }];
  });
}

function lookup(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);
}

function keyExists(language: string, fullKey: string): boolean {
  const [namespace, key] = fullKey.split(':');
  const tree = LOCALES[`../locales/${language}/${namespace}.json`];
  if (!tree || !key) return false;
  return [key, `${key}_one`, `${key}_other`].some((candidate) => typeof lookup(tree, candidate) === 'string');
}

/** A key is used in a file when it appears whole, or when each of its segments does (keys built from a prefix). */
function keyUsedIn(source: string, fullKey: string): boolean {
  const key = fullKey.split(':')[1];
  if (source.includes(key)) return true;
  return key.split('.').every((segment) => new RegExp(`\\b${segment}\\b`).test(source));
}

function sourceFile(entry: SettingsPageEntry): string | undefined {
  return entry.source ?? COMPONENT_FILES[entry.component];
}

function headings(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => /^#{1,6}\s+(.*?)\s*(\{[^}]*\})?\s*$/.exec(line)?.[1])
    .filter((heading): heading is string => !!heading);
}

// A grant: what a test identity holds.
type Grant = {
  perms: Record<string, AccessLevel>;
  administrator: boolean;
  platformAdmin: boolean;
  limited: boolean;
  custom: Record<string, boolean>;
};
const RANK: Record<AccessLevel, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
const BELOW: Record<AccessLevel, AccessLevel | null> = { reader: null, contributor: 'reader', member: 'contributor', admin: 'member' };
const emptyGrant = (): Grant => ({ perms: {}, administrator: false, platformAdmin: false, limited: false, custom: {} });

function merge(...grants: Grant[]): Grant {
  const out = emptyGrant();
  for (const grant of grants) {
    for (const [resource, lvl] of Object.entries(grant.perms)) {
      if (!out.perms[resource] || RANK[lvl] > RANK[out.perms[resource]]) out.perms[resource] = lvl;
    }
    out.administrator ||= grant.administrator;
    out.platformAdmin ||= grant.platformAdmin;
    out.limited ||= grant.limited;
    Object.assign(out.custom, grant.custom);
  }
  return out;
}

function resourcesOf(rule: AccessRule): string[] {
  switch (rule.kind) {
    case 'level': return [rule.resource];
    case 'anyOf':
    case 'allOf': return rule.rules.flatMap(resourcesOf);
    case 'byMode': return [...resourcesOf(rule.cloud), ...resourcesOf(rule.onprem)];
    default: return [];
  }
}
/** Every module resource the registry names, and the users administration. */
const KNOWN_RESOURCES = [...new Set(['users', ...SETTINGS_PAGES.flatMap((entry) => [...resourcesOf(entry.open), ...resourcesOf(entry.change)])])];

/** One grant per way of meeting the rule. */
function satisfying(rule: AccessRule, mode: DeploymentMode): Grant[] {
  switch (rule.kind) {
    case 'signedIn':
    case 'fullDataAccess': return [emptyGrant()];
    case 'level': return [{ ...emptyGrant(), perms: { [rule.resource]: rule.level } }];
    case 'anyOf': return rule.rules.flatMap((item) => satisfying(item, mode));
    case 'allOf': return rule.rules.reduce<Grant[]>(
      (acc, item) => acc.flatMap((grant) => satisfying(item, mode).map((next) => merge(grant, next))),
      [emptyGrant()],
    );
    case 'administrator': return [{ ...emptyGrant(), administrator: true }];
    case 'platformAdmin': return [{ ...emptyGrant(), platformAdmin: true }];
    case 'custom': return [{ ...emptyGrant(), custom: { [rule.name]: true } }];
    case 'byMode': return satisfying(mode === 'onprem' ? rule.onprem : rule.cloud, mode);
  }
}

/** Grants that come closest to the rule without meeting it. */
function falling(rule: AccessRule, mode: DeploymentMode): Grant[] {
  switch (rule.kind) {
    case 'signedIn': return [];
    case 'fullDataAccess': return [{ ...emptyGrant(), limited: true }];
    case 'level': {
      const below = BELOW[rule.level];
      return [below ? { ...emptyGrant(), perms: { [rule.resource]: below } } : emptyGrant()];
    }
    case 'anyOf': return [emptyGrant()];
    case 'allOf': return rule.rules.flatMap((item, index) => {
      const others = rule.rules.filter((_, other) => other !== index).map((other) => satisfying(other, mode)[0]);
      return falling(item, mode).map((grant) => merge(grant, ...others));
    });
    case 'administrator': return [{ ...emptyGrant(), perms: Object.fromEntries(KNOWN_RESOURCES.map((resource) => [resource, 'admin' as const])) }];
    case 'platformAdmin': return [{ ...emptyGrant(), administrator: true }];
    case 'custom': return [emptyGrant()];
    case 'byMode': return falling(mode === 'onprem' ? rule.onprem : rule.cloud, mode);
  }
}

function hasLevelFor(grant: Grant) {
  return (resource: string, lvl: string) => {
    if (grant.administrator || grant.platformAdmin) return true;
    if (grant.limited && isReservedInLimitedAccess(resource, lvl)) return false;
    const held = grant.perms[resource];
    return !!held && RANK[held] >= (RANK[lvl as AccessLevel] ?? 99);
  };
}

function contextFor(grant: Grant, mode: DeploymentMode) {
  return {
    mode,
    hasLevel: hasLevelFor(grant),
    isAdministrator: grant.administrator,
    isPlatformAdmin: grant.platformAdmin,
    dataAccessLimited: grant.limited,
    custom: grant.custom,
  };
}

/** The Administration menu's context for a grant, as `Layout` builds it. */
function menuContextFor(grant: Grant, mode: DeploymentMode, host: SettingsHost): AdminMenuContext {
  const hasLevel = hasLevelFor(grant);
  const aiSettingsAvailable = !!grant.custom.aiSettingsSurface;
  return {
    singleTenant: mode === 'onprem',
    platformHost: host === 'platform',
    claims: { isGlobalAdmin: grant.administrator, isPlatformAdmin: grant.platformAdmin },
    hasLevel,
    dataAccessLimited: grant.limited,
    features: { billing: true, sso: true, sampleData: true },
    aiSettingsAvailable,
    canShowIntegrations: aiSettingsAvailable || hasLevel('infrastructure', 'admin'),
  };
}

// --- ProtectedRoute under a test identity ----------------------------------------------------

const identity = vi.hoisted(() => ({
  grant: null as null | {
    perms: Record<string, string>;
    administrator: boolean;
    platformAdmin: boolean;
    limited: boolean;
    custom: Record<string, boolean>;
  },
  hasLevel: (() => false) as (resource: string, level: string) => boolean,
  mode: 'cloud' as 'cloud' | 'onprem',
  host: 'organization' as 'organization' | 'platform',
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Member', roles: [] },
    claims: {
      isGlobalAdmin: !!identity.grant?.administrator,
      isPlatformAdmin: !!identity.grant?.platformAdmin,
      isBillingAdmin: !!identity.grant?.custom.billingAdmin,
      permissions: identity.grant?.perms ?? {},
    },
    hasLevel: identity.hasLevel,
    hasAnyAccess: true,
    dataAccess: identity.grant?.limited ? { available: true, mode: 'limited', nodes: [], modules: [] } : null,
    subscription: { status: 'active', access_allowed: true },
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: identity.host === 'platform' }) }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: {
      deploymentMode: identity.mode === 'onprem' ? 'single-tenant' : 'multi-tenant',
      features: { billing: true, sso: true, aiChat: true, aiSettings: true, aiMcp: true, sampleData: true },
    },
    isSingleTenant: identity.mode === 'onprem',
  }),
}));
vi.mock('../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({
    isLoading: false,
    isFetching: false,
    isError: false,
    data: {
      surfaces: {
        settings: { available: !!identity.grant?.custom.aiSettingsSurface },
        chat: { available: false, permission_granted: false, reasons: [] },
      },
      instance_features: { ai_settings: !!identity.grant?.custom.aiAgentsInstance },
    },
  }),
}));
vi.mock('../pages/PendingAccessPage', () => ({ default: () => null }));

function routeOpens(entry: SettingsPageEntry, grant: Grant, mode: DeploymentMode, host: SettingsHost): boolean {
  identity.grant = grant;
  identity.hasLevel = hasLevelFor(grant);
  identity.mode = mode;
  identity.host = host;
  const route = entry.tab?.in === 'path' ? `${entry.path.replace(/\/$/, '')}/:tab` : entry.path;
  render(
    <MemoryRouter initialEntries={[settingsPageHref(entry)]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path={route} element={<div>settings page</div>} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  const opened = screen.queryByText('settings page') !== null;
  cleanup();
  return opened;
}

// --- Tests --------------------------------------------------------------------------------------

describe('settings page registry', () => {
  afterEach(() => cleanup());

  it('has unique ids, one scope each and 3 to 8 setting keys', () => {
    const ids = SETTINGS_PAGES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SETTINGS_PAGES) {
      expect(!!entry.scope !== !!entry.scopeByMode, `${entry.id}: scope or scopeByMode`).toBe(true);
      expect(settingsPageScope(entry, 'cloud') === 'module', `${entry.id}: module`).toBe(!!entry.module);
      expect(entry.settingKeys.length, entry.id).toBeGreaterThanOrEqual(3);
      expect(entry.settingKeys.length, entry.id).toBeLessThanOrEqual(8);
    }
  });

  it('(a) gives every settings route of App.tsx a line or a named exclusion', () => {
    const isSettingsRoute = (path: string) => path === '/admin' || path.startsWith('/admin/') || path === '/settings'
      || path.startsWith('/settings/') || path.split('/').some((segment) => ['settings', 'operations', 'shared-context'].includes(segment));
    const covered = (path: string) => SETTINGS_PAGES.some((entry) => entry.path === path
      || (entry.tab?.in === 'path' && `${entry.path}/:tab` === path));
    const uncovered = APP_ROUTES.map((route) => route.path)
      .filter(isSettingsRoute)
      .filter((path) => !covered(path) && !(path in ROUTE_EXCLUSIONS));
    expect(uncovered, `Add a line to frontend/src/settings/pages for: ${uncovered.join(', ')}`).toEqual([]);
    const stale = Object.keys(ROUTE_EXCLUSIONS).filter((path) => !APP_ROUTES.some((route) => route.path === path));
    expect(stale).toEqual([]);
  });

  it('(b) gives every line its route, rendering the declared component', () => {
    for (const entry of SETTINGS_PAGES) {
      const route = APP_ROUTES.find((candidate) => candidate.path === entry.path);
      expect(route, `${entry.id}: no route ${entry.path}`).toBeTruthy();
      expect(route?.component, entry.id).toBe(entry.component);
      if (entry.tab?.in === 'path') {
        const tabRoute = APP_ROUTES.find((candidate) => candidate.path === `${entry.path}/:tab`);
        expect(tabRoute?.component, `${entry.id}: tab route`).toBe(entry.component);
        expect(matchPath(`${entry.path}/:tab`, settingsPageHref(entry))?.params.tab).toBe(entry.tab.value);
      }
    }
  });

  it('(c) names keys that exist in the four languages and settings used in the page file', () => {
    const missing: string[] = [];
    const unused: string[] = [];
    for (const entry of SETTINGS_PAGES) {
      const keys = [entry.labelKey, ...entry.menuKeys, ...entry.settingKeys];
      for (const language of LANGUAGES) {
        for (const key of keys) if (!keyExists(language, key)) missing.push(`${entry.id} ${language} ${key}`);
      }
      const file = sourceFile(entry);
      const source = file ? SOURCES[`../${file}`] : undefined;
      expect(source, `${entry.id}: no source file (${file})`).toBeTruthy();
      for (const key of entry.settingKeys) if (source && !keyUsedIn(source, key)) unused.push(`${entry.id} ${key} in ${file}`);
    }
    expect(missing).toEqual([]);
    expect(unused).toEqual([]);
  });

  it.skipIf(!manualFound)('(d) points at the manual page the Help button opens, and at one of its headings', () => {
    for (const entry of SETTINGS_PAGES) {
      const href = settingsPageHref(entry);
      const [pathname, query] = href.split('?');
      expect(getDocSlug(pathname, query ? `?${query}` : ''), entry.id).toBe(entry.doc.page);
      if (entry.doc.page === null) {
        expect(entry.doc.reason.length, entry.id).toBeGreaterThan(0);
        continue;
      }
      const file = new URL(`${entry.doc.page}.md`, MANUAL);
      expect(fs.existsSync(file), `${entry.id}: ${file.pathname}`).toBe(true);
      if (entry.doc.section) {
        expect(headings(fs.readFileSync(file, 'utf8')), entry.id).toContain(entry.doc.section);
      }
    }
  });

  it('names every condition kept in code', () => {
    const used = new Set(SETTINGS_PAGES.flatMap((entry) => [...customRuleNames(entry.open), ...customRuleNames(entry.change)]));
    expect([...used].sort()).toEqual(Object.keys(CUSTOM_RULES).sort());
  });

  it('keeps its exceptions on existing lines', () => {
    const ids = new Set(SETTINGS_PAGES.map((entry) => entry.id));
    for (const id of [...Object.keys(ROUTE_WIDER_THAN_OPEN), ...Object.keys(MENU_OR_PAGE_GAPS)]) expect(ids.has(id), id).toBe(true);
  });

  it('(e) lets the route open with the right to open, and refuse just below it', () => {
    const problems: string[] = [];
    const wider = new Set<string>();
    for (const entry of SETTINGS_PAGES) {
      for (const { mode, host } of environments(entry)) {
        for (const grant of satisfying(entry.open, mode)) {
          expect(evaluateAccess(entry.open, contextFor(grant, mode)), `${entry.id} ${mode}`).toBe(true);
          if (!routeOpens(entry, grant, mode, host)) problems.push(`${entry.id} (${mode}): refused with ${JSON.stringify(grant)}`);
        }
        // A grant built below one part may still meet the rule through another (an Admin level
        // that implies a reader one): only those that fail the rule count.
        const below = falling(entry.open, mode).filter((grant) => !evaluateAccess(entry.open, contextFor(grant, mode)));
        if (entry.open.kind !== 'signedIn') expect(below.length, `${entry.id} ${mode}: nothing below`).toBeGreaterThan(0);
        for (const grant of below) {
          if (routeOpens(entry, grant, mode, host)) {
            wider.add(entry.id);
            if (!(entry.id in ROUTE_WIDER_THAN_OPEN)) problems.push(`${entry.id} (${mode}): opened with ${JSON.stringify(grant)}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect([...wider].sort()).toEqual(Object.keys(ROUTE_WIDER_THAN_OPEN).sort());
  });

  it('(f) gives every Administration line its entry of the Administration menu, shown as the line says', () => {
    const problems: string[] = [];
    const lines = SETTINGS_PAGES.filter((entry) => MODES.some((mode) => ['organization', 'installation'].includes(settingsPageScope(entry, mode))));
    expect(lines.length).toBeGreaterThan(0);
    for (const entry of lines) {
      const item = ADMIN_MENU.find((candidate) => candidate.to === entry.path);
      expect(item, `${entry.id}: no entry ${entry.path} in pages/admin/adminMenu.ts`).toBeTruthy();
      if (!item) continue;
      // The route names the same requirement in ADMIN_ROUTE_REQUIREMENTS, except the pages guarded
      // by their own branch of ProtectedRoute: the AI settings, the integrations, the Installation section.
      const declared = ADMIN_ROUTE_REQUIREMENTS[entry.path.split('/')[2]];
      if (item.requires === 'aiSettings' || item.requires === 'integrations') expect(declared, entry.id).toBeUndefined();
      else if (item.requires === 'operator') expect(isInstallationPath(entry.path), entry.id).toBe(true);
      else expect(declared, `${entry.id}: no line in ADMIN_ROUTE_REQUIREMENTS`).toBeDefined();
      // The menu shows the entry to exactly the people the line lets open the page.
      for (const { mode, host } of environments(entry)) {
        for (const grant of [...satisfying(entry.open, mode), ...falling(entry.open, mode)]) {
          const expected = evaluateAccess(entry.open, contextFor(grant, mode));
          const shown = adminMenuEntries(menuContextFor(grant, mode, host)).some((candidate) => candidate.to === entry.path);
          if (shown !== expected) problems.push(`${entry.id} (${mode}): menu ${shown ? 'shows' : 'hides'} it with ${JSON.stringify(grant)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
