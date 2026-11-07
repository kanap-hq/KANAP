/**
 * The names the application shows. Not configurable: one value per version, the same in the cloud
 * and on-premise. The frontend repeats both constants (`frontend/src/config/product.ts`).
 */

/** The product: what a workspace runs on ("Powered by …", "Acme via …", the assistant's platform). */
export const PRODUCT_NAME = 'KANAP';

/** The company that publishes the product: publisher, legal mentions, support, copyright. */
export const COMPANY_NAME = 'KANAP';

/** The organisation name an on-premise workspace gets when `DEFAULT_TENANT_NAME` is not set. */
export const DEFAULT_ORGANISATION_NAME = 'My Organization';

/**
 * The organisation name a workspace shows (`tenants.name`, set in Admin > Branding), or null when
 * none was chosen: empty, or still the on-premise default.
 */
export function organisationName(name: string | null | undefined): string | null {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text || text === DEFAULT_ORGANISATION_NAME) return null;
  return text;
}

/** The name that identifies a workspace: its organisation name, else the product name. */
export function workspaceDisplayName(name: string | null | undefined): string {
  return organisationName(name) ?? PRODUCT_NAME;
}
