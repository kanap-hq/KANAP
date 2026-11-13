import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SHARE_MAX_RECIPIENTS, ShareItemDto } from './dto/share-item.dto';

function uniqueIgnoringCase(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

/**
 * The recipients of a "Send link" (every object's share route): user ids and e-mail addresses,
 * each list without duplicates (case ignored). 400 without any recipient, and 400
 * `SHARE_TOO_MANY_RECIPIENTS` past `SHARE_MAX_RECIPIENTS` people and addresses together.
 */
export function shareRecipientsOf(dto: ShareItemDto | null | undefined): { userIds: string[]; rawEmails: string[] } {
  const userIds = uniqueIgnoringCase(dto?.recipient_user_ids ?? []);
  const rawEmails = uniqueIgnoringCase(dto?.recipient_emails ?? []);
  if (userIds.length === 0 && rawEmails.length === 0) {
    throw new BadRequestException('At least one recipient is required');
  }
  if (userIds.length + rawEmails.length > SHARE_MAX_RECIPIENTS) {
    throw new BadRequestException({
      code: 'SHARE_TOO_MANY_RECIPIENTS',
      message: `A link can be sent to ${SHARE_MAX_RECIPIENTS} recipients at most.`,
    });
  }
  return { userIds, rawEmails };
}

/**
 * The number of recipients of a share request body, read as the route reads it (the global
 * validation, then `shareRecipientsOf`), or 0 for a body the route refuses. For the recipient
 * budgets of `ShareRateLimitGuard`, which runs before the validation.
 */
export function shareRecipientCount(body: unknown): number {
  const dto = plainToInstance(ShareItemDto, body && typeof body === 'object' ? body : {});
  if (validateSync(dto, { whitelist: true }).length > 0) return 0;
  try {
    const { userIds, rawEmails } = shareRecipientsOf(dto);
    return userIds.length + rawEmails.length;
  } catch {
    return 0;
  }
}
