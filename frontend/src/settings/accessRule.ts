/**
 * Who may open or change a settings page, written as data (the settings page registry, `./pages`).
 * Pure TypeScript without React or path alias: the backend specs import these files too.
 */

export type AccessLevel = 'reader' | 'contributor' | 'member' | 'admin';

/** Deployment mode: cloud (multi-tenant) or on site (single-tenant). */
export type DeploymentMode = 'cloud' | 'onprem';

/**
 * Conditions that stay in code, named here (`custom`):
 * - `aiSettingsSurface`: the AI settings are on (`features.aiSettings`) and the AI capabilities say
 *   the settings surface is available to the person.
 * - `aiAgentsInstance`: the AI settings are on and the instance offers the AI agents
 *   (`instance_features.ai_settings`).
 * - `libraryManage`: the person manages the library open on the knowledge page (`can_manage`, a
 *   right on the record).
 * - `billingAdmin`: the person manages billing (`claims.isBillingAdmin`).
 */
export type CustomRuleName = 'aiSettingsSurface' | 'aiAgentsInstance' | 'libraryManage' | 'billingAdmin';

export type AccessRule =
  /** Any signed-in person. */
  | { kind: 'signedIn' }
  /** A level on a module resource (`hasLevel`: the Administrator role passes every level). */
  | { kind: 'level'; resource: string; level: AccessLevel }
  /** One of the rules. */
  | { kind: 'anyOf'; rules: AccessRule[] }
  /** Every rule. */
  | { kind: 'allOf'; rules: AccessRule[] }
  /** The Administrator role (`claims.isGlobalAdmin`). */
  | { kind: 'administrator' }
  /** A platform administrator (`claims.isPlatformAdmin`). */
  | { kind: 'platformAdmin' }
  /** A person whose data access is not limited. */
  | { kind: 'fullDataAccess' }
  /** A condition kept in code, named. */
  | { kind: 'custom'; name: CustomRuleName }
  /** A different rule in each deployment mode. */
  | { kind: 'byMode'; cloud: AccessRule; onprem: AccessRule };

/** What the evaluator reads about the person, as the menu does: no server call. */
export type AccessContext = {
  mode: DeploymentMode;
  hasLevel: (resource: string, level: AccessLevel) => boolean;
  isAdministrator: boolean;
  isPlatformAdmin: boolean;
  dataAccessLimited: boolean;
  custom: Partial<Record<CustomRuleName, boolean>>;
};

export const signedIn: AccessRule = { kind: 'signedIn' };
export const level = (resource: string, lvl: AccessLevel): AccessRule => ({ kind: 'level', resource, level: lvl });
export const anyOf = (...rules: AccessRule[]): AccessRule => ({ kind: 'anyOf', rules });
export const allOf = (...rules: AccessRule[]): AccessRule => ({ kind: 'allOf', rules });
export const administrator: AccessRule = { kind: 'administrator' };
export const platformAdmin: AccessRule = { kind: 'platformAdmin' };
export const fullDataAccess: AccessRule = { kind: 'fullDataAccess' };
export const custom = (name: CustomRuleName): AccessRule => ({ kind: 'custom', name });
export const byMode = (rules: { cloud: AccessRule; onprem: AccessRule }): AccessRule => ({ kind: 'byMode', ...rules });

/** Whether the person meets the rule. */
export function evaluateAccess(rule: AccessRule, context: AccessContext): boolean {
  switch (rule.kind) {
    case 'signedIn':
      return true;
    case 'level':
      return context.hasLevel(rule.resource, rule.level);
    case 'anyOf':
      return rule.rules.some((item) => evaluateAccess(item, context));
    case 'allOf':
      return rule.rules.every((item) => evaluateAccess(item, context));
    case 'administrator':
      return context.isAdministrator;
    case 'platformAdmin':
      return context.isPlatformAdmin;
    case 'fullDataAccess':
      return !context.dataAccessLimited;
    case 'custom':
      return context.custom[rule.name] === true;
    case 'byMode':
      return evaluateAccess(context.mode === 'onprem' ? rule.onprem : rule.cloud, context);
    default:
      return false;
  }
}

/** The custom conditions a rule names, `byMode` branches included. */
export function customRuleNames(rule: AccessRule): CustomRuleName[] {
  switch (rule.kind) {
    case 'custom':
      return [rule.name];
    case 'anyOf':
    case 'allOf':
      return rule.rules.flatMap(customRuleNames);
    case 'byMode':
      return [...customRuleNames(rule.cloud), ...customRuleNames(rule.onprem)];
    default:
      return [];
  }
}
