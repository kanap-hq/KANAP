import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SmtpConfig } from '../email-config';
import type { DeliveryError, EmailRetryConfig } from '../transports/email-transport.interface';
import { SmtpTransport } from '../transports/smtp.transport';

interface SmtpSession {
  commands: string[];
  auth?: string;
  data?: string;
}

interface FakeSmtpServer {
  port: number;
  sessions: SmtpSession[];
  close(): Promise<void>;
}

const RETRY: EmailRetryConfig = { baseMs: 1_000, maxMs: 10_000, jitterMs: 0 };

/** Minimal SMTP receiver: accepts AUTH PLAIN and records every command and message body. */
async function startFakeSmtpServer(): Promise<FakeSmtpServer> {
  const sessions: SmtpSession[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    const session: SmtpSession = { commands: [] };
    sessions.push(session);
    let buffer = '';
    let inData = false;
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          session.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write('250 OK queued\r\n');
          continue;
        }
        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd < 0) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        session.commands.push(line);
        if (/^EHLO/i.test(line)) {
          socket.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        } else if (/^AUTH PLAIN /i.test(line)) {
          session.auth = Buffer.from(line.split(' ')[2], 'base64').toString('utf8');
          socket.write('235 Authentication successful\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.end('221 Bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    sessions,
    close: () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

async function unusedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function smtpConfig(port: number, overrides: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    host: '127.0.0.1',
    port,
    secure: false,
    user: 'mailer',
    password: 'secret',
    from: 'KANAP <no-reply@example.test>',
    passwordEnvName: 'SMTP_PASSWORD',
    ...overrides,
  };
}

/** Decodes RFC 2047 encoded words (Q or B) so the assertion does not depend on the chosen encoding. */
function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_match, _charset: string, encoding: string, text: string) => {
      if (encoding.toUpperCase() === 'B') {
        return Buffer.from(text, 'base64').toString('utf8');
      }
      const bytes = text
        .replace(/_/g, ' ')
        .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      return Buffer.from(bytes, 'latin1').toString('utf8');
    });
}

function headerValue(message: string, name: string): string | undefined {
  const headerBlock = message.split('\r\n\r\n')[0];
  const unfolded = headerBlock.replace(/\r\n[ \t]+/g, ' ');
  const line = unfolded.split('\r\n').find((candidate) => candidate.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line?.slice(name.length + 1).trim();
}

function mimePart(message: string, marker: RegExp): string {
  const part = message.split(/\r\n--[^\r\n]+/).find((candidate) => marker.test(candidate));
  assert.ok(part, `MIME part matching ${marker} is present`);
  return part as string;
}

async function testSendsCompleteMessage() {
  const server = await startFakeSmtpServer();
  try {
    const transport = new SmtpTransport(smtpConfig(server.port));
    await transport.send({
      to: ['first@example.test', 'second@example.test'],
      subject: 'Sujet été à vérifier',
      html: '<p>Bonjour <img src="cid:kanap-logo"></p>',
      text: 'Bonjour',
      replyTo: 'reply@example.test',
      headers: { 'X-Kanap-Test': 'smtp-spec' },
      attachments: [
        {
          filename: 'logo.png',
          content: Buffer.from('PNGDATA').toString('base64'),
          encoding: 'base64',
          contentType: 'image/png',
          contentId: 'kanap-logo',
        },
        {
          filename: 'notes.txt',
          content: Buffer.from('hello'),
          contentType: 'text/plain',
        },
      ],
    });

    assert.equal(server.sessions.length, 1);
    const session = server.sessions[0];
    assert.equal(session.auth, '\0mailer\0secret');
    const envelope = session.commands.filter((command) => /^(MAIL FROM|RCPT TO)/i.test(command));
    assert.deepEqual(envelope, [
      'MAIL FROM:<no-reply@example.test>',
      'RCPT TO:<first@example.test>',
      'RCPT TO:<second@example.test>',
    ]);

    const message = session.data;
    assert.ok(message, 'the server received a message body');
    assert.equal(headerValue(message, 'From'), 'KANAP <no-reply@example.test>');
    assert.equal(headerValue(message, 'To'), 'first@example.test, second@example.test');
    assert.equal(headerValue(message, 'Reply-To'), 'reply@example.test');
    assert.equal(headerValue(message, 'X-Kanap-Test'), 'smtp-spec');
    assert.equal(decodeEncodedWords(headerValue(message, 'Subject') ?? ''), 'Sujet été à vérifier');

    assert.match(mimePart(message, /Content-Type: text\/plain; charset=utf-8/i), /\r\n\r\nBonjour$/);
    assert.match(
      mimePart(message, /Content-Type: text\/html; charset=utf-8/i),
      /<p>Bonjour <img src="cid:kanap-logo"><\/p>/,
    );

    const logo = mimePart(message, /Content-ID: <kanap-logo>/i);
    assert.match(logo, /Content-Type: image\/png/i);
    assert.match(logo, /Content-Disposition: inline; filename=logo\.png/i);
    assert.equal(Buffer.from(logo.split('\r\n\r\n')[1].replace(/\s+/g, ''), 'base64').toString(), 'PNGDATA');

    const notes = mimePart(message, /Content-Disposition: attachment; filename=notes\.txt/i);
    assert.match(notes, /Content-Type: text\/plain/i);
    assert.match(notes, /Content-Transfer-Encoding: base64/i);
    assert.equal(Buffer.from(notes.split('\r\n\r\n')[1].replace(/\s+/g, ''), 'base64').toString(), 'hello');
  } finally {
    await server.close();
  }
}

async function testSendsWithoutAuthWhenNoCredentials() {
  const server = await startFakeSmtpServer();
  try {
    const transport = new SmtpTransport(smtpConfig(server.port, { user: null, password: null, passwordEnvName: null }));
    await transport.send({ to: 'only@example.test', subject: 'Plain', html: '<p>Plain</p>', from: 'Other <other@example.test>' });

    const session = server.sessions[0];
    assert.equal(session.auth, undefined);
    assert.ok(!session.commands.some((command) => /^AUTH/i.test(command)));
    assert.ok(session.commands.includes('MAIL FROM:<other@example.test>'));
    assert.equal(headerValue(session.data ?? '', 'From'), 'Other <other@example.test>');
  } finally {
    await server.close();
  }
}

async function testTransportReadsNoAttachmentFromFileOrUrl() {
  const transport = new SmtpTransport(smtpConfig(25));
  const options = (transport as unknown as { transporter: { options: Record<string, unknown> } }).transporter.options;
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);

  const server = await startFakeSmtpServer();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanap-smtp-spec-'));
  const filePath = path.join(dir, 'local.txt');
  await fs.writeFile(filePath, 'LOCAL-FILE-CONTENT');
  try {
    const sender = new SmtpTransport(smtpConfig(server.port));
    await assert.rejects(
      sender.send({ to: 'a@example.test', subject: 'File', html: '<p>x</p>', attachments: [{ filename: 'local.txt', path: filePath }] }),
      (err: DeliveryError) => /file access rejected/i.test(err.message),
    );
    const urlPort = await unusedPort();
    await assert.rejects(
      sender.send({
        to: 'a@example.test',
        subject: 'Url',
        html: '<p>x</p>',
        attachments: [{ filename: 'remote.txt', path: `http://127.0.0.1:${urlPort}/remote.txt` }],
      }),
      (err: DeliveryError) => /url access rejected/i.test(err.message),
    );
    for (const session of server.sessions) {
      assert.ok(!(session.data ?? '').includes(Buffer.from('LOCAL-FILE-CONTENT').toString('base64')));
    }
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testTransientErrorClassification() {
  const transport = new SmtpTransport(smtpConfig(25));
  const error = (fields: Partial<DeliveryError & { response: string; command: string }>) =>
    Object.assign(new Error(fields.message ?? 'failure'), fields) as DeliveryError;

  assert.equal(transport.getRetryDelayMs(error({ responseCode: 421 }), 1, RETRY), 2_000);
  assert.equal(transport.getRetryDelayMs(error({ responseCode: 451 }), 3, RETRY), 8_000);
  assert.equal(transport.getRetryDelayMs(error({ responseCode: 452 }), 5, RETRY), 10_000);
  assert.equal(transport.getRetryDelayMs(error({ responseCode: 550 }), 1, RETRY), null);
  assert.equal(transport.getRetryDelayMs(error({ responseCode: 535 }), 1, RETRY), null);
  assert.equal(transport.getRetryDelayMs(error({ message: '4.3.2 Service not available' }), 1, RETRY), 2_000);
  assert.equal(transport.getRetryDelayMs(error({ response: 'Concurrent connections limit exceeded' }), 1, RETRY), 2_000);
  assert.equal(transport.getRetryDelayMs(error({ message: 'Message throttled' }), 1, RETRY), 2_000);
  assert.equal(transport.getRetryDelayMs(error({ message: 'Temporary failure, try again later' }), 1, RETRY), 2_000);
  assert.equal(transport.getRetryDelayMs(error({ message: 'Invalid login' }), 1, RETRY), null);

  const refused = new SmtpTransport(smtpConfig(await unusedPort(), { user: null, password: null, passwordEnvName: null }));
  let refusal: DeliveryError | null = null;
  try {
    await refused.send({ to: 'a@example.test', subject: 'Refused', html: '<p>x</p>' });
  } catch (err) {
    refusal = err as DeliveryError;
  }
  assert.ok(refusal, 'a refused connection rejects the send');
  assert.equal(refusal.code, 'ESOCKET');
  assert.equal(refused.getRetryDelayMs(refusal, 1, RETRY), null);
}

async function run() {
  await testSendsCompleteMessage();
  await testSendsWithoutAuthWhenNoCredentials();
  await testTransportReadsNoAttachmentFromFileOrUrl();
  await testTransientErrorClassification();
}

void run();
