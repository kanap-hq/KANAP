import { BadRequestException } from '@nestjs/common';
import { SHARE_MAX_RECIPIENTS, type ShareItemDto } from './dto/share-item.dto';

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
