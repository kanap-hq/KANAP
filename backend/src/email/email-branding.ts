import * as fs from 'fs';
import * as path from 'path';
import { StorageService } from '../common/storage/storage.service';
import { organisationName as chosenOrganisationName } from '../config/product';

export interface EmailBranding {
  primaryColor: string;
  logoBuffer: Buffer;
  logoContentType: string;
  logoCid: string;
  /** True when `logoBuffer` is the tenant's own logo, false for the product logo. */
  hasTenantLogo: boolean;
  /** The workspace's organisation name, null when none was chosen (`config/product.ts`). */
  organisationName?: string | null;
}

export const DEFAULT_EMAIL_PRIMARY_COLOR = '#1A6B7A';
const LOGO_CID = 'kanap-branding-logo';

let cachedDefaultLogo: Buffer | null = null;
let didSearchDefaultLogo = false;

function getDefaultLogo(): Buffer {
  if (cachedDefaultLogo) return cachedDefaultLogo;

  if (didSearchDefaultLogo) return Buffer.alloc(0);
  didSearchDefaultLogo = true;

  const candidates = [
    path.join(__dirname, 'assets', 'kadratis-logo.png'),
    path.join(process.cwd(), 'dist', 'email', 'assets', 'kadratis-logo.png'),
    path.join(process.cwd(), 'src', 'email', 'assets', 'kadratis-logo.png'),
  ];

  for (const candidate of candidates) {
    try {
      cachedDefaultLogo = fs.readFileSync(candidate);
      return cachedDefaultLogo;
    } catch {
      // Try the next known runtime/layout path.
    }
  }

  cachedDefaultLogo = Buffer.alloc(0);
  return cachedDefaultLogo;
}

export function getDefaultEmailBranding(): EmailBranding {
  return {
    primaryColor: DEFAULT_EMAIL_PRIMARY_COLOR,
    logoBuffer: getDefaultLogo(),
    logoContentType: 'image/png',
    logoCid: LOGO_CID,
    hasTenantLogo: false,
    organisationName: null,
  };
}

/**
 * Resolve email branding for a tenant.
 * If branding has a custom logo, loads it from S3.
 * Falls back to the product defaults. `tenantName` gives the organisation name.
 */
export async function resolveEmailBranding(
  branding: { logo_storage_path?: string; primary_color_light?: string | null } | null | undefined,
  storage: StorageService,
  tenantName?: string | null,
): Promise<EmailBranding> {
  const organisationName = chosenOrganisationName(tenantName);
  if (!branding) return { ...getDefaultEmailBranding(), organisationName };

  const primaryColor = branding.primary_color_light || DEFAULT_EMAIL_PRIMARY_COLOR;

  if (branding.logo_storage_path) {
    try {
      const obj = await storage.getObjectStream(branding.logo_storage_path);
      const chunks: Buffer[] = [];
      for await (const chunk of obj.stream as any) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const logoBuffer = Buffer.concat(chunks);
      if (logoBuffer.length > 0) {
        return {
          primaryColor,
          logoBuffer,
          logoContentType: obj.contentType || 'image/png',
          logoCid: LOGO_CID,
          hasTenantLogo: true,
          organisationName,
        };
      }
    } catch {
      // Fall through to default logo
    }
  }

  // Tenant may have a custom color but no logo (or logo load failed)
  return {
    primaryColor,
    logoBuffer: getDefaultLogo(),
    logoContentType: 'image/png',
    logoCid: LOGO_CID,
    hasTenantLogo: false,
    organisationName,
  };
}

/**
 * The e-mail branding of a tenant: its logo, colour and organisation name. `query` runs one
 * statement (a DataSource or an EntityManager); any failure falls back to the product defaults.
 */
export async function loadTenantEmailBranding(
  query: (sql: string, params: unknown[]) => Promise<any>,
  storage: StorageService,
  tenantId: string,
): Promise<EmailBranding> {
  let tenantName: string | null = null;
  try {
    const rows = await query('SELECT name, branding FROM tenants WHERE id = $1', [tenantId]);
    tenantName = rows?.[0]?.name ?? null;
    return await resolveEmailBranding(rows?.[0]?.branding, storage, tenantName);
  } catch {
    return { ...getDefaultEmailBranding(), organisationName: chosenOrganisationName(tenantName) };
  }
}
