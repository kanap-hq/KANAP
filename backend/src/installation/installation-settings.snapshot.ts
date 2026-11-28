import { INSTALLATION_DOMAINS } from './installation-domains';
import {
  installationDeploymentMode,
  InstallationDomain,
  InstallationFeature,
  InstallationSettingValue,
  ResolvedDomain,
  resolveDomain,
} from './installation-settings';

/**
 * What one process knows of the installation settings stored in the database: one row per domain
 * (a secret decrypted), loaded before the API listens and refreshed every 30 seconds by
 * `InstallationSettingsService`, and by the process that answers a write once its response is sent
 * (the transaction has committed): the snapshot only ever holds committed rows. The reading sites resolve
 * synchronously against it; the file is read at each resolution. Without a load (a spec, a script)
 * the database counts as empty: the file, then the default.
 *
 * The live switches of `Features` (decision I3): at each refresh the snapshot recomputes the
 * switches of a domain and writes a field only when its resolved value changed since the snapshot
 * last set it. At load `config/features.ts` takes the value with an empty database. A spec that
 * sets a field keeps it until the resolved value itself changes.
 */
export class InstallationSettingsSnapshot {
  private readonly rows = new Map<string, Record<string, unknown> | null>();
  private readonly features = new Map<string, boolean>();
  private reads = 0;
  /** By domain, the number of the read whose row the snapshot holds. */
  private readonly kept = new Map<string, number>();

  /** Numbers a read of the database, in the order the reads begin. */
  beginRead(): number {
    this.reads += 1;
    return this.reads;
  }

  /**
   * Keeps the row a read found, unless the row of a read begun after it is already kept: a
   * refresh begun before a commit that ends after the refresh following the commit never brings
   * the former row back. Without a read number the row counts as the latest read. Returns whether
   * the row is kept.
   */
  setRow(domain: string, row: Record<string, unknown> | null, read: number = this.beginRead()): boolean {
    if (read < (this.kept.get(domain) ?? 0)) return false;
    this.kept.set(domain, read);
    this.rows.set(domain, row ? { ...row } : null);
    return true;
  }

  resolve(domain: InstallationDomain, env: NodeJS.ProcessEnv = process.env): ResolvedDomain {
    return resolveDomain(domain, this.rows.get(domain.name) ?? null, env);
  }

  value(domain: InstallationDomain, key: string): InstallationSettingValue | null {
    return this.resolve(domain).get(key)?.value ?? null;
  }

  private computeFeatures(domain: InstallationDomain): Partial<Record<InstallationFeature, boolean>> {
    if (!domain.features) return {};
    const resolved = this.resolve(domain);
    return domain.features((key) => resolved.get(key)?.value ?? null, installationDeploymentMode());
  }

  /** The switches of every domain with an empty database, remembered as set (config/features.ts). */
  featuresAtLoad(): Partial<Record<InstallationFeature, boolean>> {
    const all: Partial<Record<InstallationFeature, boolean>> = {};
    for (const domain of INSTALLATION_DOMAINS) {
      const empty = resolveDomain(domain, null);
      const values = domain.features?.((key) => empty.get(key)?.value ?? null, installationDeploymentMode()) ?? {};
      for (const [name, value] of Object.entries(values)) {
        this.features.set(name, value === true);
        all[name as InstallationFeature] = value === true;
      }
    }
    return all;
  }

  /** Writes the switches of the domain whose resolved value changed; returns their names. */
  applyFeatures(domain: InstallationDomain, target: Record<string, unknown>): string[] {
    const changed: string[] = [];
    for (const [name, value] of Object.entries(this.computeFeatures(domain))) {
      const next = value === true;
      if (this.features.get(name) === next) continue;
      this.features.set(name, next);
      target[name] = next;
      changed.push(name);
    }
    return changed;
  }
}

/** The snapshot of this process, read by the reading sites. */
export const installationSettingsSnapshot = new InstallationSettingsSnapshot();
