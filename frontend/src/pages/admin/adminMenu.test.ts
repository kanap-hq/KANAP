import { describe, expect, it } from 'vitest';
import {
  ADMIN_MENU,
  ADMIN_MENU_GROUPS,
  adminMenuEntries,
  firstAdminEntry,
  isInstallationOperator,
  isInstallationPath,
  routerPath,
  type AdminMenuContext,
} from './adminMenu';
import { ADMIN_ROUTE_REQUIREMENTS } from '../../components/ProtectedRoute';

type Grants = Record<string, 'reader' | 'member' | 'admin'>;
const rank: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

/** A context as Layout builds it: hasLevel answers as AuthContext does. */
function context(overrides: Partial<AdminMenuContext> & { grants?: Grants } = {}): AdminMenuContext {
  const { grants = {}, ...rest } = overrides;
  const claims = rest.claims ?? null;
  const singleTenant = rest.singleTenant ?? false;
  return {
    singleTenant,
    platformHost: false,
    claims,
    hasLevel: (resource, level) => {
      if (claims?.isGlobalAdmin || claims?.isPlatformAdmin) return true;
      const granted = grants[resource];
      return !!granted && rank[granted] >= rank[level];
    },
    dataAccessLimited: false,
    features: { billing: !singleTenant, sso: true, sampleData: !singleTenant },
    aiSettingsAvailable: false,
    canShowIntegrations: grants.infrastructure === 'admin',
    ...rest,
  };
}

const administrator = { isGlobalAdmin: true, isPlatformAdmin: false };
const platformAdmin = { isGlobalAdmin: true, isPlatformAdmin: true };
const paths = (ctx: AdminMenuContext) => adminMenuEntries(ctx).map((entry) => entry.to);

describe('adminMenu: the first page /admin opens, by profile of the recette', () => {
  it.each<[string, AdminMenuContext, string | null]>([
    ['Administrator, on site', context({ singleTenant: true, claims: administrator }), '/admin/users'],
    ['Administrator with a limited access, on site', context({ singleTenant: true, claims: administrator, dataAccessLimited: true }), '/admin/users'],
    ['users administrator alone, on site', context({ singleTenant: true, grants: { users: 'admin' } }), '/admin/users'],
    ['users administrator alone, in the cloud', context({ grants: { users: 'admin' } }), '/admin/users'],
    ['IT landscape reader, on site', context({ singleTenant: true, grants: { applications: 'reader', infrastructure: 'reader' } }), null],
    ['Administrator of a cloud workspace', context({ claims: administrator }), '/admin/users'],
    ['infrastructure administrator alone, in the cloud', context({ grants: { infrastructure: 'admin' } }), '/admin/integrations'],
    ['billing reader alone, in the cloud', context({ grants: { billing: 'reader' } }), '/admin/billing'],
    ['billing reader alone, on site', context({ singleTenant: true, grants: { billing: 'reader' } }), null],
    ['AI settings administrator', context({ grants: { ai_settings: 'admin' }, aiSettingsAvailable: true }), '/admin/ai-models'],
    ['platform administrator, platform host', context({ platformHost: true, claims: platformAdmin }), '/admin/tenants'],
  ])('%s', (_profile, ctx, expected) => {
    expect(firstAdminEntry(ctx)?.to ?? null).toBe(expected);
  });

  it('opens the first page of a group when one is asked', () => {
    expect(firstAdminEntry(context({ singleTenant: true, claims: administrator }), 'installation')?.to)
      .toBe('/admin/installation/scheduled-tasks');
    expect(firstAdminEntry(context({ singleTenant: true, grants: { users: 'admin' } }), 'installation')).toBeNull();
  });
});

describe('adminMenu: the Installation section', () => {
  const installation = ADMIN_MENU.filter((entry) => entry.group === 'installation').map((entry) => entry.to);

  it('ends the menu of the Administrator on site, before All settings', () => {
    const shown = paths(context({ singleTenant: true, claims: administrator }));
    expect(shown.slice(-installation.length - 1, -1)).toEqual(installation);
    expect(shown).toContain('/admin/data-access');
  });

  it('is absent for a limited Administrator on site, with the data access administration', () => {
    const shown = paths(context({ singleTenant: true, claims: administrator, dataAccessLimited: true }));
    expect(shown).not.toContain('/admin/installation/scheduled-tasks');
    expect(shown).not.toContain('/admin/data-access');
    expect(shown).toContain('/admin/users');
  });

  it('is absent for a users administrator on site', () => {
    expect(paths(context({ singleTenant: true, grants: { users: 'admin' } }))).not.toContain('/admin/installation/scheduled-tasks');
  });

  it('is absent on a workspace host of the cloud, even for its Administrator', () => {
    const shown = paths(context({ claims: administrator }));
    expect(shown.some(isInstallationPath)).toBe(false);
  });

  it('comes after Platform AI and the Ops dashboard on the platform host, for the platform administrator', () => {
    const shown = paths(context({ platformHost: true, claims: platformAdmin }));
    expect(shown).toEqual([
      '/admin/tenants', '/admin/trials', '/admin/coa-templates', '/admin/standard-accounts',
      '/admin/platform-ai', '/admin/ops-dashboard',
      ...installation,
    ]);
  });

  it('is absent on the platform host for an Administrator who is not a platform administrator', () => {
    const shown = paths(context({ platformHost: true, claims: administrator }));
    expect(shown).toContain('/admin/tenants');
    expect(shown.some(isInstallationPath)).toBe(false);
  });
});

describe('adminMenu: the person who runs the installation', () => {
  it.each<[string, Parameters<typeof isInstallationOperator>[0], boolean]>([
    ['site, Administrator', { singleTenant: true, platformHost: false, claims: administrator, dataAccessLimited: false }, true],
    ['site, Administrator with a limited access', { singleTenant: true, platformHost: false, claims: administrator, dataAccessLimited: true }, false],
    ['site, no Administrator role', { singleTenant: true, platformHost: false, claims: { isGlobalAdmin: false }, dataAccessLimited: false }, false],
    ['cloud workspace, Administrator', { singleTenant: false, platformHost: false, claims: administrator, dataAccessLimited: false }, false],
    ['cloud workspace, platform administrator claim', { singleTenant: false, platformHost: false, claims: platformAdmin, dataAccessLimited: false }, false],
    ['platform host, platform administrator', { singleTenant: false, platformHost: true, claims: platformAdmin, dataAccessLimited: false }, true],
    ['platform host, Administrator of the platform workspace', { singleTenant: false, platformHost: true, claims: administrator, dataAccessLimited: false }, false],
  ])('%s', (_case, ctx, expected) => {
    expect(isInstallationOperator(ctx)).toBe(expected);
  });

  it.each([
    ['/admin/installation', true],
    ['/admin/installation/scheduled-tasks', true],
    ['/admin/scheduled-tasks', true],
    ['/admin/Installation/scheduled-tasks', true],
    ['/admin/%69nstallation/scheduled-tasks', true],
    ['/ADMIN/SCHEDULED-TASKS', true],
    ['/admin/%E0%A4%A', false],
    ['/admin/%2569nstallation/scheduled-tasks', false],
    ['/admin/installation%2Fscheduled-tasks', false],
    ['/admin/installations', false],
    ['/admin/users', false],
  ])('treats %s, read as the router reads it, as an installation address: %s', (path, expected) => {
    expect(isInstallationPath(routerPath(path))).toBe(expected);
  });

  it.each([
    ['/ADMIN/%75sers', '/admin/users'],
    ['/admin/installation%2Fscheduled-tasks', '/admin/installation%2fscheduled-tasks'],
    ['/admin/%2569nstallation', '/admin/%69nstallation'],
    ['/admin/%E0%A4%A', '/admin/%e0%a4%a'],
    ['//admin//users/', '//admin//users/'],
  ])('reads %s as the router does: %s', (path, expected) => {
    expect(routerPath(path)).toBe(expected);
  });
});

describe('adminMenu: flags', () => {
  it('hides Billing while billing is off', () => {
    const ctx = context({ claims: administrator });
    expect(paths({ ...ctx, features: { ...ctx.features, billing: false } })).not.toContain('/admin/billing');
    expect(paths(ctx)).toContain('/admin/billing');
  });

  it('hides Authentication while single sign-on is off', () => {
    const ctx = context({ claims: administrator });
    expect(paths({ ...ctx, features: { ...ctx.features, sso: false } })).not.toContain('/admin/auth');
  });

  it('shows Sample data after Branding to the Administrator of a cloud workspace only', () => {
    const shown = paths(context({ claims: administrator }));
    expect(shown.indexOf('/admin/sample-data')).toBe(shown.indexOf('/admin/branding') + 1);
    expect(paths(context({ grants: { users: 'admin' } }))).not.toContain('/admin/sample-data');
    const site = context({ singleTenant: true, claims: administrator });
    expect(paths({ ...site, features: { ...site.features, sampleData: true } })).not.toContain('/admin/sample-data');
  });

  it('shows the AI pages only while the AI settings are available', () => {
    const ai = ['/admin/ai-models', '/admin/ai', '/admin/ai-usage'];
    expect(paths(context({ claims: administrator }))).toEqual(expect.not.arrayContaining(ai));
    expect(paths(context({ claims: administrator, aiSettingsAvailable: true }))).toEqual(expect.arrayContaining(ai));
  });

  it('shows Integrations when the context allows it', () => {
    expect(paths(context({ grants: { users: 'admin' } }))).not.toContain('/admin/integrations');
    expect(paths(context({ grants: { users: 'admin' }, canShowIntegrations: true }))).toContain('/admin/integrations');
  });
});

describe('adminMenu: the menu and the route guard name the same requirement', () => {
  const segment = (to: string) => to.split('/')[2];

  it.each(ADMIN_MENU.map((entry) => [entry.to, entry] as const))('%s', (to, entry) => {
    const route = ADMIN_ROUTE_REQUIREMENTS[segment(to)];
    switch (entry.requires) {
      case 'operator':
        // One guard for the whole section, and no line of its own.
        expect(isInstallationPath(to)).toBe(true);
        expect(route).toBeUndefined();
        break;
      case 'administrator':
        // The route asks for the users administration; the page checks the role itself.
        expect(route).toEqual({ resource: 'users', level: 'admin' });
        break;
      case 'aiSettings':
      case 'integrations':
        // Guarded by their own branch of ProtectedRoute, not by the table:
        // `ProtectedRoute.adminBranches.test.tsx` opens them as the menu shows them.
        expect(route).toBeUndefined();
        break;
      case 'signedIn':
        // Open to every signed-in person: the route says the same.
        expect(route).toBe('signedIn');
        break;
      case 'none':
        // Pages of the platform host, without a line of their own: the route asks for the segment as a resource.
        expect(ADMIN_MENU_GROUPS[entry.group].places).toEqual(['platform']);
        expect(route).toBeUndefined();
        break;
      default:
        expect(route).toEqual(entry.requires);
    }
  });

  it('keeps one line per address and only installation pages under /admin/installation/', () => {
    const all = ADMIN_MENU.map((entry) => entry.to);
    expect(new Set(all).size).toBe(all.length);
    for (const entry of ADMIN_MENU) {
      expect(isInstallationPath(entry.to)).toBe(entry.group === 'installation');
      expect(entry.requires === 'operator').toBe(entry.group === 'installation');
    }
  });
});

describe('adminMenu: All settings, the closing entry that does not count for the menu', () => {
  const allSettings = ADMIN_MENU.find((entry) => entry.to === '/admin/all-settings');

  it('is declared once, open to every signed-in person, under a plain divider', () => {
    expect(allSettings).toMatchObject({ group: 'allSettings', requires: 'signedIn', standalone: true });
    expect(ADMIN_MENU_GROUPS.allSettings).toEqual({ places: ['organization', 'site'], title: '', last: true });
  });

  it('comes after every other entry, the Installation section included', () => {
    const shown = paths(context({ singleTenant: true, claims: administrator }));
    expect(shown[shown.length - 1]).toBe('/admin/all-settings');
    expect(shown[shown.length - 2]).toBe('/admin/installation/scheduled-tasks');
    expect(paths(context({ claims: administrator })).slice(-1)).toEqual(['/admin/all-settings']);
  });

  it('shows beside another entry the person sees', () => {
    expect(paths(context({ grants: { users: 'admin' } })).slice(-1)).toEqual(['/admin/all-settings']);
    expect(paths(context({ grants: { billing: 'reader' } }))).toEqual(['/admin/billing', '/admin/all-settings']);
  });

  it('is absent alone: no menu, and /admin opens nothing', () => {
    for (const ctx of [context({ grants: { budget: 'reader' } }), context({ singleTenant: true, grants: { budget: 'reader' } })]) {
      expect(adminMenuEntries(ctx)).toEqual([]);
      expect(firstAdminEntry(ctx)).toBeNull();
    }
  });

  it('is ignored by the first entry, even in its own group', () => {
    const ctx = context({ claims: administrator });
    expect(firstAdminEntry(ctx)?.to).toBe('/admin/users');
    expect(firstAdminEntry(ctx, 'allSettings')).toBeNull();
  });

  it('never shows on the platform host', () => {
    expect(paths(context({ platformHost: true, claims: platformAdmin }))).not.toContain('/admin/all-settings');
    expect(paths(context({ platformHost: true, claims: administrator }))).not.toContain('/admin/all-settings');
  });
});
