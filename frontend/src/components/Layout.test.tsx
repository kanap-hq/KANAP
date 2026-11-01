import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout';
import { registerLeaveGuard } from '../hooks/leaveGuard';

vi.mock('react-i18next', async () => {
  // One stable `t`: keys render as themselves.
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

// Every right by default; a test may narrow it to a level per resource.
type Level = 'reader' | 'member' | 'admin';
const access = vi.hoisted(() => ({
  grants: null as Record<string, 'reader' | 'member' | 'admin'> | null,
  rank: { reader: 1, member: 3, admin: 4 } as Record<string, number>,
  isGlobalAdmin: false,
  deploymentMode: 'multi-tenant' as 'multi-tenant' | 'single-tenant',
  sampleData: false,
  version: 'unknown',
  aiChat: false,
  aiData: undefined as unknown,
  vulnerabilityFeed: false,
  profile: { first_name: 'Ada' as string | null, last_name: 'Lovelace' as string | null, email: 'ada@example.com' as string | null },
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    logout: vi.fn(),
    token: 'token',
    hasLevel: (resource: string, level: Level) => {
      if (access.grants === null) return true;
      const granted = access.grants[resource];
      return !!granted && access.rank[granted] >= access.rank[level];
    },
    claims: { isGlobalAdmin: access.isGlobalAdmin, isPlatformAdmin: false, isBillingAdmin: false },
    profile: access.profile,
    // A trial in progress: the subscription banner shows.
    subscription: { status: 'trialing', is_subscription_healthy: false, trial_days_remaining: 5 },
  }),
}));

vi.mock('../tenant/TenantContext', () => ({
  useTenant: () => ({ isPlatformHost: false, tenantName: 'Acme', logoUrl: null, useLogoInDark: false }),
}));

vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: {
      deploymentMode: access.deploymentMode,
      features: { billing: true, aiChat: access.aiChat, aiSettings: false, sso: false, email: false, sampleData: access.sampleData, vulnerabilityFeed: access.vulnerabilityFeed },
      version: access.version,
    },
    isLoading: false,
  }),
}));

vi.mock('../config/ThemeContext', () => ({
  useThemeMode: () => ({ mode: 'light', resolvedMode: 'light', setMode: vi.fn() }),
}));

vi.mock('../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({ data: access.aiData, isLoading: false, isFetching: false }),
}));

vi.mock('../ai/aiApi', () => ({
  aiAgentControlApi: { getBadges: vi.fn().mockResolvedValue({ pendingApprovals: 0 }) },
}));

// The dialog itself is covered by its own test; here only the menu entry that opens it.
vi.mock('./about/AboutDialog', () => ({ default: ({ open }: { open: boolean }) => (open ? <div role="dialog">about-dialog</div> : null) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

const applicationVisibility = vi.hoisted(() => ({
  isLoading: false,
  hasScopedApplicationReaderAccess: false,
  shouldHideApplications: false,
}));
vi.mock('../hooks/useBusinessContributorApplicationVisibility', () => ({
  useBusinessContributorApplicationVisibility: () => applicationVisibility,
}));

function shell(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ops/opex']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/ops/opex" element={<div data-testid="page"><Link to="/ops/opex/1">open item</Link></div>} />
            <Route
              path="/ops/opex/:id"
              element={<div><div data-testid="column" data-primary-scroll="" tabIndex={-1}>content</div></div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(shell(client));
  return { ...view, rerenderShell: () => view.rerender(shell(client)) };
}

describe('Layout page scroller', () => {
  it('renders the page inside the bounded scroller, not directly in <main>', () => {
    const { container } = renderShell();
    const main = container.querySelector('main');
    const scroller = container.querySelector('.kanap-app-scroll');

    expect(main).toHaveClass('kanap-app-main');
    expect(scroller).not.toBeNull();
    expect(main).toContainElement(scroller as HTMLElement);
    expect(scroller).toContainElement(screen.getByTestId('page'));
  });

  it('keeps the subscription banner above the scroller so a full-height page still fits', () => {
    const { container } = renderShell();
    const main = container.querySelector('main') as HTMLElement;
    const scroller = container.querySelector('.kanap-app-scroll') as HTMLElement;
    const banner = screen.getByRole('alert');

    expect(main).toContainElement(banner);
    expect(scroller).not.toContainElement(banner);
    // Banner first, scroller after it.
    expect(banner.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('bounds <main> to the viewport and lets only the scroller scroll', () => {
    const { container } = renderShell();
    const main = container.querySelector('main') as HTMLElement;
    const scroller = container.querySelector('.kanap-app-scroll') as HTMLElement;

    expect(getComputedStyle(main).overflow).toBe('hidden');
    expect(getComputedStyle(scroller).overflow).toBe('auto');
    expect(getComputedStyle(scroller).minHeight).toBe('0px');
  });

  it('never shrinks a page below its content, so ordinary pages scroll instead of clipping', () => {
    renderShell();
    expect(getComputedStyle(screen.getByTestId('page')).flexShrink).toBe('0');
  });

  it('after a navigation, starts at the top and focuses the workspace content column', () => {
    const { container } = renderShell();
    const scroller = container.querySelector('.kanap-app-scroll') as HTMLElement;
    expect(scroller).toHaveAttribute('tabindex', '-1');
    // A plain page: the app scroller takes keyboard focus.
    expect(document.activeElement).toBe(scroller);

    scroller.scrollTop = 300;
    const link = screen.getByRole('link', { name: 'open item' });
    link.focus();
    fireEvent.click(link);

    expect(scroller.scrollTop).toBe(0);
    expect(document.activeElement).toBe(screen.getByTestId('column'));
  });
});

describe('Layout links and a page with unsaved edits (lot 3C review)', () => {
  it('a link of the app asks the page first: stay keeps it, leave follows the link', async () => {
    const leave = vi.fn(async () => false);
    const unregister = registerLeaveGuard({ isBusy: () => true, leave });
    try {
      renderShell();
      const link = screen.getByRole('link', { name: 'open item' });
      fireEvent.click(link);
      await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('page')).toBeInTheDocument();

      leave.mockResolvedValueOnce(true);
      fireEvent.click(link);
      expect(await screen.findByTestId('column')).toBeInTheDocument();
    } finally {
      unregister();
    }
  });
});

describe('Layout budget management sidebar', () => {
  afterEach(() => {
    access.grants = null;
  });

  function renderSidebar(path = '/ops/opex') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/ops" element={<div>overview</div>} />
              <Route path="/ops/budget" element={<div>budget</div>} />
              <Route path="/ops/opex" element={<div>opex</div>} />
              <Route path="/ops/capex/:id" element={<div>capex item</div>} />
              <Route path="/ops/opex/:id" element={<div>opex item</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('shows the administration entry to a budget administrator', () => {
    access.grants = { budget: 'admin', budget_ops: 'admin' };
    renderSidebar();

    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.administration' })).toHaveAttribute('href', '/ops/operations');
  });

  it('hides the administration entry from a budget member, who can use none of its pages', () => {
    access.grants = { budget: 'member', budget_ops: 'reader', companies: 'reader', departments: 'member' };
    renderSidebar();

    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.budgetLines' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.ops.administration' })).not.toBeInTheDocument();
  });

  it('selects OPEX, not Overview, on an OPEX item', () => {
    renderSidebar('/ops/opex/OPX-1');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.budgetLines' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.overview' })).not.toHaveClass('Mui-selected');
  });

  it('selects Overview on the overview page itself', () => {
    renderSidebar('/ops');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.overview' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.budgetLines' })).not.toHaveClass('Mui-selected');
  });

  it('does not select Overview on the OPEX list', () => {
    renderSidebar('/ops/opex');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.budgetLines' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.overview' })).not.toHaveClass('Mui-selected');
  });
  it.each(['/ops/budget', '/ops/capex/BL-30', '/ops/opex/BL-1'])('selects the single budget entry on %s', (path) => {
    renderSidebar(path);
    const entry = screen.getByRole('link', { name: 'nav:sidebar.ops.budgetLines' });
    expect(entry).toHaveAttribute('href', '/ops/budget');
    expect(entry).toHaveClass('Mui-selected');
    expect(screen.queryByRole('link', { name: 'nav:sidebar.ops.opex' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.ops.capex' })).toBeNull();
  });
});

describe('Layout master data sidebar', () => {
  function renderAt(path: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/master-data/contacts/:id/:tab" element={<div>contact</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('selects Suppliers on a contact form opened from a supplier', () => {
    renderAt('/master-data/contacts/new/overview?supplier_id=s-1&returnTo=%2Fmaster-data%2Fsuppliers%2Fs-1%2Fcontacts');
    expect(screen.getByRole('link', { name: 'nav:sidebar.masterData.suppliers' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('link', { name: 'nav:sidebar.masterData.contacts' })).not.toHaveClass('Mui-selected');
  });

  it('selects Contacts on a contact form opened from the contacts list', () => {
    renderAt('/master-data/contacts/new/overview');
    expect(screen.getByRole('link', { name: 'nav:sidebar.masterData.contacts' })).toHaveClass('Mui-selected');
  });

  it('ignores a return address outside the app', () => {
    renderAt('/master-data/contacts/new/overview?returnTo=%2F%2Fexample.com%2Fmaster-data%2Fsuppliers');
    expect(screen.getByRole('link', { name: 'nav:sidebar.masterData.contacts' })).toHaveClass('Mui-selected');
  });
});

describe('Layout on the refusal page', () => {
  function renderRefusal(from: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{ pathname: '/403', state: { from } }]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/403" element={<div>refusal</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('shows the section of the refused address', () => {
    renderRefusal('/master-data/contacts/new/overview');
    expect(screen.getByRole('tab', { name: 'nav:workspaces.masterData' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: 'nav:sidebar.masterData.contacts' })).toHaveClass('Mui-selected');
  });

  it('ignores a refused address outside the app', () => {
    renderRefusal('//example.com/master-data/contacts');
    expect(screen.queryByRole('link', { name: 'nav:sidebar.masterData.contacts' })).not.toBeInTheDocument();
  });

  it('highlights no section for a refused address in a section the person does not see', () => {
    access.grants = { contacts: 'reader' };
    try {
      renderRefusal('/ops/budget');
      expect(screen.getAllByRole('tab').filter((tab) => tab.getAttribute('aria-selected') === 'true')).toEqual([]);
      expect(screen.queryByRole('link', { name: 'nav:sidebar.ops.overview' })).not.toBeInTheDocument();
    } finally {
      access.grants = null;
    }
  });
});

describe('Layout administration sidebar: sample data', () => {
  afterEach(() => {
    access.isGlobalAdmin = false;
    access.deploymentMode = 'multi-tenant';
    access.sampleData = false;
  });

  function renderAdmin() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin/users']}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/admin/users" element={<div>users</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('shows Sample data after Branding to an Administrator of a cloud workspace', () => {
    access.isGlobalAdmin = true;
    access.sampleData = true;
    renderAdmin();

    const entry = screen.getByRole('link', { name: 'nav:sidebar.admin.sampleData' });
    expect(entry).toHaveAttribute('href', '/admin/sample-data');
    const branding = screen.getByRole('link', { name: 'nav:sidebar.admin.branding' });
    expect(branding.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides it from a user who administers users without the Administrator role', () => {
    access.sampleData = true;
    renderAdmin();
    expect(screen.getByRole('link', { name: 'nav:sidebar.admin.branding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.admin.sampleData' })).not.toBeInTheDocument();
  });

  it('hides it on-premise and when the server does not announce it', () => {
    access.isGlobalAdmin = true;
    access.deploymentMode = 'single-tenant';
    access.sampleData = true;
    renderAdmin();
    expect(screen.getByRole('link', { name: 'nav:sidebar.admin.branding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.admin.sampleData' })).not.toBeInTheDocument();
  });

  it('hides it when the feature flag is off', () => {
    access.isGlobalAdmin = true;
    renderAdmin();
    expect(screen.getByRole('link', { name: 'nav:sidebar.admin.branding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.admin.sampleData' })).not.toBeInTheDocument();
  });


});

describe('Layout user menu: about', () => {
  afterEach(() => {
    access.version = 'unknown';
  });

  it('shows About KANAP after Logout, with the version, and opens the dialog', () => {
    access.version = '26.10.1';
    renderShell();
    fireEvent.click(screen.getByTitle('nav:topBar.account'));

    const item = within(screen.getByRole('menu')).getByRole('menuitem', { name: /settings:about\.title/ });
    expect(item).toHaveTextContent('26.10.1');
    const logout = screen.getByRole('menuitem', { name: 'nav:userMenu.logout' });
    expect(logout.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(item);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('about-dialog')).toBeInTheDocument();
  });

  it('shows no version next to the item while the version is unknown', () => {
    renderShell();
    fireEvent.click(screen.getByTitle('nav:topBar.account'));

    const item = within(screen.getByRole('menu')).getByRole('menuitem', { name: /settings:about\.title/ });
    expect(item).toHaveTextContent(/^settings:about\.title$/);
  });
});

describe('Layout user menu: display name', () => {
  const namedProfile = { first_name: 'Ada' as string | null, last_name: 'Lovelace' as string | null, email: 'ada@example.com' as string | null };

  afterEach(() => {
    access.profile = { ...namedProfile };
  });

  function openAccountMenu() {
    renderShell();
    fireEvent.click(screen.getByTitle('nav:topBar.account'));
    return within(screen.getByRole('menu'));
  }

  it('shows the name and the email when the profile has a name', () => {
    const menu = openAccountMenu();
    expect(menu.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(menu.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('shows the email once when the profile has no name', () => {
    access.profile = { first_name: null, last_name: null, email: 'owner@example.com' };
    const menu = openAccountMenu();
    expect(menu.getAllByText('owner@example.com')).toHaveLength(1);
    expect(menu.queryByText('User')).not.toBeInTheDocument();
  });

  it('treats a blank name as absent and still shows the email once', () => {
    access.profile = { first_name: '  ', last_name: '', email: 'owner@example.com' };
    const menu = openAccountMenu();
    expect(menu.getAllByText('owner@example.com')).toHaveLength(1);
    expect(menu.queryByText('User')).not.toBeInTheDocument();
  });

  it('keeps a partial name and the email under it', () => {
    access.profile = { first_name: 'Ada', last_name: null, email: 'ada@example.com' };
    const menu = openAccountMenu();
    expect(menu.getByText('Ada')).toBeInTheDocument();
    expect(menu.getByText('ada@example.com')).toBeInTheDocument();
  });
});

describe('Layout section tabs on a narrow window', () => {
  it('scroll horizontally instead of clipping the first and last sections', () => {
    renderShell();
    const tablist = screen.getByRole('tablist', { name: 'nav:topBar.sectionNav' });
    const tabs = tablist.closest('.MuiTabs-root') as HTMLElement;
    // Centered tabs overflow on both sides and cut the first label; scrollable tabs keep every label whole.
    expect(tabs.querySelector('.MuiTabs-scrollableX')).not.toBeNull();
    expect(tablist.classList.contains('MuiTabs-centered')).toBe(false);
  });
});

describe('Layout section tabs scroll arrows', () => {
  // MUI shows each arrow while the first (or last) tab is out of view, watched by an IntersectionObserver.
  type Watch = { targets: Element[]; live: boolean };
  const watches: Watch[] = [];
  class FakeObserver {
    private watch: Watch = { targets: [], live: true };
    constructor() { watches.push(this.watch); }
    observe(target: Element) { this.watch.targets.push(target); }
    unobserve() {}
    disconnect() { this.watch.live = false; }
    takeRecords() { return []; }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    watches.length = 0;
    access.aiChat = false;
    access.aiData = undefined;
  });

  it('watches the tab that is first now, after a workspace appears in front', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    access.aiChat = true;
    const { rerenderShell } = renderShell();
    // The AI capabilities arrive after the first render and add the AI tab in first place.
    access.aiData = { surfaces: { chat: { available: true }, settings: { available: false } }, instance_features: { ai_settings: false } };
    rerenderShell();
    const nav = screen.getByRole('tablist', { name: 'nav:topBar.sectionNav' });
    const tabs = within(nav).getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent('nav:workspaces.ai');
    const watched = watches.filter((w) => w.live).flatMap((w) => w.targets);
    expect(watched).toContain(tabs[0]);
    expect(watched).toContain(tabs[tabs.length - 1]);
  });

  it('at 375 px, each arrow follows its end of the row and a click scrolls by the tabs that fit', () => {
    // The row's sizes on a 375 px phone: the scroller between the two arrows, each tab ~90 px.
    const SCROLLER = 247;
    const TAB = 90;
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('MuiTabs-scroller')) return SCROLLER;
      if (this.classList.contains('MuiTab-root')) return TAB;
      return 0;
    });
    // The observers report on demand, as the browser does once the row is laid out.
    const live: Array<{ callback: IntersectionObserverCallback; targets: Element[]; on: boolean }> = [];
    class ReportingObserver {
      private entry: { callback: IntersectionObserverCallback; targets: Element[]; on: boolean };
      constructor(callback: IntersectionObserverCallback) { this.entry = { callback, targets: [], on: true }; live.push(this.entry); }
      observe(target: Element) { this.entry.targets.push(target); }
      unobserve() {}
      disconnect() { this.entry.on = false; }
      takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', ReportingObserver);
    // MUI animates the scroll over animation frames: run them on demand, 16 ms apart.
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    const runFrames = () => {
      for (let time = 0; frames.length > 0 && time < 2000; time += 16) {
        const due = frames;
        frames = [];
        due.forEach((cb) => cb(time));
      }
    };
    try {
      renderShell();
      const nav = screen.getByRole('tablist', { name: 'nav:topBar.sectionNav' });
      const root = nav.closest('.MuiTabs-root') as HTMLElement;
      const scroller = root.querySelector('.MuiTabs-scroller') as HTMLElement;
      let scrollLeft = 0;
      Object.defineProperty(scroller, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (value: number) => { scrollLeft = value; } });
      const tabs = within(nav).getAllByRole('tab');
      expect(tabs.length * TAB).toBeGreaterThan(SCROLLER);
      const report = (first: boolean, last: boolean) => act(() => {
        for (const watch of live.filter((w) => w.on)) {
          for (const target of watch.targets) {
            const isIntersecting = target === tabs[0] ? first : last;
            watch.callback([{ isIntersecting, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
          }
        }
      });
      const arrows = () => Array.from(root.querySelectorAll('.MuiTabScrollButton-root')) as HTMLElement[];

      // At the start: the first tab in view, the last out of view.
      report(true, false);
      expect(arrows()).toHaveLength(2);
      expect(arrows()[0]).toHaveClass('Mui-disabled');
      expect(arrows()[1]).not.toHaveClass('Mui-disabled');

      // A click on the end arrow scrolls by the whole tabs that fit in the scroller: two of them.
      fireEvent.click(arrows()[1]);
      runFrames();
      expect(scrollLeft).toBe(2 * TAB);

      // At the end: the start arrow on, the end arrow off.
      report(false, true);
      expect(arrows()[0]).not.toHaveClass('Mui-disabled');
      expect(arrows()[1]).toHaveClass('Mui-disabled');
    } finally {
      width.mockRestore();
    }
  });
});

describe('Layout IT menu', () => {
  afterEach(() => {
    access.grants = null;
    access.vulnerabilityFeed = false;
    applicationVisibility.isLoading = false;
    applicationVisibility.hasScopedApplicationReaderAccess = false;
    applicationVisibility.shouldHideApplications = false;
  });

  function renderIt(path = '/it/assets') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/it/*" element={<div>it page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  /** Section titles and entries, in the order the drawer draws them. */
  function navTexts(container: HTMLElement): string[] {
    const drawer = container.querySelector('.MuiDrawer-paper');
    if (!drawer) throw new Error('IT drawer missing');
    return [...drawer.querySelectorAll('.MuiListSubheader-root, a')].map((node) => (node.textContent || '').trim());
  }

  it('lists applications, infrastructure, reference data, then operations', () => {
    access.vulnerabilityFeed = true;
    const { container } = renderIt();

    expect(navTexts(container)).toEqual([
      'nav:sidebar.it.sections.applications',
      'nav:sidebar.it.applications',
      'nav:sidebar.it.interfaces',
      'nav:sidebar.it.interfaceMap',
      'nav:sidebar.it.sections.infrastructure',
      'nav:sidebar.it.assets',
      'nav:sidebar.it.connections',
      'nav:sidebar.it.connectionMap',
      'nav:sidebar.it.administrationView',
      'nav:sidebar.it.sections.referenceData',
      'nav:sidebar.it.locations',
      'nav:sidebar.it.technologies',
      'nav:sidebar.it.sections.operations',
      'nav:sidebar.it.incidents',
      'nav:sidebar.it.endOfSupport',
      'nav:sidebar.it.vulnerabilities',
      'nav:sidebar.it.settings',
    ]);
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.applications' })).toHaveAttribute('href', '/it/applications');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.interfaceMap' })).toHaveAttribute('href', '/it/interface-map');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.assets' })).toHaveAttribute('href', '/it/assets');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.administrationView' })).toHaveAttribute('href', '/it/administration-view');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.technologies' })).toHaveAttribute('href', '/it/technologies');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.locations' })).toHaveAttribute('href', '/it/locations');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.endOfSupport' })).toHaveAttribute('href', '/it/technologies/end-of-support');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.vulnerabilities' })).toHaveAttribute('href', '/it/vulnerabilities');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.settings' })).toHaveAttribute('href', '/it/settings');
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.netbox' })).not.toBeInTheDocument();
  });

  it('hides vulnerabilities while the feed is off, and still has no Netbox entry', () => {
    renderIt();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.vulnerabilities' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.netbox' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.incidents' })).toBeInTheDocument();
  });

  it('drops a section title when every entry of that section is hidden', () => {
    access.grants = { infrastructure: 'reader' };
    const { container } = renderIt();
    const texts = navTexts(container);

    expect(texts).not.toContain('nav:sidebar.it.sections.applications');
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.applications' })).not.toBeInTheDocument();
    expect(texts).toContain('nav:sidebar.it.sections.infrastructure');
    expect(texts).toContain('nav:sidebar.it.sections.referenceData');
    expect(texts.indexOf('nav:sidebar.it.sections.infrastructure')).toBeLessThan(texts.indexOf('nav:sidebar.it.assets'));
  });

  it('leaves no section title when the only reachable page is settings', () => {
    access.grants = { settings: 'reader' };
    const { container } = renderIt('/it/settings');

    expect(navTexts(container)).toEqual(['nav:sidebar.it.settings']);
    expect(container.querySelectorAll('.MuiListSubheader-root')).toHaveLength(0);
  });

  it('hides the applications section when a scoped reader cannot see any of its entries', () => {
    applicationVisibility.hasScopedApplicationReaderAccess = true;
    applicationVisibility.shouldHideApplications = true;
    const { container } = renderIt();

    expect(navTexts(container)).not.toContain('nav:sidebar.it.sections.applications');
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.applications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.interfaces' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.interfaceMap' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.assets' })).toBeInTheDocument();
  });

  it('keeps Applications when a scoped reader may see that list and not the interface pages', () => {
    applicationVisibility.hasScopedApplicationReaderAccess = true;
    const { container } = renderIt('/it/applications');
    const texts = navTexts(container);

    expect(texts).toContain('nav:sidebar.it.sections.applications');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.applications' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.interfaces' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.interfaceMap' })).not.toBeInTheDocument();
  });

  it('shows Settings to someone who can open the lists or administer infrastructure', () => {
    access.grants = { settings: 'reader' };
    const { unmount } = renderIt('/it/settings');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.settings' })).toBeInTheDocument();
    unmount();

    access.grants = { infrastructure: 'admin' };
    renderIt('/it/assets');
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.settings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.netbox' })).not.toBeInTheDocument();
  });

  it('hides Settings from an infrastructure reader', () => {
    access.grants = { infrastructure: 'reader' };
    renderIt('/it/assets');
    expect(screen.queryByRole('link', { name: 'nav:sidebar.it.settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'nav:sidebar.it.assets' })).toBeInTheDocument();
  });

  it('opens the manual of the tab on screen', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      const { unmount } = renderIt('/it/settings?tab=netbox&state=linked');
      fireEvent.click(screen.getByRole('button', { name: 'nav:topBar.openDocs' }));
      expect(open).toHaveBeenCalledWith('https://doc.kanap.net/netbox/', '_blank', 'noopener,noreferrer');
      unmount();
      open.mockClear();

      renderIt('/it/settings?state=linked');
      fireEvent.click(screen.getByRole('button', { name: 'nav:topBar.openDocs' }));
      expect(open).toHaveBeenCalledWith('https://doc.kanap.net/it-ops-settings/', '_blank', 'noopener,noreferrer');
    } finally {
      open.mockRestore();
    }
  });
});

describe('Layout Plaid tab when chat is turned off', () => {
  afterEach(() => {
    access.aiChat = false;
    access.aiData = undefined;
  });

  function plaidTab() {
    const nav = screen.getByRole('tablist', { name: 'nav:topBar.sectionNav' });
    return within(nav).queryByRole('tab', { name: 'nav:workspaces.ai' });
  }

  it('keeps the Plaid tab for someone who may use the chat', () => {
    access.aiChat = true;
    access.aiData = {
      surfaces: {
        chat: {
          available: false,
          permission_granted: true,
          tenant_enabled: false,
          reasons: ['tenant_disabled'],
        },
        settings: { available: true },
      },
      instance_features: { ai_settings: true },
    };
    renderShell();
    expect(plaidTab()).toBeInTheDocument();
  });

  it('hides the Plaid tab when the chat right is missing', () => {
    access.aiChat = true;
    access.aiData = {
      surfaces: {
        chat: {
          available: false,
          permission_granted: false,
          tenant_enabled: false,
          reasons: ['tenant_disabled', 'permission_denied'],
        },
        settings: { available: false },
      },
      instance_features: { ai_settings: false },
    };
    renderShell();
    expect(plaidTab()).not.toBeInTheDocument();
  });
});
