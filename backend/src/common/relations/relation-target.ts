import { BadRequestException } from '@nestjs/common';

/**
 * A uuid, any version. The same check the Relations tabs used to copy
 * (`applications-relations.service.ts`, `technology-rows.ts`).
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The target id of one link, lower case, or 400 `Invalid id.` */
export function parseTargetId(value: unknown): string {
  const id = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new BadRequestException('Invalid id.');
  return id;
}
