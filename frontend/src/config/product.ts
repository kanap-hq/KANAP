/**
 * The names the application shows. Not configurable: one value per version, the same in the cloud
 * and on-premise. The backend holds the same constants (`backend/src/config/product.ts`).
 */

/** The product: what a workspace runs on. Shown when the workspace has no organisation name. */
export const PRODUCT_NAME = 'Kadratis';

/** The integrated AI agent: the chat, its menu and its settings. Written `{{agent}}` in the texts. */
export const AGENT_NAME = 'Kad';

/**
 * The product's symbol (`public/brand`) for a background of the given mode: in colour on a light
 * background, inverted on a dark one.
 */
export function productSymbolUrl(mode: 'light' | 'dark'): string {
  return mode === 'dark' ? '/brand/kadratis-symbole-inverse.svg' : '/brand/kadratis-symbole-couleur.svg';
}
