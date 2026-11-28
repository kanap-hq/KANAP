import { parseDeploymentMode } from '../common/deployment-mode';

/**
 * Installation settings: "the file is master" (Paramétrage, decision R8). Each setting takes the
 * value of the configuration file when the file gives a readable one, otherwise the value stored
 * in the database (set on the screen), otherwise the default of the code. A value that is empty or
 * made of spaces counts as absent; a value the reading of today replaces with the default (not a
 * number, zero, negative) is unreadable, counts as absent, and is said in the state. The
 * application never writes the file.
 *
 * A domain is one table of one row (`singleton`), without `tenant_id` or row level security,
 * whose columns stay null until something is set. Its declaration below is all a new domain
 * writes: the service reads, resolves, validates, stores and audits from it.
 */

export type InstallationSettingSource = 'file' | 'database' | 'default';
export type InstallationSettingValue = number | string | boolean;
/** The fields of `Features` (config/features.ts) a domain may set: a new switch is named here. */
export type InstallationFeature = 'AI_WEB_SEARCH_READY';

/** What a default may depend on: the mode, and the settings declared before it in the domain. */
export type InstallationDefaultContext = {
  singleTenant: boolean;
  value(key: string): InstallationSettingValue | null;
};

type Default<T> = T | ((context: InstallationDefaultContext) => T);

type DeclarationBase = {
  /** The name in the API and in the audit entry. */
  key: string;
  /** The column of the domain table. */
  column: string;
  /** The variable of the configuration file, then the former names it still accepts. */
  env: string;
  aliases?: readonly string[];
};

export type IntegerSettingDeclaration = DeclarationBase & {
  type: 'integer';
  /** The bounds of a value set on the screen. A file value is read as today (a positive integer). */
  min: number;
  max: number;
  /** A file value above it is read as it (a ceiling the code applied before the setting existed). */
  fileCeiling?: number;
  default: Default<number>;
};

export type SecretSettingDeclaration = DeclarationBase & {
  type: 'secret';
  /** Encrypted in the database; the API and the audit say only whether one is set, under this name. */
  auditKey: string;
};

export type StringSettingDeclaration = DeclarationBase & {
  type: 'string';
  maxLength: number;
  default: Default<string | null>;
};

export type BooleanSettingDeclaration = DeclarationBase & {
  type: 'boolean';
  default: Default<boolean>;
};

export type InstallationSettingDeclaration =
  | IntegerSettingDeclaration
  | SecretSettingDeclaration
  | StringSettingDeclaration
  | BooleanSettingDeclaration;

export type InstallationDomain = {
  /** The route segment (`admin/installation/<name>`) and the snapshot key. */
  name: string;
  /** The table, also the audit table name. */
  table: string;
  settings: readonly InstallationSettingDeclaration[];
  /** The switches of `Features` the domain sets, from its resolved values. */
  features?: (value: (key: string) => InstallationSettingValue | null) => Partial<Record<InstallationFeature, boolean>>;
};

export type ResolvedSetting = {
  declaration: InstallationSettingDeclaration;
  /** The resolved value; for a secret, its plain text, never sent out. */
  value: InstallationSettingValue | null;
  source: InstallationSettingSource;
  /** The file gives the value: it cannot be set on the screen. */
  locked: boolean;
  /** The file sets the variable to a value that cannot be read: it counts as absent. */
  fileUnreadable: boolean;
  /**
   * A secret only: the database stores one that cannot be decrypted (the encryption key is
   * missing or another one). It counts as absent; a new value or a clear replaces it.
   */
  storedUnreadable: boolean;
  /** The value without the file and the database. */
  defaultValue: InstallationSettingValue | null;
};

export type ResolvedDomain = Map<string, ResolvedSetting>;

type FileValue = { present: false } | { present: true; readable: false } | { present: true; readable: true; value: InstallationSettingValue };

/**
 * A switch as `parseBoolean` (common/env.ts) reads it. Not imported: common/env.ts loads
 * common/url.ts, which loads config/features.ts, which loads this module.
 */
function parseBoolean(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'y' || value === 'on';
}

/** The positive integer the code read before the settings existed: `'12abc'` is 12, `'1.9'` is 1. */
export function parsePositiveInteger(raw: string): number | null {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function fileValue(declaration: InstallationSettingDeclaration, env: NodeJS.ProcessEnv): FileValue {
  const raw = [declaration.env, ...(declaration.aliases ?? [])]
    .map((name) => env[name])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '');
  if (raw === undefined) return { present: false };
  switch (declaration.type) {
    case 'integer': {
      const parsed = parsePositiveInteger(raw);
      if (parsed === null) return { present: true, readable: false };
      return { present: true, readable: true, value: declaration.fileCeiling ? Math.min(parsed, declaration.fileCeiling) : parsed };
    }
    case 'boolean':
      return { present: true, readable: true, value: parseBoolean(raw) };
    case 'secret':
    case 'string':
      return { present: true, readable: true, value: raw };
  }
}

function databaseValue(declaration: InstallationSettingDeclaration, row: Record<string, unknown> | null): InstallationSettingValue | null {
  const value = row?.[declaration.key];
  if (value === null || value === undefined) return null;
  switch (declaration.type) {
    case 'integer': {
      const number = typeof value === 'number' ? value : Number(value);
      return Number.isInteger(number) && number > 0 ? number : null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    case 'secret':
    case 'string':
      return typeof value === 'string' && value.trim() !== '' ? value : null;
  }
}

function defaultValue(declaration: InstallationSettingDeclaration, context: InstallationDefaultContext): InstallationSettingValue | null {
  if (declaration.type === 'secret') return null;
  const value = declaration.default;
  return typeof value === 'function' ? value(context) : value;
}

/**
 * Resolves each setting of a domain, in the order of its declaration. `row` holds the values
 * stored in the database by setting key (a secret already decrypted), or null without a row;
 * `storedUnreadable` the keys of the secrets stored that cannot be decrypted.
 */
export function resolveDomain(
  domain: InstallationDomain,
  row: Record<string, unknown> | null,
  env: NodeJS.ProcessEnv = process.env,
  storedUnreadable: ReadonlySet<string> = new Set(),
): ResolvedDomain {
  const resolved: ResolvedDomain = new Map();
  const context: InstallationDefaultContext = {
    singleTenant: parseDeploymentMode(env.DEPLOYMENT_MODE) === 'single-tenant',
    value: (key) => resolved.get(key)?.value ?? null,
  };
  for (const declaration of domain.settings) {
    const file = fileValue(declaration, env);
    const fallback = defaultValue(declaration, context);
    const stored = databaseValue(declaration, row);
    const base = {
      declaration,
      defaultValue: fallback,
      fileUnreadable: file.present && !file.readable,
      storedUnreadable: declaration.type === 'secret' && storedUnreadable.has(declaration.key),
    };
    if (file.present && file.readable) {
      resolved.set(declaration.key, { ...base, value: file.value, source: 'file', locked: true });
    } else if (stored !== null) {
      resolved.set(declaration.key, { ...base, value: stored, source: 'database', locked: false });
    } else {
      resolved.set(declaration.key, { ...base, value: fallback, source: 'default', locked: false });
    }
  }
  return resolved;
}

/**
 * A secret: whether one applies (`has_value`, never the value), and `stored_unreadable` when the
 * database stores one that cannot be decrypted (the encryption key is missing or another one): it
 * does not apply, a new value or a clear replaces it.
 */
export type SecretSettingState = {
  has_value: boolean;
  stored_unreadable: boolean;
  source: InstallationSettingSource;
  locked: boolean;
  file_unreadable: boolean;
};
export type ValueSettingState = {
  value: InstallationSettingValue | null;
  default: InstallationSettingValue | null;
  source: InstallationSettingSource;
  locked: boolean;
  file_unreadable: boolean;
  min?: number;
  max?: number;
  max_length?: number;
};

/** The state the API returns: never a secret, only whether one is set. */
export function domainState(resolved: ResolvedDomain): Record<string, SecretSettingState | ValueSettingState> {
  const state: Record<string, SecretSettingState | ValueSettingState> = {};
  for (const [key, setting] of resolved) {
    const common = { source: setting.source, locked: setting.locked, file_unreadable: setting.fileUnreadable };
    const declaration = setting.declaration;
    if (declaration.type === 'secret') {
      state[key] = { has_value: setting.value !== null, stored_unreadable: setting.storedUnreadable, ...common };
      continue;
    }
    state[key] = {
      value: setting.value,
      default: setting.defaultValue,
      ...common,
      ...(declaration.type === 'integer' ? { min: declaration.min, max: declaration.max } : {}),
      ...(declaration.type === 'string' ? { max_length: declaration.maxLength } : {}),
    };
  }
  return state;
}

export type InstallationSettingWriteErrorCode =
  | 'installation_setting_unknown'
  | 'installation_setting_locked'
  | 'installation_setting_invalid'
  | 'settings_encryption_unavailable';

export class InstallationSettingWriteError extends Error {
  constructor(
    readonly code: InstallationSettingWriteErrorCode,
    readonly setting: string | null,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'InstallationSettingWriteError';
  }
}

/**
 * The values a write sets, by setting key: null clears the stored value (the file or the default
 * applies again). Refuses an unknown setting, a setting the file gives, a value outside its type
 * or its bounds, and a secret while no encryption key is set.
 */
export function validateWrite(
  domain: InstallationDomain,
  body: unknown,
  resolved: ResolvedDomain,
  options: { canEncrypt: boolean },
): Map<string, InstallationSettingValue | null> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InstallationSettingWriteError('installation_setting_invalid', null, 'The body must be an object of settings.');
  }
  const values = new Map<string, InstallationSettingValue | null>();
  for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
    const setting = resolved.get(key);
    if (!setting) throw new InstallationSettingWriteError('installation_setting_unknown', key, `${key} is not a setting of this page.`);
    if (setting.locked) {
      throw new InstallationSettingWriteError('installation_setting_locked', key, `${key} is set in the configuration file.`);
    }
    values.set(key, validateValue(setting.declaration, raw, options));
  }
  return values;
}

function validateValue(
  declaration: InstallationSettingDeclaration,
  raw: unknown,
  options: { canEncrypt: boolean },
): InstallationSettingValue | null {
  if (raw === null) return null;
  const invalid = (message: string, details: Record<string, unknown> = {}) =>
    new InstallationSettingWriteError('installation_setting_invalid', declaration.key, message, details);
  switch (declaration.type) {
    case 'integer':
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < declaration.min || raw > declaration.max) {
        throw invalid(`${declaration.key} must be a whole number from ${declaration.min} to ${declaration.max}.`, {
          min: declaration.min,
          max: declaration.max,
        });
      }
      return raw;
    case 'boolean':
      if (typeof raw !== 'boolean') throw invalid(`${declaration.key} must be true or false.`);
      return raw;
    case 'string': {
      if (typeof raw !== 'string') throw invalid(`${declaration.key} must be text.`);
      const value = raw.trim();
      if (value.length > declaration.maxLength) {
        throw invalid(`${declaration.key} must be at most ${declaration.maxLength} characters.`, { max_length: declaration.maxLength });
      }
      return value === '' ? null : value;
    }
    case 'secret': {
      if (typeof raw !== 'string') throw invalid(`${declaration.key} must be text.`);
      const value = raw.trim();
      if (value === '') return null;
      if (!options.canEncrypt) {
        throw new InstallationSettingWriteError(
          'settings_encryption_unavailable',
          declaration.key,
          'Secrets cannot be stored on this installation: the encryption key is not set.',
        );
      }
      return value;
    }
  }
}
