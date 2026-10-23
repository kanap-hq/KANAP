/**
 * The environments of an application, in the one order every screen uses: Prod, Pre-prod, QA,
 * Test, Dev, Sandbox (the Deployments tab, its dialog, the Interfaces tab, the applications list).
 * `label` is the full translated name (`it:enums.environment.<key>`).
 */
export const APPLICATION_ENVIRONMENTS = [
  { value: 'prod', labelKey: 'enums.environment.prod' },
  { value: 'pre_prod', labelKey: 'enums.environment.preProd' },
  { value: 'qa', labelKey: 'enums.environment.qa' },
  { value: 'test', labelKey: 'enums.environment.test' },
  { value: 'dev', labelKey: 'enums.environment.dev' },
  { value: 'sandbox', labelKey: 'enums.environment.sandbox' },
] as const;

const RANK = new Map<string, number>(APPLICATION_ENVIRONMENTS.map((env, index) => [env.value as string, index]));

/** The translation key of an environment's full name, or null for a code that is not one of them. */
export function environmentLabelKey(value: string | null | undefined): string | null {
  return APPLICATION_ENVIRONMENTS.find((env) => env.value === value)?.labelKey ?? null;
}

/** Orders two environment codes; a code outside the list goes last, alphabetically. */
export function compareEnvironments(a: string, b: string): number {
  const ra = RANK.get(a) ?? RANK.size;
  const rb = RANK.get(b) ?? RANK.size;
  return ra !== rb ? ra - rb : a.localeCompare(b);
}
