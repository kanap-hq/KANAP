import { PRODUCT_NAME, workspaceDisplayName } from '../config/product';

/**
 * The web app manifest of a workspace (`GET /api/public/manifest.webmanifest`, linked from
 * `frontend/index.html`): an installed app takes the organisation name. The addresses are paths of
 * the site the app is served from, the origin of the page that links the manifest.
 */
export function buildWebAppManifest(tenantName: string | null | undefined) {
  const name = workspaceDisplayName(tenantName);
  return {
    name,
    short_name: name,
    description: `${PRODUCT_NAME} - IT Department Management`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1A6B7A',
    orientation: 'any',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Its own file: a maskable icon keeps the symbol inside the safe zone the launcher may crop to.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
