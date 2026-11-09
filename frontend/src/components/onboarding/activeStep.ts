/**
 * The step whose hint is open in this browser tab. The first steps open a step with its key in the
 * address; the key leaves the address as soon as the person opens a record of the list or comes
 * back to it, and the hint must stay until it is closed. Kept in session storage so that a reload
 * keeps it, in memory when the browser refuses storage.
 */
export type ActiveStep = { key: string };

const STORAGE_KEY = 'kanap.onboarding.activeStep';

let memory: ActiveStep | null = null;

export function readActiveStep(): ActiveStep | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return memory;
    const parsed = JSON.parse(raw) as Partial<ActiveStep> | null;
    return parsed && typeof parsed.key === 'string' ? { key: parsed.key } : null;
  } catch {
    return memory;
  }
}

export function writeActiveStep(step: ActiveStep | null): void {
  memory = step;
  try {
    if (step) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(step));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Memory only.
  }
}

/** The address is the step's screen or one of its pages (a record of the list, a new record). */
export function withinStepScreen(pathname: string, screenPath: string): boolean {
  return pathname === screenPath || pathname.startsWith(`${screenPath}/`);
}
