import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { GlpiService } from '../glpi/glpi.service';

function createService(glpiUrl = 'https://glpi.internal') {
  return new GlpiService(
    {
      find: async () => ({
        glpi_url: glpiUrl,
        glpi_user_token_encrypted: 'enc:user-token',
        glpi_app_token_encrypted: 'enc:app-token',
      }),
    } as any,
    {
      decrypt: (value: string) => value.replace(/^enc:/, ''),
    } as any,
  );
}

async function testInitSessionSendsJsonHeaders() {
  const service = createService();
  const originalFetch = global.fetch;
  let capturedHeaders: Headers | undefined;

  try {
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      // initSession now also calls getFullSession; capture the first (initSession) call's
      // headers so the auth-header assertions below check the initSession request.
      if (!capturedHeaders) capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ session_token: 'session-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const session = await service.initSession('tenant-1', {} as any);
    assert.equal(session.sessionToken, 'session-1');
    assert.equal(capturedHeaders?.get('accept'), 'application/json');
    assert.equal(capturedHeaders?.get('content-type'), 'application/json');
    assert.equal(capturedHeaders?.get('authorization'), 'user_token user-token');
    assert.equal(capturedHeaders?.get('app-token'), 'app-token');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testInitSessionExplainsHtmlResponse() {
  const service = createService();
  const originalFetch = global.fetch;

  try {
    global.fetch = (async () => new Response('<html><body>Login</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    })) as typeof fetch;

    await assert.rejects(
      () => service.initSession('tenant-1', {} as any),
      (error: any) => error instanceof BadRequestException
        && String(error.message || '').includes('GLPI returned HTML instead of JSON'),
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function testInitSessionNormalizesApiEndpointBaseUrl() {
  const service = createService('https://glpi.internal/helpdesk/apirest.php');
  const originalFetch = global.fetch;
  let requestedUrl = '';

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      // Capture the first (initSession) request; initSession now also calls getFullSession.
      if (!requestedUrl) requestedUrl = String(input);
      return new Response(JSON.stringify({ session_token: 'session-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await service.initSession('tenant-1', {} as any);
    assert.equal(requestedUrl, 'https://glpi.internal/helpdesk/apirest.php/initSession');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testConnectionNormalizesCopiedApiUrls() {
  const originalFetch = global.fetch;
  const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    for (const root of ['https://glpi.internal', 'https://glpi.internal/HelpDesk']) {
      for (const suffix of ['/apirest.php/initsession', '/apirest.php/initSession/', '/api.php/v1', '/api.php/v1/initSession/']) {
        for (const useOverride of [false, true]) {
          const configuredUrl = `${root}${suffix}?get_full_session=true#documentation`;
          const service = createService(useOverride ? 'https://unused.internal' : configuredUrl);
          const requests: { url: string; headers: Headers }[] = [];
          global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            requests.push({ url, headers: new Headers(init?.headers) });
            if (url === `${root}/apirest.php/initSession`) {
              return jsonResponse({ session_token: 'session-1' });
            }
            if (url === `${root}/apirest.php/getFullSession`) {
              return jsonResponse({ session: { glpiID: 42 } });
            }
            if (url === `${root}/apirest.php/killSession`) {
              return jsonResponse(true);
            }
            return new Response(JSON.stringify(['ERROR_SESSION_TOKEN_MISSING', 'Missing session token']), {
              status: 401,
              headers: { 'content-type': 'application/json' },
            });
          }) as typeof fetch;

          const result = await service.testConnection('tenant-1', useOverride ? { glpi_url: configuredUrl } : undefined, {} as any);
          assert.equal(result.ok, true, `${configuredUrl}: ${result.message}`);
          assert.deepEqual(requests.map(({ url }) => url), [
            `${root}/apirest.php/initSession`,
            `${root}/apirest.php/getFullSession`,
            `${root}/apirest.php/killSession`,
          ]);
          assert.equal(requests[0].headers.get('authorization'), 'user_token user-token');
          assert.equal(requests[0].headers.get('session-token'), null);
          for (const request of requests.slice(1)) {
            assert.equal(request.headers.get('session-token'), 'session-1');
            assert.equal(request.headers.get('authorization'), null);
          }
          for (const request of requests) {
            assert.equal(request.headers.get('app-token'), 'app-token');
          }
        }
      }
    }
  } finally {
    global.fetch = originalFetch;
  }
}

async function testFetchDocumentUsesDocumentApiDownloadForDocumentSendUrls() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  let requestedUrl = '';
  let capturedHeaders: Headers | undefined;

  try {
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(Buffer.from('image-bytes'), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-disposition': 'inline; filename="ticket-image.png"',
        },
      });
    }) as typeof fetch;

    const document = await service.fetchDocument(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      '/front/document.send.php?docid=41260&itemtype=Ticket&items_id=59925',
    );

    assert.equal(requestedUrl, 'https://glpi.internal/helpdesk/apirest.php/Document/41260?alt=media');
    assert.equal(capturedHeaders?.get('accept'), 'application/octet-stream');
    assert.equal(capturedHeaders?.get('session-token'), 'session-token');
    assert.equal(capturedHeaders?.get('app-token'), 'app-token');
    assert.equal(document.mimeType, 'image/png');
    assert.equal(document.filename, 'ticket-image.png');
    assert.equal(document.buffer.toString(), 'image-bytes');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testFetchDocumentRejectsCrossOriginTargets() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  let called = false;

  try {
    global.fetch = (async () => {
      called = true;
      return new Response('unexpected');
    }) as typeof fetch;

    await assert.rejects(
      () => service.fetchDocument(
        {
          baseUrl: 'https://glpi.internal/helpdesk/',
          sessionToken: 'session-token',
          appToken: 'app-token',
        },
        'https://evil.example/front/document.send.php?docid=9',
      ),
      (error: any) => error instanceof BadRequestException,
    );
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetTicketExtractsDescriptionImageTargets() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;

  try {
    global.fetch = (async () => new Response(JSON.stringify({
      id: 77,
      name: 'Screenshot in description',
      content: '<p>See screenshot</p><img src="/front/document.send.php?docid=991&amp;itemtype=Ticket" />',
      status: '1',
      priority: 3,
      urgency: '3',
      type: 1,
      entities_id: 1,
      itilcategories_id: 2,
      date: '2026-01-05 09:00:00',
      date_mod: '2026-01-05 09:10:00',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const ticket = await service.getTicket(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      77,
    );

    assert.deepEqual(ticket.image_targets, ['/front/document.send.php?docid=991&itemtype=Ticket']);
    assert.equal(ticket.content_html, '<p>See screenshot</p><img src="/front/document.send.php?docid=991&amp;itemtype=Ticket" />');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetTicketDecodesGlpi10SanitizedContentAndImages() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  const sanitizedContent = '&#60;div&#62;Localisation : Duppigheim / DL27&#60;/div&#62;'
    + '&#60;div&#62;Contact : WITTMANN Christophe&#60;/div&#62;'
    + '&#60;img src="/front/document.send.php?docid=5&#38;tickets_id=9" /&#62;';

  try {
    global.fetch = (async () => new Response(JSON.stringify({
      id: 78,
      name: 'Reparer R&#38;D &#60;PC&#62;',
      content: sanitizedContent,
      status: '1',
      priority: 3,
      urgency: '3',
      type: 1,
      date: '2026-01-05 09:00:00',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const ticket = await service.getTicket(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      78,
    );

    assert.equal(ticket.name, 'Reparer R&D <PC>');
    assert.equal(
      ticket.content_html,
      '<div>Localisation : Duppigheim / DL27</div><div>Contact : WITTMANN Christophe</div><img src="/front/document.send.php?docid=5&tickets_id=9" />',
    );
    assert.deepEqual(ticket.image_targets, ['/front/document.send.php?docid=5&tickets_id=9']);
    assert.doesNotMatch(JSON.stringify(ticket), /&#60;/);
    assert.doesNotMatch(JSON.stringify(ticket), /&#38;/);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetTicketLeavesEscapedPlainComparisonAtBoundary() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;

  try {
    global.fetch = (async () => new Response(JSON.stringify({
      id: 79,
      name: 'Plain comparison',
      content: 'Solde a &#60; b attendu',
      status: '1',
      priority: 3,
      urgency: '3',
      type: 1,
      date: '2026-01-05 09:00:00',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const ticket = await service.getTicket(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      79,
    );

    assert.equal(ticket.content_html, 'Solde a &#60; b attendu');
    assert.deepEqual(ticket.image_targets, []);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetTicketFollowupsPaginatesAndNormalizesNewestFirst() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('range=0-49')) {
        return new Response(JSON.stringify([
          {
            id: 10,
            itemtype: 'Ticket',
            items_id: 4523,
            content: '<p>Older public</p><img src="/front/document.send.php?docid=88&amp;itemtype=Ticket" />',
            users_id: { id: 101, name: 'Alice &#38; Technician' },
            users_id_editor: { id: 999, name: 'Editor' },
            date: '2026-01-02 10:00:00',
            date_mod: '2026-01-02 10:05:00',
            is_private: 0,
          },
          {
            id: 11,
            itemtype: 'Ticket',
            items_id: 4523,
            content: '<p>Private note</p>',
            user_name: 'Manager &#60;N2&#62;',
            date_creation: '2026-01-03 10:00:00',
            is_private: '1',
          },
        ]), {
          status: 206,
          headers: {
            'content-type': 'application/json',
            'content-range': '0-1/3',
          },
        });
      }

      return new Response(JSON.stringify([
        {
          id: 12,
          itemtype: 'Ticket',
          items_id: 4523,
          content: '<p>Newest public</p>',
          users_id: { id: 202, name: 'Bob Requester' },
          date_mod: '2026-01-04 10:00:00',
          is_private: false,
        },
      ]), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-range': '2-2/3',
        },
      });
    }) as typeof fetch;

    const followups = await service.getTicketFollowups(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      4523,
    );

    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0], /Ticket\/4523\/ITILFollowup/);
    assert.deepEqual(followups.map((item) => item.id), [12, 11, 10]);
    assert.equal(followups[0].author_label, 'Bob Requester');
    assert.equal(followups[0].author_id, 202);
    assert.equal(followups[1].is_private, true);
    assert.equal(followups[1].author_label, 'Manager <N2>');
    assert.equal(followups[2].author_label, 'Alice & Technician');
    assert.equal(followups[2].author_id, 101);
    assert.equal(followups[2].editor_id, 999);
    assert.equal(followups[2].updated_date, '2026-01-02 10:05:00');
    assert.equal(followups[2].content_html, '<p>Older public</p><img src="/front/document.send.php?docid=88&amp;itemtype=Ticket" />');
    assert.deepEqual(followups[2].image_targets, ['/front/document.send.php?docid=88&itemtype=Ticket']);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetTicketFollowupsDecodeGlpi10SanitizedContentAndImages() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  const sanitizedContent = '&#60;p&#62;Requester screenshot&#60;/p&#62;'
    + '&#60;img src="/front/document.send.php?docid=6&#38;tickets_id=9" /&#62;';

  try {
    global.fetch = (async () => new Response(JSON.stringify([
      {
        id: 13,
        itemtype: 'Ticket',
        items_id: 4523,
        content: sanitizedContent,
        users_id: { id: 202, name: 'Requester' },
        date: '2026-01-04 10:00:00',
        is_private: 0,
      },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const followups = await service.getTicketFollowups(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      4523,
    );

    assert.equal(followups.length, 1);
    assert.equal(
      followups[0].content_html,
      '<p>Requester screenshot</p><img src="/front/document.send.php?docid=6&tickets_id=9" />',
    );
    assert.deepEqual(followups[0].image_targets, ['/front/document.send.php?docid=6&tickets_id=9']);
    assert.doesNotMatch(JSON.stringify(followups[0]), /&#60;/);
    assert.doesNotMatch(JSON.stringify(followups[0]), /&#38;/);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetTicketUsersNormalizesRoles() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];

  try {
    // Real GLPI: expand_dropdowns=false gives the numeric users_id, expand_dropdowns=true
    // replaces it by the login string. Only the first read carries the user ids.
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      const expanded = url.includes('expand_dropdowns=true');
      const body = expanded
        ? [
            { id: 1, users_id: 'bob.requester', type: 1 },
            { id: 2, users_id: 'alice.technician', type: 2 },
            { id: 3, users_id: 'duty.manager', type: 3 },
            { id: 4, users_id: 'duty.manager', type: 3 },
          ]
        : [
            { id: 1, users_id: 202, type: 1 },
            { id: 2, users_id: 303, type: 2 },
            { id: 3, users_id: 404, type: 3 },
            { id: 4, users_id: 404, type: 3 },
          ];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const users = await service.getTicketUsers(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      4523,
    );

    assert.ok(requestedUrls.every((url) => /Ticket\/4523\/Ticket_User/.test(url)));
    assert.ok(requestedUrls.some((url) => url.includes('expand_dropdowns=false')));
    assert.ok(requestedUrls.some((url) => url.includes('expand_dropdowns=true')));
    assert.equal(users.length, 3);
    assert.deepEqual(users.map((item) => item.role), ['requester', 'assigned', 'observer']);
    assert.deepEqual(users.map((item) => item.user_id), [202, 303, 404]);
    assert.deepEqual(
      users.map((item) => item.user_label),
      ['bob.requester', 'alice.technician', 'duty.manager'],
    );
  } finally {
    global.fetch = originalFetch;
  }
}

// The expanded read is decoration only: if the GLPI profile cannot serve it, the
// associations must still come back with their ids so drift and idempotency work.
async function testGetTicketUsersKeepsIdsWhenExpandedReadFails() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('expand_dropdowns=true')) {
        return new Response(JSON.stringify({ ERROR: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([
        { id: 1, users_id: 202, type: 1 },
        { id: 2, users_id: 303, type: 2 },
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const users = await service.getTicketUsers(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      4523,
    );

    assert.equal(users.length, 2);
    assert.deepEqual(users.map((item) => item.user_id), [202, 303]);
    assert.deepEqual(users.map((item) => item.user_label), [null, null]);
    assert.deepEqual(users.map((item) => item.role), ['requester', 'assigned']);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testGetTicketFollowupsStopsOnDuplicatePageWhenRangeIsIgnored() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  let calls = 0;

  try {
    global.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify(
        Array.from({ length: 50 }, (_, index) => ({
          id: index + 1,
          content: `<p>Followup ${index + 1}</p>`,
          users_id: `User ${index + 1}`,
          date: `2026-01-01 10:${String(index).padStart(2, '0')}:00`,
          is_private: 0,
        })),
      ), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const followups = await service.getTicketFollowups(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: null,
      },
      4523,
    );

    assert.equal(calls, 2);
    assert.equal(followups.length, 50);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAddTicketFollowupUsesFixedPrivatePostEndpoint() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  let requestedUrl = '';
  let capturedMethod = '';
  let capturedHeaders: Headers | undefined;
  let capturedBody: any;

  try {
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      capturedMethod = String(init?.method || 'GET');
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ id: 987 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await service.addTicketFollowup(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      4523,
      'Private operator triage note.',
    );

    assert.equal(requestedUrl, 'https://glpi.internal/helpdesk/apirest.php/ITILFollowup');
    assert.equal(capturedMethod, 'POST');
    assert.equal(capturedHeaders?.get('session-token'), 'session-token');
    assert.equal(capturedHeaders?.get('app-token'), 'app-token');
    assert.deepEqual(capturedBody, {
      input: {
        itemtype: 'Ticket',
        items_id: 4523,
        content: 'Private operator triage note.',
        is_private: 1,
      },
    });
    assert.equal(result.id, 987);
    assert.equal(result.ticket_id, 4523);
    assert.equal(result.is_private, true);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAddTicketFollowupRejectsPublicWrites() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  let called = false;

  try {
    global.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await assert.rejects(
      () => service.addTicketFollowup(
        {
          baseUrl: 'https://glpi.internal/helpdesk/',
          sessionToken: 'session-token',
          appToken: null,
        },
        4523,
        'Public note attempt.',
        { isPrivate: false },
      ),
      (error: any) => error instanceof BadRequestException
        && String(error.message || '').includes('Only private/internal GLPI followups are allowed'),
    );
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAddTicketFollowupAllowsExplicitPublicWrites() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  let capturedBody: any = null;

  try {
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ id: 988 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await service.addTicketFollowup(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: null,
      },
      4523,
      'Public requester reply.',
      { isPrivate: false, allowPublic: true },
    );

    assert.equal(capturedBody?.input?.is_private, 0);
    assert.equal(result.id, 988);
    assert.equal(result.ticket_id, 4523);
    assert.equal(result.is_private, false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAddTicketFollowupAllowsLongExplicitPublicWritesOnly() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  const longReply = 'A'.repeat(4500);
  let capturedBody: any = null;
  let calls = 0;

  try {
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ id: 989 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await assert.rejects(
      () => service.addTicketFollowup(
        {
          baseUrl: 'https://glpi.internal/helpdesk/',
          sessionToken: 'session-token',
          appToken: null,
        },
        4523,
        longReply,
      ),
      (error: any) => error instanceof BadRequestException
        && String(error.message || '').includes('GLPI internal note content exceeds the allowed length'),
    );
    assert.equal(calls, 0);

    const result = await service.addTicketFollowup(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: null,
      },
      4523,
      longReply,
      { isPrivate: false, allowPublic: true },
    );

    assert.equal(calls, 1);
    assert.equal(capturedBody?.input?.is_private, 0);
    assert.equal(capturedBody?.input?.content.length, longReply.length);
    assert.equal(result.id, 989);
    assert.equal(result.is_private, false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAddTicketFollowupRejectsHtmlOrScriptContent() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  let called = false;

  try {
    global.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await assert.rejects(
      () => service.addTicketFollowup(
        {
          baseUrl: 'https://glpi.internal/helpdesk/',
          sessionToken: 'session-token',
          appToken: null,
        },
        4523,
        '<script>alert(1)</script>',
      ),
      (error: any) => error instanceof BadRequestException
        && String(error.message || '').includes('plain text'),
    );
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAddTicketFollowupRejectsMalformedCreateResponse() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;

  try {
    global.fetch = (async () => new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    await assert.rejects(
      () => service.addTicketFollowup(
        {
          baseUrl: 'https://glpi.internal/helpdesk/',
          sessionToken: 'session-token',
          appToken: null,
        },
        4523,
        'Private operator triage note.',
      ),
      (error: any) => error instanceof BadRequestException
        && String(error.message || '').includes('followup creation response was malformed'),
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function testUpdateTicketFieldsUsesSafePutEndpoint() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  let requestedUrl = '';
  let capturedMethod = '';
  let capturedHeaders: Headers | undefined;
  let capturedBody: any;

  try {
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      capturedMethod = String(init?.method || 'GET');
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await service.updateTicketFields(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      4523,
      { type: 2, priority: 4, urgency: 3, status: 4 },
    );

    assert.equal(requestedUrl, 'https://glpi.internal/helpdesk/apirest.php/Ticket/4523');
    assert.equal(capturedMethod, 'PUT');
    assert.equal(capturedHeaders?.get('session-token'), 'session-token');
    assert.equal(capturedHeaders?.get('app-token'), 'app-token');
    assert.deepEqual(capturedBody, {
      input: {
        type: 2,
        priority: 4,
        urgency: 3,
        status: 4,
      },
    });
    assert.deepEqual(result, {
      ticket_id: 4523,
      updated_fields: ['type', 'priority', 'urgency', 'status'],
    });
  } finally {
    global.fetch = originalFetch;
  }
}

async function testUpdateTicketFieldsRejectsUnsupportedOrInvalidUpdates() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  let called = false;

  try {
    global.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await assert.rejects(
      () => service.updateTicketFields(
        {
          baseUrl: 'https://glpi.internal/helpdesk/',
          sessionToken: 'session-token',
          appToken: null,
        },
        4523,
        { status: 0 },
      ),
      (error: any) => error instanceof BadRequestException
        && String(error.message || '').includes('must be a positive integer'),
    );
    await assert.rejects(
      () => service.updateTicketFields(
        {
          baseUrl: 'https://glpi.internal/helpdesk/',
          sessionToken: 'session-token',
          appToken: null,
        },
        4523,
        {},
      ),
      (error: any) => error instanceof BadRequestException
        && String(error.message || '').includes('No supported GLPI ticket fields'),
    );
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testSearchTicketsForScopeTreatsZeroResultsAsEmpty() {
  const service = createService();
  const originalFetch = global.fetch;
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };

  try {
    // GLPI omits the data key entirely when a search matches zero rows.
    global.fetch = (async () => new Response(
      JSON.stringify({ totalcount: 0, count: 0, sort: 15, order: 'DESC' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

    const tickets = await service.searchTicketsForScope(session, {
      createdAfter: '2026-06-11T08:00:00.000Z',
      maxResults: 5,
      entityId: null,
      categoryId: null,
    });
    assert.deepEqual(tickets, []);

    // A response without data and without a zero count is still malformed.
    global.fetch = (async () => new Response(
      JSON.stringify({ sort: 15, order: 'DESC' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;
    await assert.rejects(
      () => service.searchTicketsForScope(session, {
        createdAfter: '2026-06-11T08:00:00.000Z',
        maxResults: 5,
        entityId: null,
        categoryId: null,
      }),
      (error: any) => error instanceof BadRequestException
        && String(error.message || '').includes('malformed'),
    );

    // The created-after horizon is the remaining bound for wildcard scopes
    // and must be valid.
    await assert.rejects(
      () => service.searchTicketsForScope(session, {
        createdAfter: 'not-a-date',
        maxResults: 5,
        entityId: null,
        categoryId: null,
      }),
      (error: any) => error instanceof BadRequestException
        && /horizon|created-after/i.test(String(error.message || '')),
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function testSearchReferenceCatalogBuildsBoundedSearchAndNormalizesRows() {
  const service = createService('https://glpi.internal/helpdesk');
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        totalcount: 2,
        count: 2,
        data: [
          { id: 12, name: 'Reseau &#38; VPN', completename: 'Assistance &#62; Reseau &#38; Securite', parent_id: 4 },
          { 2: 13, 1: 'Badge', completename: 'IT > Access > Badge' },
          { id: 12, name: 'VPN duplicate', completename: 'Duplicate' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const categories = await service.searchReferenceCatalog(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      { kind: 'category', query: 'vpn', limit: 2 },
    );

    assert.match(requestedUrls[0], /search\/ITILCategory/);
    assert.match(requestedUrls[0], /range=0-1/);
    assert.match(requestedUrls[0], /criteria%5B0%5D%5Bvalue%5D=vpn/);
    assert.deepEqual(categories, [
      { id: 12, name: 'Reseau & VPN', completename: 'Assistance > Reseau & Securite', parent_id: 4 },
      { id: 13, name: 'Badge', completename: 'IT > Access > Badge', parent_id: null },
    ]);

    // Entity kind routes to the GLPI Entity dropdown and stays bounded by the limit.
    await service.searchReferenceCatalog(
      {
        baseUrl: 'https://glpi.internal/helpdesk/',
        sessionToken: 'session-token',
        appToken: 'app-token',
      },
      { kind: 'entity', query: 'it', limit: 1 },
    );
    assert.match(requestedUrls[1], /search\/Entity/);
    assert.match(requestedUrls[1], /range=0-0/);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testListReferenceSubtreeIdsExpandsDescendantsAndCachesTree() {
  const service = createService();
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify([
        { id: 1, itilcategories_id: 0 },
        { id: 2, itilcategories_id: 1 },
        { id: 3, itilcategories_id: 2 },
        { id: 4, itilcategories_id: 0 },
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-range': '0-3/4' },
      });
    }) as typeof fetch;

    // Root 1 expands to its whole subtree (1 > 2 > 3); sibling root 4 stays out.
    const ids = await service.listReferenceSubtreeIds(session, 'category', [1]);
    assert.deepEqual(ids, [1, 2, 3]);
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /apirest\.php\/ITILCategory/);
    assert.match(requestedUrls[0], /range=0-199/);

    // Follow-up expansions reuse the cached parent map — no extra GLPI calls.
    const again = await service.listReferenceSubtreeIds(session, 'category', [2]);
    assert.deepEqual(again, [2, 3]);
    assert.equal(requestedUrls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testSearchTicketsForScopeUsesUnderCriteriaAndMembershipForSubtrees() {
  const service = createService();
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };
  const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('search/Ticket')) {
        return jsonResponse({ totalcount: 2, count: 2, data: [{ id: 101 }, { id: 102 }] });
      }
      if (url.includes('Ticket/101')) {
        // In the subtree: child category 6 of selected root 5.
        return jsonResponse({ id: 101, name: 'Child category ticket', status: 2, itilcategories_id: 6, entities_id: 1, date: '2026-07-01 10:00:00' });
      }
      // Outside the subtree: category 9.
      return jsonResponse({ id: 102, name: 'Other category ticket', status: 2, itilcategories_id: 9, entities_id: 1, date: '2026-07-01 10:00:00' });
    }) as typeof fetch;

    const tickets = await service.searchTicketsForScope(session, {
      createdAfter: '2026-06-30T00:00:00.000Z',
      maxResults: 5,
      entityId: null,
      categoryId: 5,
      categoryIds: [5, 6],
    });
    assert.match(requestedUrls[0], /searchtype%5D=under/);
    assert.match(requestedUrls[0], /field%5D=7/);
    assert.deepEqual(tickets.map((ticket) => ticket.id), [101]);

    // Without the expanded id set the category criteria stay exact-match.
    requestedUrls.length = 0;
    await service.searchTicketsForScope(session, {
      createdAfter: '2026-06-30T00:00:00.000Z',
      maxResults: 5,
      entityId: null,
      categoryId: 5,
    });
    assert.doesNotMatch(requestedUrls[0], /under/);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAssignableGroupsCatalogueFiltersSortsAndCaches() {
  const service = createService();
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify([
        { id: 7, name: 'Tech-desk', completename: 'Tech-desk', is_assign: 1, groups_id: 0 },
        { id: 12, name: 'SAP-team', completename: 'Support &#62; SAP-team', is_assign: '1', groups_id: 3 },
        { id: 9, name: 'Requesters only', completename: 'Requesters only', is_assign: 0, groups_id: 0 },
        { id: 13, name: 'PLM-team', completename: 'Support > PLM-team', is_assign: true, groups_id: 3 },
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-range': '0-3/4' },
      });
    }) as typeof fetch;

    const groups = await service.listAssignableGroups(session);
    assert.deepEqual(groups.map((group) => group.id), [13, 12, 7]);
    assert.equal(groups[1].completename, 'Support > SAP-team');
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /apirest\.php\/Group\?/);

    // The catalogue is cached: a second read and the reference search reuse it.
    const again = await service.listAssignableGroups(session);
    assert.equal(again.length, 3);
    const searched = await service.searchReferenceCatalog(session, { kind: 'group', query: 'sap', limit: 10 });
    assert.deepEqual(searched.map((item) => item.id), [12]);
    assert.equal(requestedUrls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAddTicketGroupIsAdditiveIdempotentAndRestrictedToAssignableGroups() {
  const service = createService();
  const originalFetch = global.fetch;
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };
  const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-range': '0-1/2' },
  });

  try {
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
      if (/apirest\.php\/Group\?/.test(url)) {
        return jsonResponse([
          { id: 7, name: 'Tech-desk', completename: 'Tech-desk', is_assign: 1 },
          { id: 12, name: 'SAP-team', completename: 'SAP-team', is_assign: 1 },
        ]);
      }
      if (/Ticket\/4523\/Group_Ticket/.test(url)) {
        return jsonResponse([
          { id: 1, groups_id: 7, tickets_id: 4523, type: 2 },
          { id: 2, groups_id: 12, tickets_id: 4523, type: 1 },
        ]);
      }
      if (/apirest\.php\/Group_Ticket$/.test(url)) {
        return jsonResponse({ id: 3 });
      }
      throw new Error(`Unexpected GLPI call ${url}`);
    }) as typeof fetch;

    const groups = await service.getTicketGroups(session, 4523);
    assert.deepEqual(groups.map((group) => [group.group_id, group.role]), [[7, 'assigned'], [12, 'requester']]);

    // Already assigned: no write.
    const present = await service.addTicketGroup(session, 4523, 7);
    assert.deepEqual({ added: present.added, alreadyPresent: present.alreadyPresent }, { added: false, alreadyPresent: true });
    assert.equal(requests.some((request) => request.method === 'POST'), false);

    // Requester group is not "assigned": adding it as a technician group is a real write.
    const added = await service.addTicketGroup(session, 4523, 12);
    assert.deepEqual({ added: added.added, alreadyPresent: added.alreadyPresent }, { added: true, alreadyPresent: false });
    assert.equal(added.group.completename, 'SAP-team');
    const post = requests.find((request) => request.method === 'POST');
    assert.ok(post);
    assert.match(post!.url, /apirest\.php\/Group_Ticket$/);
    assert.deepEqual(JSON.parse(post!.body ?? '{}'), { input: { tickets_id: 4523, groups_id: 12, type: 2 } });

    // Not an assignable group: refused before any write.
    await assert.rejects(
      () => service.addTicketGroup(session, 4523, 99),
      (error: unknown) => error instanceof BadRequestException && /assignable groups/.test(String((error as Error).message)),
    );
    assert.equal(requests.filter((request) => request.method === 'POST').length, 1);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testCategoriesCatalogueAndWrite() {
  const service = createService();
  const originalFetch = global.fetch;
  const requests: Array<{url: string; body: any}> = [];
  const session = { baseUrl: 'https://glpi.internal/', sessionToken: 'session-token', appToken: null };
  try {
    global.fetch = (async (url: any, init: any) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify(init?.method === 'PUT' ? { id: 17 } : [
        { id: 2, name: 'SAP', completename: 'Software &#62; SAP', itilcategories_id: 1 },
        { id: 3, name: 'Hardware', completename: 'Hardware', itilcategories_id: 0 },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const categories = await service.listCategories(session);
    assert.deepEqual(categories.map((item) => item.id), [3, 2]);
    assert.equal(categories[1].completename, 'Software > SAP');
    assert.equal(categories[1].parentId, 1);
    await service.listCategories(session);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /apirest\.php\/ITILCategory\?/);
    await service.updateTicketFields(session, 17, { itilcategories_id: 2 });
    assert.deepEqual(requests[1].body, { input: { itilcategories_id: 2 } });
  } finally { global.fetch = originalFetch; }
}

// Technician catalogue: the active members of the assignable groups, nothing else. It is
// the only user list the desk agent ever sees, so the filters are the safety boundary.
async function testTechnicianCatalogueFiltersSortsAndCaches() {
  const service = createService();
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
    agentUserId: 42,
  };
  const jsonResponse = (payload: unknown[]) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-range': `0-${payload.length - 1}/${payload.length}` },
  });

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (/apirest\.php\/Group\?/.test(url)) {
        return jsonResponse([
          { id: 7, name: 'Tech-desk', completename: 'Tech-desk', is_assign: 1 },
          { id: 12, name: 'SAP-team', completename: 'SAP-team', is_assign: 1 },
          { id: 9, name: 'Requesters only', completename: 'Requesters only', is_assign: 0 },
        ]);
      }
      if (/apirest\.php\/Group_User\?/.test(url)) {
        return jsonResponse([
          { id: 1, groups_id: 7, users_id: 21 },
          { id: 2, groups_id: 12, users_id: 22 },
          { id: 3, groups_id: 7, users_id: 23 },
          { id: 4, groups_id: 12, users_id: 24 },
          // Member of a non-assignable group only: not a routing target.
          { id: 5, groups_id: 9, users_id: 25 },
          // The agent's own account, a member of an assignable group: not a routing target
          // either. It registers itself through the ticket_actor_role feature.
          { id: 6, groups_id: 7, users_id: 42 },
        ]);
      }
      if (/apirest\.php\/User\?/.test(url)) {
        return jsonResponse([
          { id: 21, name: 'mdupont', realname: 'Dupont', firstname: 'Marie', is_active: 1, is_deleted: 0 },
          // No realname/firstname: the login name is the fallback label.
          { id: 22, name: 'pmartin', realname: '', firstname: '', is_active: 1, is_deleted: 0 },
          { id: 23, name: 'oldtech', realname: 'Ancien', firstname: 'Tech', is_active: 0, is_deleted: 0 },
          { id: 24, name: 'gonetech', realname: 'Parti', firstname: 'Tech', is_active: 1, is_deleted: 1 },
          { id: 25, name: 'requester', realname: 'Client', firstname: 'Demandeur', is_active: 1, is_deleted: 0 },
          { id: 26, name: 'stranger', realname: 'Hors', firstname: 'Groupe', is_active: 1, is_deleted: 0 },
          { id: 42, name: 'kanap-agent', realname: 'Agent', firstname: 'KANAP', is_active: 1, is_deleted: 0 },
        ]);
      }
      throw new Error(`Unexpected GLPI call ${url}`);
    }) as typeof fetch;

    const first = await service.listTechnicians(session);
    assert.deepEqual(first.technicians.map((technician) => [technician.id, technician.label]), [
      [21, 'Dupont Marie'],
      [22, 'pmartin'],
    ]);
    assert.equal(first.truncated, false);
    assert.equal(first.technicians.some((technician) => technician.id === 42), false);
    assert.equal(requestedUrls.length, 3);

    // One request per itemtype, whatever the number of reads: the catalogue is cached and
    // the reference search is served from it, like the group catalogue.
    const again = await service.listTechnicians(session);
    assert.equal(again.technicians.length, 2);
    const searched = await service.searchReferenceCatalog(session, { kind: 'technician', query: 'dupont', limit: 10 });
    assert.deepEqual(searched.map((item) => [item.id, item.completename]), [[21, 'Dupont Marie']]);
    assert.equal(requestedUrls.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
}

// A huge technician list must not blow up the planner prompt: cap it and say so, the same
// way the group catalogue does.
async function testTechnicianCatalogueCapsAndFlagsTruncation() {
  const service = createService();
  const originalFetch = global.fetch;
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };
  const memberships = Array.from({ length: 250 }, (_value, index) => ({
    id: index + 1,
    groups_id: 7,
    users_id: 1000 + index,
  }));
  const users = Array.from({ length: 250 }, (_value, index) => ({
    id: 1000 + index,
    name: `tech${String(index).padStart(3, '0')}`,
    realname: 'Tech',
    firstname: String(index).padStart(3, '0'),
    is_active: 1,
    is_deleted: 0,
  }));
  const jsonResponse = (payload: unknown[]) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-range': `0-${payload.length - 1}/${payload.length}` },
  });

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/apirest\.php\/Group\?/.test(url)) {
        return jsonResponse([{ id: 7, name: 'Tech-desk', completename: 'Tech-desk', is_assign: 1 }]);
      }
      if (/apirest\.php\/Group_User\?/.test(url)) return jsonResponse(memberships);
      if (/apirest\.php\/User\?/.test(url)) return jsonResponse(users);
      throw new Error(`Unexpected GLPI call ${url}`);
    }) as typeof fetch;

    const catalogue = await service.listTechnicians(session);
    assert.equal(catalogue.technicians.length, 200);
    assert.equal(catalogue.truncated, true);
    assert.equal(catalogue.technicians[0].label, 'Tech 000');
  } finally {
    global.fetch = originalFetch;
  }
}

// A restricted GLPI API profile often refuses the bare Group_User collection. Membership
// then comes from the per-group sub-item endpoint, and the catalogue is identical.
async function testTechnicianCatalogueFallsBackToPerGroupMembership() {
  const service = createService();
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };
  const jsonResponse = (payload: unknown[]) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-range': `0-${payload.length - 1}/${payload.length}` },
  });

  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (/apirest\.php\/Group\?/.test(url)) {
        return jsonResponse([
          { id: 7, name: 'Tech-desk', completename: 'Tech-desk', is_assign: 1 },
          { id: 12, name: 'SAP-team', completename: 'SAP-team', is_assign: 1 },
        ]);
      }
      if (/apirest\.php\/Group_User\?/.test(url)) {
        return new Response(JSON.stringify(['ERROR_RIGHT_MISSING', 'You do not have permission.']), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (/apirest\.php\/Group\/7\/Group_User/.test(url)) {
        return jsonResponse([{ id: 1, groups_id: 7, users_id: 21 }]);
      }
      if (/apirest\.php\/Group\/12\/Group_User/.test(url)) {
        return jsonResponse([{ id: 2, groups_id: 12, users_id: 22 }]);
      }
      if (/apirest\.php\/User\?/.test(url)) {
        return jsonResponse([
          { id: 21, name: 'mdupont', realname: 'Dupont', firstname: 'Marie', is_active: 1, is_deleted: 0 },
          { id: 22, name: 'pmartin', realname: 'Martin', firstname: 'Paul', is_active: 1, is_deleted: 0 },
        ]);
      }
      throw new Error(`Unexpected GLPI call ${url}`);
    }) as typeof fetch;

    const catalogue = await service.listTechnicians(session);
    assert.deepEqual(catalogue.technicians.map((technician) => technician.label), ['Dupont Marie', 'Martin Paul']);
    assert.equal(requestedUrls.some((url) => /apirest\.php\/Group\/7\/Group_User/.test(url)), true);
    assert.equal(requestedUrls.some((url) => /apirest\.php\/Group\/12\/Group_User/.test(url)), true);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testTechnicianFallbackReadsEveryMembershipPage() {
  const originalFetch = global.fetch;
  const session = { baseUrl: 'https://glpi.internal/', sessionToken: 'session-token', appToken: 'app-token' };
  try {
    // Cover both GLPI's default 50-row window and the client's explicit 200-row window.
    for (const memberCount of [51, 251]) {
      const service = createService();
      const membershipRanges: Array<string | null> = [];
      const memberships = Array.from({ length: memberCount }, (_, index) => ({ id: index + 1, groups_id: 7, users_id: index + 1 }));
      const users = memberships.map((member) => ({
        id: member.users_id,
        name: `tech${member.users_id}`,
        // Keep the technician result below its own cap, even with multiple membership pages.
        is_active: member.users_id > memberCount - 51 ? 1 : 0,
      }));
      global.fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const range = url.searchParams.get('range');
        let rows: unknown[];
        if (url.pathname === '/apirest.php/Group_User') {
          return new Response(JSON.stringify(['ERROR_RIGHT_MISSING', 'Not allowed.']), {
            status: 403, headers: { 'content-type': 'application/json' },
          });
        } else if (url.pathname === '/apirest.php/Group/7/Group_User') {
          membershipRanges.push(range);
          rows = memberships;
        } else if (url.pathname === '/apirest.php/Group') {
          rows = [{ id: 7, name: 'Support', is_assign: 1 }];
        } else if (url.pathname === '/apirest.php/User') {
          rows = users;
        } else {
          throw new Error(`Unexpected GLPI call ${url}`);
        }
        const [start, end] = (range ?? '0-49').split('-').map(Number);
        const page = rows.slice(start, end + 1);
        return new Response(JSON.stringify(page), {
          status: page.length < rows.length ? 206 : 200,
          headers: { 'content-type': 'application/json', 'content-range': `${start}-${start + page.length - 1}/${rows.length}` },
        });
      }) as typeof fetch;

      const catalogue = await service.listTechnicians(session);
      assert.equal(catalogue.technicians.length, 51);
      assert.equal(catalogue.technicians.some((technician) => technician.id === memberCount), true);
      assert.equal(catalogue.truncated, false);
      assert.deepEqual(membershipRanges, memberCount === 51 ? ['0-199'] : ['0-199', '200-399']);
    }
  } finally {
    global.fetch = originalFetch;
  }
}

async function testTechnicianMembershipIgnoresGroupPromptCap() {
  const originalFetch = global.fetch;
  const session = { baseUrl: 'https://glpi.internal/', sessionToken: 'session-token', appToken: 'app-token' };
  try {
    // Both call orders must share the complete cached group list without changing the
    // bounded public group catalogue, including when the technician is the first reader.
    for (const groupsFirst of [true, false]) {
      const service = createService();
      let groupReads = 0;
      global.fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        let rows: unknown[];
        if (url.pathname === '/apirest.php/Group') {
          groupReads += 1;
          rows = Array.from({ length: 201 }, (_, index) => ({ id: index + 1, name: `Group ${String(index + 1).padStart(3, '0')}`, is_assign: 1 }));
        } else if (url.pathname === '/apirest.php/Group_User') {
          rows = [{ id: 1, groups_id: 201, users_id: 21 }];
        } else if (url.pathname === '/apirest.php/User') {
          rows = [{ id: 21, name: 'Only Technician', is_active: 1 }];
        } else {
          throw new Error(`Unexpected GLPI call ${url}`);
        }
        const [start, end] = (url.searchParams.get('range') ?? '0-49').split('-').map(Number);
        const page = rows.slice(start, end + 1);
        return new Response(JSON.stringify(page), {
          status: page.length < rows.length ? 206 : 200,
          headers: { 'content-type': 'application/json', 'content-range': `${start}-${start + page.length - 1}/${rows.length}` },
        });
      }) as typeof fetch;

      if (groupsFirst) assert.equal((await service.listAssignableGroups(session)).length, 200);
      const catalogue = await service.listTechnicians(session);
      assert.deepEqual(catalogue.technicians.map((technician) => technician.id), [21]);
      assert.equal(catalogue.truncated, false);
      const groups = await service.listAssignableGroups(session);
      assert.equal(groups.length, 200);
      assert.equal(groups.some((group) => group.id === 201), false);
      assert.equal(groupReads, 2);
    }
  } finally {
    global.fetch = originalFetch;
  }
}

// The named-technician write: additive Ticket_User type 2, idempotent, and never outside
// the catalogue. addTicketUser keeps its own-user-only guard for the ticket-actor feature.
async function testAddTicketTechnicianIsAdditiveIdempotentAndRestricted() {
  const service = createService();
  const originalFetch = global.fetch;
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };
  const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-range': Array.isArray(payload) ? `0-${Math.max(payload.length - 1, 0)}/${payload.length}` : '0-0/1',
    },
  });

  try {
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
      if (/apirest\.php\/Group\?/.test(url)) {
        return jsonResponse([{ id: 7, name: 'Tech-desk', completename: 'Tech-desk', is_assign: 1 }]);
      }
      if (/apirest\.php\/Group_User\?/.test(url)) {
        return jsonResponse([
          { id: 1, groups_id: 7, users_id: 21 },
          { id: 2, groups_id: 7, users_id: 22 },
        ]);
      }
      if (/apirest\.php\/User\?/.test(url)) {
        return jsonResponse([
          { id: 21, name: 'mdupont', realname: 'Dupont', firstname: 'Marie', is_active: 1, is_deleted: 0 },
          { id: 22, name: 'pmartin', realname: 'Martin', firstname: 'Paul', is_active: 1, is_deleted: 0 },
        ]);
      }
      if (/Ticket\/4523\/Ticket_User/.test(url)) {
        return jsonResponse([{ id: 1, tickets_id: 4523, users_id: 21, type: 2 }]);
      }
      if (/apirest\.php\/Ticket_User$/.test(url)) {
        return jsonResponse({ id: 9 });
      }
      throw new Error(`Unexpected GLPI call ${url}`);
    }) as typeof fetch;

    // Already assigned: no write.
    const present = await service.addTicketTechnician(session, 4523, 21);
    assert.deepEqual(
      { added: present.added, alreadyPresent: present.alreadyPresent, label: present.technician.label },
      { added: false, alreadyPresent: true, label: 'Dupont Marie' },
    );
    assert.equal(requests.some((request) => request.method === 'POST'), false);

    const added = await service.addTicketTechnician(session, 4523, 22);
    assert.deepEqual({ added: added.added, alreadyPresent: added.alreadyPresent }, { added: true, alreadyPresent: false });
    assert.equal(added.technician.label, 'Martin Paul');
    const post = requests.find((request) => request.method === 'POST');
    assert.ok(post);
    assert.match(post!.url, /apirest\.php\/Ticket_User$/);
    assert.deepEqual(JSON.parse(post!.body ?? '{}'), { input: { tickets_id: 4523, users_id: 22, type: 2 } });

    // Outside the catalogue (not a member of an assignable group): refused before any write.
    await assert.rejects(
      () => service.addTicketTechnician(session, 4523, 99),
      (error: unknown) => error instanceof BadRequestException
        && /technicians of an assignable group/.test(String((error as Error).message)),
    );
    assert.equal(requests.filter((request) => request.method === 'POST').length, 1);
  } finally {
    global.fetch = originalFetch;
  }
}

// Observer writes are Group_Ticket type 3. An assigned group (type 2) is not already an
// observer. A second add of the same observer does not POST again.
async function testAddTicketGroupObserverIsAdditiveIdempotentAndRestricted() {
  const service = createService();
  const originalFetch = global.fetch;
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };
  const associations = [
    { id: 1, groups_id: 7, tickets_id: 4523, type: 2 },
    { id: 2, groups_id: 12, tickets_id: 4523, type: 3 },
  ];
  const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-range': Array.isArray(payload) ? `0-${Math.max(payload.length - 1, 0)}/${payload.length}` : '0-0/1',
    },
  });

  try {
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : null;
      requests.push({ url, method, body });
      if (/apirest\.php\/Group\?/.test(url)) {
        return jsonResponse([
          { id: 7, name: 'Tech-desk', completename: 'Tech-desk', is_assign: 1 },
          { id: 12, name: 'SAP-team', completename: 'Support > SAP-team', is_assign: 1 },
        ]);
      }
      if (/Ticket\/4523\/Group_Ticket/.test(url)) {
        return jsonResponse(associations);
      }
      if (method === 'POST' && /apirest\.php\/Group_Ticket$/.test(url)) {
        const parsed = JSON.parse(body ?? '{}') as { input?: { groups_id?: number; type?: number } };
        associations.push({
          id: associations.length + 1,
          groups_id: Number(parsed.input?.groups_id),
          tickets_id: 4523,
          type: Number(parsed.input?.type),
        });
        return jsonResponse({ id: associations.length });
      }
      throw new Error(`Unexpected GLPI call ${method} ${url}`);
    }) as typeof fetch;

    const present = await service.addTicketGroupObserver(session, 4523, 12);
    assert.deepEqual(
      { added: present.added, alreadyPresent: present.alreadyPresent },
      { added: false, alreadyPresent: true },
    );
    assert.equal(requests.some((request) => request.method === 'POST'), false);

    // Assigned (type 2) is a different row from observer (type 3).
    const added = await service.addTicketGroupObserver(session, 4523, 7);
    assert.deepEqual({ added: added.added, alreadyPresent: added.alreadyPresent }, { added: true, alreadyPresent: false });
    assert.equal(added.group.completename, 'Tech-desk');
    const post = requests.find((request) => request.method === 'POST');
    assert.ok(post);
    assert.match(post!.url, /apirest\.php\/Group_Ticket$/);
    assert.deepEqual(JSON.parse(post!.body ?? '{}'), { input: { tickets_id: 4523, groups_id: 7, type: 3 } });

    const again = await service.addTicketGroupObserver(session, 4523, 7);
    assert.deepEqual(
      { added: again.added, alreadyPresent: again.alreadyPresent },
      { added: false, alreadyPresent: true },
    );
    assert.equal(requests.filter((request) => request.method === 'POST').length, 1);

    await assert.rejects(
      () => service.addTicketGroupObserver(session, 4523, 99),
      (error: unknown) => error instanceof BadRequestException && /assignable groups/.test(String((error as Error).message)),
    );
    assert.equal(requests.filter((request) => request.method === 'POST').length, 1);
  } finally {
    global.fetch = originalFetch;
  }
}

// Observer writes are Ticket_User type 3. An assigned technician is not already an
// observer. A second add of the same observer does not POST again.
async function testAddTicketTechnicianObserverIsAdditiveIdempotentAndRestricted() {
  const service = createService();
  const originalFetch = global.fetch;
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const session = {
    baseUrl: 'https://glpi.internal/',
    sessionToken: 'session-token',
    appToken: 'app-token',
  };
  const associations = [
    { id: 1, tickets_id: 4523, users_id: 21, type: 2 },
    { id: 2, tickets_id: 4523, users_id: 22, type: 3 },
  ];
  const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-range': Array.isArray(payload) ? `0-${Math.max(payload.length - 1, 0)}/${payload.length}` : '0-0/1',
    },
  });

  try {
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : null;
      requests.push({ url, method, body });
      if (/apirest\.php\/Group\?/.test(url)) {
        return jsonResponse([{ id: 7, name: 'Tech-desk', completename: 'Tech-desk', is_assign: 1 }]);
      }
      if (/apirest\.php\/Group_User\?/.test(url)) {
        return jsonResponse([
          { id: 1, groups_id: 7, users_id: 21 },
          { id: 2, groups_id: 7, users_id: 22 },
        ]);
      }
      if (/apirest\.php\/User\?/.test(url)) {
        return jsonResponse([
          { id: 21, name: 'mdupont', realname: 'Dupont', firstname: 'Marie', is_active: 1, is_deleted: 0 },
          { id: 22, name: 'pmartin', realname: 'Martin', firstname: 'Paul', is_active: 1, is_deleted: 0 },
        ]);
      }
      if (/Ticket\/4523\/Ticket_User/.test(url)) {
        return jsonResponse(associations);
      }
      if (method === 'POST' && /apirest\.php\/Ticket_User$/.test(url)) {
        const parsed = JSON.parse(body ?? '{}') as { input?: { users_id?: number; type?: number } };
        associations.push({
          id: associations.length + 1,
          tickets_id: 4523,
          users_id: Number(parsed.input?.users_id),
          type: Number(parsed.input?.type),
        });
        return jsonResponse({ id: associations.length });
      }
      throw new Error(`Unexpected GLPI call ${method} ${url}`);
    }) as typeof fetch;

    const present = await service.addTicketTechnicianObserver(session, 4523, 22);
    assert.deepEqual(
      { added: present.added, alreadyPresent: present.alreadyPresent, label: present.technician.label },
      { added: false, alreadyPresent: true, label: 'Martin Paul' },
    );
    assert.equal(requests.some((request) => request.method === 'POST'), false);

    const added = await service.addTicketTechnicianObserver(session, 4523, 21);
    assert.deepEqual({ added: added.added, alreadyPresent: added.alreadyPresent }, { added: true, alreadyPresent: false });
    assert.equal(added.technician.label, 'Dupont Marie');
    const post = requests.find((request) => request.method === 'POST');
    assert.ok(post);
    assert.match(post!.url, /apirest\.php\/Ticket_User$/);
    assert.deepEqual(JSON.parse(post!.body ?? '{}'), { input: { tickets_id: 4523, users_id: 21, type: 3 } });

    const again = await service.addTicketTechnicianObserver(session, 4523, 21);
    assert.deepEqual(
      { added: again.added, alreadyPresent: again.alreadyPresent },
      { added: false, alreadyPresent: true },
    );
    assert.equal(requests.filter((request) => request.method === 'POST').length, 1);

    await assert.rejects(
      () => service.addTicketTechnicianObserver(session, 4523, 99),
      (error: unknown) => error instanceof BadRequestException
        && /technicians of an assignable group/.test(String((error as Error).message)),
    );
    assert.equal(requests.filter((request) => request.method === 'POST').length, 1);
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  await testInitSessionSendsJsonHeaders();
  await testInitSessionExplainsHtmlResponse();
  await testInitSessionNormalizesApiEndpointBaseUrl();
  await testConnectionNormalizesCopiedApiUrls();
  await testFetchDocumentUsesDocumentApiDownloadForDocumentSendUrls();
  await testFetchDocumentRejectsCrossOriginTargets();
  await testGetTicketExtractsDescriptionImageTargets();
  await testGetTicketDecodesGlpi10SanitizedContentAndImages();
  await testGetTicketLeavesEscapedPlainComparisonAtBoundary();
  await testGetTicketFollowupsPaginatesAndNormalizesNewestFirst();
  await testGetTicketFollowupsDecodeGlpi10SanitizedContentAndImages();
  await testGetTicketUsersNormalizesRoles();
  await testGetTicketUsersKeepsIdsWhenExpandedReadFails();
  await testGetTicketFollowupsStopsOnDuplicatePageWhenRangeIsIgnored();
  await testAddTicketFollowupUsesFixedPrivatePostEndpoint();
  await testAddTicketFollowupRejectsPublicWrites();
  await testAddTicketFollowupAllowsExplicitPublicWrites();
  await testAddTicketFollowupAllowsLongExplicitPublicWritesOnly();
  await testAddTicketFollowupRejectsHtmlOrScriptContent();
  await testAddTicketFollowupRejectsMalformedCreateResponse();
  await testUpdateTicketFieldsUsesSafePutEndpoint();
  await testUpdateTicketFieldsRejectsUnsupportedOrInvalidUpdates();
  await testSearchReferenceCatalogBuildsBoundedSearchAndNormalizesRows();
  await testSearchTicketsForScopeTreatsZeroResultsAsEmpty();
  await testListReferenceSubtreeIdsExpandsDescendantsAndCachesTree();
  await testSearchTicketsForScopeUsesUnderCriteriaAndMembershipForSubtrees();
  await testCategoriesCatalogueAndWrite();
  await testAssignableGroupsCatalogueFiltersSortsAndCaches();
  await testAddTicketGroupIsAdditiveIdempotentAndRestrictedToAssignableGroups();
  await testAddTicketGroupObserverIsAdditiveIdempotentAndRestricted();
  await testTechnicianCatalogueFiltersSortsAndCaches();
  await testTechnicianCatalogueCapsAndFlagsTruncation();
  await testTechnicianCatalogueFallsBackToPerGroupMembership();
  await testTechnicianFallbackReadsEveryMembershipPage();
  await testTechnicianMembershipIgnoresGroupPromptCap();
  await testAddTicketTechnicianIsAdditiveIdempotentAndRestricted();
  await testAddTicketTechnicianObserverIsAdditiveIdempotentAndRestricted();
}

void run();
