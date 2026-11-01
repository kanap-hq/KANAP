import type { OnboardingAngle, OnboardingMode, OnboardingState } from '../components/onboarding/onboardingApi';

/** The five steps of each path (`backend/src/onboarding/onboarding-paths.ts`). */
export const FAKE_PATHS: Record<string, string[]> = {
  'budget/example': ['budget_overview', 'budget_line', 'budget_report', 'budget_plaid', 'budget_import'],
  'budget/own_data': ['own_company', 'own_budget_lines', 'own_contract', 'own_report', 'own_invite'],
  'cartography/example': ['map_applications', 'map_application', 'map_assets', 'map_technologies', 'map_import'],
  'cartography/own_data': ['own_applications', 'own_technologies', 'own_assets', 'own_findings', 'own_invite'],
  'portfolio/example': ['portfolio_request', 'portfolio_project', 'portfolio_tasks', 'portfolio_time', 'portfolio_import'],
  'portfolio/own_data': ['own_request', 'own_projects', 'own_tasks', 'own_project_budget', 'own_invite'],
};

type HttpError = Error & { response: { status: number; data: Record<string, unknown> } };

function httpError(status: number, data: Record<string, unknown>): HttpError {
  return Object.assign(new Error(String(data.code ?? status)), { response: { status, data } });
}

/**
 * An in-memory onboarding API that follows the contract of `doc/onboarding.md` (rights, the 409
 * of "start with my own data" over modified sample data, steps per path), for component tests.
 */
export function createFakeOnboardingServer(initial: {
  angle?: OnboardingAngle | null;
  mode?: OnboardingMode | null;
  administrator?: boolean;
  sampleData?: OnboardingState['sample_data'];
  createdSinceLoad?: number;
} = {}) {
  const db = {
    angle: initial.angle ?? null,
    mode: initial.mode ?? null,
    chosenAt: null as string | null,
    administrator: initial.administrator ?? true,
    sampleData: initial.sampleData ?? { status: 'idle', step: null },
    createdSinceLoad: initial.createdSinceLoad ?? 0,
    done: new Map<string, string>(),
    dismissedAt: null as string | null,
  };
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];

  const state = (): OnboardingState => {
    const keys = db.angle && db.mode ? FAKE_PATHS[`${db.angle}/${db.mode}`] : [];
    const steps = keys.map((key) => ({ key, done_at: db.done.get(`${db.angle}/${db.mode}/${key}`) ?? null }));
    const next = steps.find((step) => !step.done_at)?.key ?? null;
    return {
      angle: db.angle,
      mode: db.mode,
      chosen_at: db.chosenAt,
      can_choose: db.administrator || db.angle === null || db.mode === null,
      steps,
      next_step: next,
      completed: steps.length > 0 && next === null,
      dismissed_at: db.dismissedAt,
      sample_data: db.sampleData,
      reset_in_progress: db.sampleData.status === 'resetting',
    };
  };

  const holdsSample = () => db.sampleData.status === 'loaded' || db.sampleData.status === 'loading';

  const choose = (body: { angle?: OnboardingAngle; mode?: OnboardingMode; confirm_reset?: boolean }) => {
    if (!body.angle && !body.mode) throw httpError(400, { code: 'choice_required' });
    const changes = (field: 'angle' | 'mode') => body[field] !== undefined && db[field] !== null && db[field] !== body[field];
    if (!db.administrator && (changes('angle') || changes('mode'))) throw httpError(403, { code: 'administrator_required' });
    if (body.mode === 'own_data' && db.mode !== 'own_data') {
      if (holdsSample() && !db.administrator) throw httpError(403, { code: 'administrator_required' });
      if (db.sampleData.status === 'loaded') {
        if (db.createdSinceLoad > 0 && !body.confirm_reset) {
          throw httpError(409, { code: 'sample_data_modified', created_since_load: db.createdSinceLoad });
        }
        db.sampleData = { status: 'resetting', step: null };
      }
    }
    if (body.angle) db.angle = body.angle;
    if (body.mode) db.mode = body.mode;
    db.chosenAt = '2026-11-02T09:14:00.000Z';
  };

  const stepKey = (url: string) => decodeURIComponent(url.split('/')[3] ?? '');
  const checkStep = (key: string) => {
    if (!db.angle || !db.mode) throw httpError(409, { code: 'no_choice' });
    if (!FAKE_PATHS[`${db.angle}/${db.mode}`].includes(key)) throw httpError(400, { code: 'unknown_step' });
    return `${db.angle}/${db.mode}/${key}`;
  };

  const request = async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body });
    if (method === 'get' && url === '/onboarding') return { data: state() };
    if (method === 'put' && url === '/onboarding/choice') { choose((body ?? {}) as never); return { data: state() }; }
    if (url === '/onboarding/dismiss') {
      db.dismissedAt = method === 'post' ? '2026-11-02T10:00:00.000Z' : null;
      return { data: state() };
    }
    if (/^\/onboarding\/steps\/[^/]+\/done$/.test(url)) {
      const key = checkStep(stepKey(url));
      if (method === 'post' && !db.done.has(key)) db.done.set(key, '2026-11-02T09:20:00.000Z');
      if (method === 'delete') db.done.delete(key);
      return { data: state() };
    }
    throw httpError(404, { code: 'not_found' });
  };

  return {
    db,
    calls,
    state,
    api: {
      get: (url: string) => request('get', url),
      put: (url: string, body?: unknown) => request('put', url, body),
      post: (url: string, body?: unknown) => request('post', url, body),
      delete: (url: string) => request('delete', url),
    },
  };
}
