// A small stand-in for the GLPI REST API (apirest.php), enough for an agent triage to read a
// bench ticket: session, ticket, requester, follow-ups, empty catalogues. It answers every write
// with a refusal and logs it: a bench run proposes actions, it never applies them.
//
// GLPI ticket id = <run sequence> * 100 + <ticket number of the set>: each run reads fresh
// tickets, so the agent queue never takes a bench ticket for one it has already handled.
import * as http from 'node:http';

export const TICKET_ID_FACTOR = 100;

export function glpiTicketId(runSequence, ticketNumber) {
  return runSequence * TICKET_ID_FACTOR + ticketNumber;
}

export function ticketNumberOf(glpiId) {
  return glpiId % TICKET_ID_FACTOR;
}

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text to the HTML GLPI stores: one paragraph per blank-line block, line breaks kept. */
export function toGlpiHtml(text) {
  return String(text).trim().split(/\n\s*\n/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

const glpiDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

const REQUESTER_USER_ID = 101;
const AGENT_USER_ID = 900;

/**
 * The GLPI view of one bench ticket. `ticket` comes from the set (number, title, description,
 * followups). Dates are a few minutes old, so the ticket is new for any agent horizon.
 */
export function glpiTicketRecord(glpiId, ticket, now = new Date()) {
  const created = new Date(now.getTime() - 10 * 60_000);
  return {
    id: glpiId,
    name: ticket.title,
    content: toGlpiHtml(ticket.description),
    status: 1,
    priority: 3,
    urgency: 3,
    type: 1,
    entities_id: 0,
    itilcategories_id: 0,
    date: glpiDate(created),
    date_creation: glpiDate(created),
    date_mod: glpiDate(created),
  };
}

export function glpiFollowups(glpiId, ticket, now = new Date()) {
  return (ticket.followups ?? []).map((text, index) => ({
    id: glpiId * 10 + index + 1,
    itemtype: 'Ticket',
    items_id: glpiId,
    users_id: REQUESTER_USER_ID,
    user_name: ticket.requester ?? 'Bench requester',
    content: toGlpiHtml(text),
    is_private: 0,
    date: glpiDate(new Date(now.getTime() - (8 - index) * 60_000)),
    date_mod: glpiDate(new Date(now.getTime() - (8 - index) * 60_000)),
  }));
}

/**
 * Starts the server. `ticketsByNumber`: Map<number, ticket>. `log(line)` gets one line per
 * request. Resolves to { server, port, requests } once listening.
 */
export function startFakeGlpi({ ticketsByNumber, port = 0, host = '0.0.0.0', log = () => {} }) {
  const requests = [];
  const writes = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fake-glpi');
    const route = url.pathname.replace(/^.*?apirest\.php\/?/, '');
    requests.push({ method: req.method, route });
    log(`${req.method} ${route}${url.search}`);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const ticketFor = (idText) => {
      const glpiId = Number(idText);
      const ticket = ticketsByNumber.get(ticketNumberOf(glpiId));
      return ticket ? { glpiId, ticket } : null;
    };

    if (req.method !== 'GET') {
      writes.push({ method: req.method, route });
      log(`WRITE REFUSED ${req.method} ${route}`);
      if (route === 'killSession') return send(200, {});
      return send(403, ['ERROR_RIGHT_MISSING', 'The bench GLPI is read-only.']);
    }
    if (route === 'initSession') return send(200, { session_token: 'bench-session' });
    if (route === 'killSession') return send(200, {});
    if (route === 'getFullSession') return send(200, { session: { glpiID: AGENT_USER_ID, glpiname: 'bench-agent' } });

    let match = route.match(/^Ticket\/(\d+)$/);
    if (match) {
      const found = ticketFor(match[1]);
      if (!found) return send(404, ['ERROR_ITEM_NOT_FOUND', 'Item not found']);
      return send(200, glpiTicketRecord(found.glpiId, found.ticket));
    }
    match = route.match(/^Ticket\/(\d+)\/ITILFollowup$/);
    if (match) {
      const found = ticketFor(match[1]);
      if (!found) return send(404, ['ERROR_ITEM_NOT_FOUND', 'Item not found']);
      const rows = glpiFollowups(found.glpiId, found.ticket);
      return send(200, rows, { 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    }
    match = route.match(/^Ticket\/(\d+)\/Ticket_User$/);
    if (match) {
      const found = ticketFor(match[1]);
      if (!found) return send(404, ['ERROR_ITEM_NOT_FOUND', 'Item not found']);
      const expand = url.searchParams.get('expand_dropdowns') === 'true';
      return send(200, [{
        id: found.glpiId * 10,
        tickets_id: found.glpiId,
        users_id: expand ? (found.ticket.requester ?? 'Bench requester') : REQUESTER_USER_ID,
        type: 1,
        use_notification: 1,
      }]);
    }
    if (/^Ticket\/\d+\/(Group_Ticket|Document_Item|Supplier_Ticket|TicketTask|ITILSolution)$/.test(route)) {
      return send(200, [], { 'Content-Range': '0-0/0' });
    }
    if (route.startsWith('search/')) return send(200, { totalcount: 0, count: 0, data: [] });
    if (/^[A-Za-z_]+$/.test(route)) return send(200, [], { 'Content-Range': '0-0/0' });
    return send(404, ['ERROR_RESOURCE_NOT_FOUND_NOR_COMMONDBTM', 'Unknown bench route']);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, port: server.address().port, requests, writes }));
  });
}
