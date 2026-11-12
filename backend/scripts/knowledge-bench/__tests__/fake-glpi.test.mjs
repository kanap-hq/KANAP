import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glpiTicketId, startFakeGlpi, ticketNumberOf, toGlpiHtml } from '../fake-glpi.mjs';

test('ticket ids carry the run sequence and the ticket number', () => {
  assert.equal(glpiTicketId(4500346, 7), 450034607);
  assert.equal(ticketNumberOf(450034607), 7);
});

test('plain text becomes escaped GLPI paragraphs', () => {
  assert.equal(toGlpiHtml('a <b>\nc\n\nd'), '<p>a &lt;b&gt;<br />c</p><p>d</p>');
});

test('the fake GLPI serves a ticket, its requester and refuses writes', async () => {
  const fake = await startFakeGlpi({
    ticketsByNumber: new Map([[3, { title: 'Printer', description: 'It jams.' }]]),
    host: '127.0.0.1',
  });
  const base = `http://127.0.0.1:${fake.port}/apirest.php`;
  try {
    assert.equal((await (await fetch(`${base}/initSession`)).json()).session_token, 'bench-session');
    const ticket = await (await fetch(`${base}/Ticket/1203`)).json();
    assert.deepEqual([ticket.id, ticket.name, ticket.content], [1203, 'Printer', '<p>It jams.</p>']);
    const users = await (await fetch(`${base}/Ticket/1203/Ticket_User?expand_dropdowns=true`)).json();
    assert.equal(users[0].type, 1);
    assert.equal((await fetch(`${base}/Ticket/1299`)).status, 404);
    assert.equal((await fetch(`${base}/ITILFollowup`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal(fake.writes.length, 1);
  } finally {
    fake.server.close();
  }
});
