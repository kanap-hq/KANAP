import React from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { readActiveStep, writeActiveStep, type ActiveStep } from './activeStep';
import { onboardingApi } from './onboardingApi';
import { STEP_PARAM, stepHintKey, stepScreen, stepTitleKey, type StepLocationState } from './onboardingPaths';
import { ONBOARDING_QUERY_KEY, useOnboarding, useOnboardingActions } from './useOnboarding';
import { useOpenStep } from './useOpenStep';

/** While the hint waits for the object of its step, the state is read again this often. */
export const STEP_OBJECT_POLL_MS = 5000;

/** The hint's least distance from the edges of the window, in pixels: its corner is 16 px from the right and bottom. */
const CORNER = 16;

/** Space between the hint and an action it moves off. */
const GAP = 8;

/**
 * How often the hint looks again at what lies under it (a page drawn late, a drawer, a card, a
 * scroll): at this pace, it does not follow a scroll frame by frame.
 */
const PLACE_CHECK_MS = 300;

/** What the person can use: buttons and fields. */
const ACTIONS = [
  'button', '[role="button"]', 'a.MuiButtonBase-root', 'input:not([type="hidden"])', 'textarea', 'select',
  '[role="combobox"]', '[contenteditable="true"]',
].join(', ');

/** The rows and cells of a data grid scroll under the hint: they do not move it. */
const GRID = '.ag-root, [role="grid"], [role="treegrid"]';

/** The hint's distances from the right and bottom edges of the window. */
type Place = { right: number; bottom: number };
type Box = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };

const IN_CORNER: Place = { right: CORNER, bottom: CORNER };

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function boxAt(place: Place, size: Size): Box {
  const right = window.innerWidth - place.right;
  const bottom = window.innerHeight - place.bottom;
  return { left: right - size.width, top: bottom - size.height, right, bottom };
}

/** Whole inside the window, CORNER px from its edges at least. */
function fits(place: Place, size: Size): boolean {
  const box = boxAt(place, size);
  return place.right >= CORNER && place.bottom >= CORNER && box.left >= CORNER && box.top >= CORNER;
}

/** A disabled control lets the pointer through to its parent: it shows all the same (Submit before a comment is typed). */
const DISABLED = ':disabled, [aria-disabled="true"], .Mui-disabled';

/**
 * In front where it stands, the hint aside: not behind a drawer, its backdrop or another surface,
 * nor clipped out of a scrolled panel (jsdom has no `elementsFromPoint`).
 */
function reachable(element: Element, rect: Box, bubble: Element): boolean {
  if (typeof document.elementsFromPoint !== 'function') return true;
  const x = (Math.max(rect.left, 0) + Math.min(rect.right, window.innerWidth)) / 2;
  const y = (Math.max(rect.top, 0) + Math.min(rect.bottom, window.innerHeight)) / 2;
  const front = document.elementsFromPoint(x, y).find((hit) => !bubble.contains(hit));
  if (!front) return false;
  return element.contains(front) || (front.contains(element) && element.matches(DISABLED));
}

/** The actions the hint could cover: those along the right edge and the bottom edge of the window. */
function actionsAround(bubble: HTMLElement, size: Size): Box[] {
  const { innerWidth: width, innerHeight: height } = window;
  const rightEdge = { left: width - CORNER - size.width, top: 0, right: width, bottom: height };
  const bottomEdge = { left: 0, top: height - CORNER - size.height, right: width, bottom: height };
  return Array.from(document.querySelectorAll(ACTIONS)).flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || (!overlaps(rect, rightEdge) && !overlaps(rect, bottomEdge))) return [];
    if (bubble.contains(element) || element.closest(GRID) || !reachable(element, rect, bubble)) return [];
    return [rect];
  });
}

/**
 * The hint keeps its corner while it covers no action there. Otherwise it stays where it stands if
 * that covers none, or takes the free place nearest the corner: just above an action along the
 * right edge (the composer of the assistant, a comment field and its button span the bottom), or
 * just left of one along the bottom edge (the fields of a properties panel fill the right edge).
 * With no free place, the place that covers the fewest actions.
 */
function choosePlace(current: Place, actions: Box[], size: Size): Place {
  const covered = (place: Place) => {
    const box = boxAt(place, size);
    return actions.filter((action) => overlaps(box, action)).length;
  };
  if (covered(IN_CORNER) === 0) return IN_CORNER;
  if (fits(current, size) && covered(current) === 0) return current;
  const places = actions.flatMap((action): Place[] => [
    { right: CORNER, bottom: window.innerHeight - action.top + GAP },
    { right: window.innerWidth - action.left + GAP, bottom: CORNER },
  ]).filter((place) => fits(place, size));
  return [IN_CORNER, ...places]
    .map((place) => ({ place, covers: covered(place), distance: place.right + place.bottom }))
    .sort((a, b) => a.covers - b.covers || a.distance - b.distance)[0].place;
}

/** Where the hint stands, placed before it is painted and looked at again while it is shown. */
function useHintPlace(bubbleRef: React.RefObject<HTMLDivElement>, shown: boolean): Place {
  const [place, setPlace] = React.useState<Place>(IN_CORNER);
  const placeRef = React.useRef(IN_CORNER);
  const check = React.useCallback(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const { width, height } = bubble.getBoundingClientRect();
    const size = { width, height };
    const current = placeRef.current;
    const next = choosePlace(current, actionsAround(bubble, size), size);
    if (next.right === current.right && next.bottom === current.bottom) return;
    placeRef.current = next;
    setPlace(next);
  }, [bubbleRef]);
  React.useLayoutEffect(check);
  React.useEffect(() => {
    if (!shown) return undefined;
    const timer = window.setInterval(check, PLACE_CHECK_MS);
    window.addEventListener('resize', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', check);
    };
  }, [check, shown]);
  return place;
}

/**
 * The hint of a step opened from the first steps: one sentence says what to look at. On the
 * example, opening the step marks it done; with your own data, the object the step creates does,
 * or "Done" for a step that creates none. It stays on every screen until it is closed
 * (`activeStep.ts`); once the step is done, it opens the next step, or the home page at the end of
 * the path.
 */
export default function StepHint() {
  const { t, i18n } = useTranslation('common');
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useOnboarding();
  const { markDone } = useOnboardingActions();
  const openStep = useOpenStep();

  const paramKey = new URLSearchParams(location.search).get(STEP_PARAM);
  const [active, setActive] = React.useState<ActiveStep | null>(readActiveStep);
  // A step opened from the first steps becomes the open one.
  React.useEffect(() => {
    if (!paramKey) return;
    setActive((current) => {
      if (current?.key === paramKey) return current;
      const next = { key: paramKey };
      writeActiveStep(next);
      return next;
    });
  }, [paramKey]);
  const key = paramKey ?? active?.key ?? null;
  const found = key && state ? state.steps.find((candidate) => candidate.key === key) ?? null : null;
  const screen = found && state ? stepScreen(found.key, state.angle) : null;
  // The hint stays on every screen until it is closed: a step leads out of its own address (from
  // the end of support to a technology and to the vulnerabilities, from a request to the project it
  // was converted into).
  const step = screen ? found : null;
  const discover = state?.mode === 'example';

  const bubbleRef = React.useRef<HTMLDivElement>(null);
  const place = useHintPlace(bubbleRef, !!step && !!state);

  // The object of the step may be created in a dialog, with no change of address.
  const waiting = !!step && step.automatic && !step.done_at;
  useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: onboardingApi.get,
    enabled: waiting,
    refetchInterval: waiting ? STEP_OBJECT_POLL_MS : false,
  });

  const markedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!step || !discover || step.done_at || markedRef.current === step.key) return;
    markedRef.current = step.key;
    markDone.mutate(step.key);
  }, [discover, markDone, step]);

  const close = React.useCallback(() => {
    writeActiveStep(null);
    setActive(null);
    if (!paramKey) return;
    const params = new URLSearchParams(location.search);
    params.delete(STEP_PARAM);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate, paramKey]);

  const finish = React.useCallback(() => {
    writeActiveStep(null);
    setActive(null);
    navigate('/');
  }, [navigate]);

  if (!step || !screen || !state) return null;
  // A record opened by its step is named in the hint, when the step has a sentence for it.
  const record = (location.state as StepLocationState | null)?.onboardingRecord;
  const recordKey = `onboarding.firstSteps.steps.${step.key}.hintRecord`;
  const hint = record && i18n.exists(`common:${recordKey}`)
    ? t(recordKey, { record })
    : t(stepHintKey(step.key, state.angle));

  return (
    // In the bottom-right corner of the window, moved off any action it would cover there
    // (`useHintPlace`). A modal dialog stands above it.
    <Paper
      ref={bubbleRef}
      role="dialog"
      aria-label={t(stepTitleKey(step.key, state.angle))}
      // Inline, so that each place does not add a style rule.
      style={{ right: place.right, bottom: place.bottom }}
      sx={(theme) => ({
        position: 'fixed',
        zIndex: theme.zIndex.modal - 1,
        boxSizing: 'border-box',
        // Inside the window on a narrow screen.
        maxWidth: `min(360px, calc(100vw - ${2 * CORNER}px))`,
        p: 1.5,
        borderRadius: '8px',
        // The ring sets the hint off a card of the same tint in dark mode.
        border: `1px solid ${theme.palette.primary.main}`,
        // A raised surface: in dark mode the page background would swallow it.
        bgcolor: theme.palette.kanap.bg.composer,
        boxShadow: theme.shadows[3],
      })}
    >
      <Typography variant="body2">{hint}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, mt: 1.25 }}>
        {step.done_at && !discover ? (
          <CheckCircleIcon aria-hidden sx={{ fontSize: 18, color: 'success.main', mr: 'auto' }} />
        ) : null}
        {step.done_at ? (
          <>
            <Button variant="action" onClick={close}>{t('onboarding.firstSteps.gotIt')}</Button>
            {state.next_step ? (
              <Button variant="action-primary" onClick={() => { void openStep(state.next_step!, state.angle); }}>
                {t('onboarding.firstSteps.nextStep')}
              </Button>
            ) : (
              <Button variant="action-primary" onClick={finish}>{t('onboarding.firstSteps.finish')}</Button>
            )}
          </>
        ) : discover || step.automatic ? (
          <Button variant="action" onClick={close}>{t('onboarding.firstSteps.gotIt')}</Button>
        ) : (
          <>
            <Button variant="action" onClick={close}>{t('onboarding.firstSteps.later')}</Button>
            <Button
              variant="action-primary"
              disabled={markDone.isPending}
              onClick={() => markDone.mutate(step.key)}
            >
              {t('onboarding.firstSteps.done')}
            </Button>
          </>
        )}
      </Box>
    </Paper>
  );
}
