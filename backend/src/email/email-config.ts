import { parseDeploymentMode } from '../common/deployment-mode';
import { parseBoolean } from '../common/env';

const DEFAULT_RESEND_FROM = 'KANAP <no-reply@kanap.net>';

function readTrimmedEnv(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    return null;
  }
  return value.trim();
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`FATAL: ${name} must be a positive integer`);
  }
  return parsed;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
  passwordEnvName: 'SMTP_PASSWORD' | 'SMTP_PASS' | null;
}

export function isSingleTenantEmailDeployment(): boolean {
  return parseDeploymentMode(process.env.DEPLOYMENT_MODE) === 'single-tenant';
}

export function hasConfiguredResendTransport(): boolean {
  return !!readTrimmedEnv('RESEND_API_KEY');
}

export function hasAnySmtpEnvConfigured(): boolean {
  return [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_PASS',
    'SMTP_FROM',
  ].some((name) => readTrimmedEnv(name) !== null);
}

export function hasConfiguredSmtpTransport(): boolean {
  return !!readTrimmedEnv('SMTP_HOST') && !!readTrimmedEnv('SMTP_FROM');
}

export function hasConfiguredEmailTransport(): boolean {
  if (isSingleTenantEmailDeployment()) {
    return hasConfiguredSmtpTransport() || hasConfiguredResendTransport();
  }
  return hasConfiguredResendTransport();
}

export function readResendApiKey(): string | null {
  return readTrimmedEnv('RESEND_API_KEY');
}

export function readResendFromEmail(): string {
  return readTrimmedEnv('RESEND_FROM_EMAIL') ?? DEFAULT_RESEND_FROM;
}

export function readSmtpConfig(): SmtpConfig | null {
  const host = readTrimmedEnv('SMTP_HOST');
  const from = readTrimmedEnv('SMTP_FROM');
  if (!host || !from) {
    return null;
  }

  const portRaw = readTrimmedEnv('SMTP_PORT');
  const port = portRaw ? parsePositiveInt(portRaw, 'SMTP_PORT') : 587;
  const secureRaw = readTrimmedEnv('SMTP_SECURE');
  const secure = secureRaw === null ? port === 465 : parseBoolean(secureRaw);
  const user = readTrimmedEnv('SMTP_USER');
  const password = readTrimmedEnv('SMTP_PASSWORD') ?? readTrimmedEnv('SMTP_PASS');
  const passwordEnvName = readTrimmedEnv('SMTP_PASSWORD')
    ? 'SMTP_PASSWORD'
    : (readTrimmedEnv('SMTP_PASS') ? 'SMTP_PASS' : null);

  if ((user && !password) || (!user && password)) {
    throw new Error('FATAL: SMTP_USER and SMTP_PASSWORD must be set together');
  }

  return {
    host,
    port,
    secure,
    user,
    password,
    from,
    passwordEnvName,
  };
}

export function describeSmtpConfigurationIssue(): string | null {
  if (!hasAnySmtpEnvConfigured()) {
    return null;
  }
  if (!readTrimmedEnv('SMTP_HOST')) {
    return 'SMTP_HOST is required.';
  }
  if (!readTrimmedEnv('SMTP_FROM')) {
    return 'SMTP_FROM is required.';
  }

  const user = readTrimmedEnv('SMTP_USER');
  const password = readTrimmedEnv('SMTP_PASSWORD') ?? readTrimmedEnv('SMTP_PASS');
  if ((user && !password) || (!user && password)) {
    return 'SMTP_USER and SMTP_PASSWORD must be set together.';
  }

  const portRaw = readTrimmedEnv('SMTP_PORT');
  if (portRaw) {
    try {
      parsePositiveInt(portRaw, 'SMTP_PORT');
    } catch (error) {
      return error instanceof Error ? error.message.replace(/^FATAL:\s*/, '') : 'SMTP_PORT is invalid.';
    }
  }

  return null;
}

export function buildDisabledEmailMessage(): string {
  if (isSingleTenantEmailDeployment()) {
    return 'Email service is not configured. In single-tenant mode set SMTP_HOST and SMTP_FROM, or set RESEND_API_KEY.';
  }
  return 'Email service is not configured. Set RESEND_API_KEY.';
}
