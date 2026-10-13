import { ArrayMaxSize, IsArray, IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** A link is sent to 20 recipients at most at a time, people and addresses together. */
export const SHARE_MAX_RECIPIENTS = 20;
/** Length limit of the personal message added to the e-mail. */
export const SHARE_MESSAGE_MAX_LENGTH = 2000;

export class ShareItemDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SHARE_MAX_RECIPIENTS)
  @IsUUID('all', { each: true })
  recipient_user_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SHARE_MAX_RECIPIENTS)
  @IsEmail({}, { each: true })
  recipient_emails?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(SHARE_MESSAGE_MAX_LENGTH)
  message?: string;
}
