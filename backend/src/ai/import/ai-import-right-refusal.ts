import type { PermissionLevel, Resource } from '../../permissions/permissions.service';
import { moduleRightRequired } from '../../auth/module-right-required';
import { ForbiddenException } from '@nestjs/common';
import { aiPermissionLevelLabel, aiResourceLabel } from '../ai-role-labels';
import type { AiScreenLanguage } from '../ai-unread-families';

/**
 * One refusal for every import the person may not run. The code stays
 * `MODULE_RIGHT_REQUIRED`: the screen already translates it with the words of Admin › Roles.
 * The message is what the model reads. It is English, as every tool result is, and the right's
 * name is the one that screen shows in the person's language. The model names that right, points
 * at someone who has it or at the screen, and creates no row of the file.
 */
export function importRightRefusal(
  resource: string,
  level: PermissionLevel,
  language: AiScreenLanguage,
): ForbiddenException {
  const moduleName = aiResourceLabel(resource as Resource, language);
  if (!moduleName) {
    throw new Error(`Import right has no name on Admin › Roles: ${resource}`);
  }
  const levelName = aiPermissionLevelLabel(level, language);
  const message = `Import refused: the missing right is "${levelName}" on "${moduleName}", as Admin › Roles names it. `
    + 'Tell the person that right in those words. Suggest they ask a person who has it, or import the file on the screen if they have the right there, and stop. '
    + 'Create no row of the file, and do not offer to create its rows one by one.';
  return moduleRightRequired(resource, level, message);
}

/** A module-right refusal for this import's own module, not for Kad's write side or another check. */
export function isImportModuleRefusal(error: unknown, resource: string): boolean {
  if (!(error instanceof ForbiddenException)) return false;
  const body = error.getResponse();
  if (!body || typeof body !== 'object') return false;
  const coded = body as { code?: unknown; params?: { resource?: unknown } };
  return coded.code === 'MODULE_RIGHT_REQUIRED' && coded.params?.resource === resource;
}
