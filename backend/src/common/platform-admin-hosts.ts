/**
 * `PLATFORM_ADMIN_HOST`: the hosts of the platform console (comma-separated, spaces and case
 * ignored). An environment served under several domains lists the console's host on each of them
 * (`platform-admin.kanap.net,platform-admin.example.com`). The first one is the address written
 * in links.
 */
export function parsePlatformAdminHosts(raw: string | null | undefined): string[] {
  const hosts = String(raw ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return [...new Set(hosts)];
}

export function platformAdminHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return parsePlatformAdminHosts(env.PLATFORM_ADMIN_HOST);
}
