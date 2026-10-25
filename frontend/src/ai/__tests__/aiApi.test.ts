import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from '../aiApi';

const encoder = new TextEncoder();

function createReader(chunks: string[]) {
  let index = 0;
  return {
    read: vi.fn(async () => {
      if (index >= chunks.length) {
        return { done: true, value: undefined };
      }
      const value = encoder.encode(chunks[index++]);
      return { done: false, value };
    }),
    releaseLock: vi.fn(),
  };
}

describe('streamChat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses NDJSON events across chunk boundaries', async () => {
    const reader = createReader([
      '{"type":"conversation","id":"conv-1","title":"Hello"}\n{"type":"text_delta","text":"hel',
      'lo"}\n',
    ]);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => reader,
      },
    })));

    const events: unknown[] = [];
    for await (const event of streamChat({ message: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'conversation', id: 'conv-1', title: 'Hello' },
      { type: 'text_delta', text: 'hello' },
    ]);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('sends the time zone the chat provides', async () => {
    const reader = createReader(['{"type":"done"}\n']);
    let sentBody: any = null;

    vi.stubGlobal('fetch', vi.fn(async (_url: any, init: any) => {
      sentBody = JSON.parse(init.body);
      return {
        ok: true,
        body: {
          getReader: () => reader,
        },
      };
    }));

    for await (const _event of streamChat({ message: 'hello', time_zone: 'Europe/Paris' })) {
      // drain the stream
    }

    expect(sentBody).toMatchObject({ message: 'hello', time_zone: 'Europe/Paris' });
  });

  it('fails closed when the NDJSON buffer grows beyond the safety limit', async () => {
    const reader = createReader(['a'.repeat(1_048_577)]);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => reader,
      },
    })));

    const iterator = streamChat({ message: 'overflow' });
    await expect(iterator.next()).rejects.toThrow('Stream buffer exceeded the maximum allowed size.');
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('skips malformed NDJSON lines and continues parsing later events', async () => {
    const reader = createReader([
      '{"type":"conversation","id":"conv-1","title":"Hello"}\n',
      'not-json\n{"type":"done"}\n',
    ]);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => reader,
      },
    })));

    const events: unknown[] = [];
    for await (const event of streamChat({ message: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'conversation', id: 'conv-1', title: 'Hello' },
      { type: 'done' },
    ]);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('propagates reader failures after releasing the stream lock', async () => {
    const reader = {
      read: vi.fn(async () => {
        throw new Error('socket lost');
      }),
      releaseLock: vi.fn(),
    };

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => reader,
      },
    })));

    const iterator = streamChat({ message: 'hello' });
    await expect(iterator.next()).rejects.toThrow('socket lost');
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});
