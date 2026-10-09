import * as nodemailer from 'nodemailer';
import type { Attachment } from 'nodemailer/lib/mailer';
import type { SmtpConfig } from '../email-config';
import type { EmailAttachment, SendEmailOptions } from '../email.types';
import {
  buildExponentialRetryDelay,
  type DeliveryError,
  type EmailRetryConfig,
  type EmailTransport,
} from './email-transport.interface';

type SmtpError = DeliveryError & { response?: string; command?: string };

function mapAttachments(attachments?: EmailAttachment[]): Attachment[] | undefined {
  return attachments?.map((attachment) => {
    const mapped: Attachment = {
      filename: attachment.filename,
      contentType: attachment.contentType,
      cid: attachment.contentId,
      path: attachment.path,
    };

    if (attachment.content !== undefined) {
      mapped.content = attachment.content as Attachment['content'];
    }
    if (attachment.encoding) {
      mapped.encoding = attachment.encoding;
    }
    return mapped;
  });
}

function isTransientSmtpError(err: SmtpError): boolean {
  if (typeof err.responseCode === 'number') {
    return err.responseCode >= 400 && err.responseCode < 500;
  }

  const details = `${err.code || ''} ${err.command || ''} ${err.response || ''} ${err.message || ''}`.toLowerCase();
  return details.includes('4.3.2')
    || details.includes('concurrent connections limit exceeded')
    || details.includes('throttl')
    || details.includes('temporar')
    || details.includes('try again later');
}

export class SmtpTransport implements EmailTransport {
  readonly name = 'smtp';
  readonly defaultMinIntervalMs = 2_100;
  private readonly transporter;
  private readonly defaultFrom: string;

  constructor(config: SmtpConfig) {
    this.defaultFrom = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user && config.password
        ? {
          user: config.user,
          pass: config.password,
        }
        : undefined,
      // Every attachment is built in memory (logo, inline images): nothing is read from disk or a URL.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(options: SendEmailOptions): Promise<void> {
    await this.transporter.sendMail({
      from: options.from ?? this.defaultFrom,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      headers: options.headers,
      attachments: mapAttachments(options.attachments),
    });
  }

  getRetryDelayMs(err: DeliveryError, attempt: number, config: EmailRetryConfig): number | null {
    if (!isTransientSmtpError(err as SmtpError)) return null;
    return buildExponentialRetryDelay(attempt, config);
  }
}
