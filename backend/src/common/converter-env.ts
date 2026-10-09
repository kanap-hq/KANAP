/**
 * The environment of the document converters the API runs (pandoc, and Typst through it,
 * Inkscape, `which`): built explicitly, never inherited. The tools get the search path and the
 * locale of the API, and their home, temporary, cache and configuration folders point at a
 * dedicated empty folder inside the temporary folder of the call, apart from the input files and
 * from the media pandoc writes. It goes away with the folder of the call. No other variable of
 * the API process reaches them.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Variables copied from the API process when it has them. */
export const CONVERTER_INHERITED_VARIABLES = ['PATH', 'LANG', 'LC_ALL', 'LC_COLLATE', 'CHARSET'] as const;

/** Variables set to the tool folder of the call. */
export const CONVERTER_FOLDER_VARIABLES = ['HOME', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'] as const;

/** Name of the tool folder, created inside the temporary folder of the call. */
export const CONVERTER_HOME_FOLDER = '.tool-home';

/** The tool folder of a call folder. */
export function converterHome(callDir: string): string {
  return path.join(callDir, CONVERTER_HOME_FOLDER);
}

/** Creates the tool folder of the call when missing and returns the environment of the tools. */
export async function converterEnv(callDir: string, parent: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
  const home = converterHome(callDir);
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = {};
  for (const key of CONVERTER_INHERITED_VARIABLES) {
    const value = parent[key];
    if (value !== undefined && value !== '') env[key] = value;
  }
  for (const key of CONVERTER_FOLDER_VARIABLES) {
    env[key] = home;
  }
  return env;
}
