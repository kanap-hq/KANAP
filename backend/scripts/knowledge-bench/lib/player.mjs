// Plays one bench ticket: the agent's manual "test on a ticket" run (the real triage chain, the
// real model) on the GLPI ticket the fake GLPI serves, then the verdict.
//
// An unreachable API (network cut, 502/503/504 while the stack restarts) is not a miss of the
// chain: the player waits until the API answers again and replays the ticket under a fresh GLPI id
// (the interrupted run may still hold the old one in the agent queue).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glpiTicketId } from '../fake-glpi.mjs';
import { extractTriage } from './extract.mjs';
import { verdictOf } from './score.mjs';

const TRIAGE_ROUTE = '/ai/admin/control-plane/uat/ticketing-triage';
export const MAX_TRANSIENT_RETRIES = 3;

/** True for a failure of the infrastructure rather than of the chain. */
export function isTransientFailure(error) {
  if (!error) return false;
  if (error.status == null) return true; // fetch failed, connection refused or reset, timeout
  return [502, 503, 504].includes(error.status);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Waits until `GET <base>/config/public` answers 200, then a few seconds more for the workers. */
export async function waitForApi(baseUrl, { timeoutMs = 15 * 60_000, log = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/config/public`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        await sleep(10_000);
        return true;
      }
    } catch { /* still down */ }
    log('API unreachable, waiting');
    await sleep(5_000);
  }
  return false;
}

const freshRunSequence = () => Math.floor(Date.now() / 1000) % 10_000_000;

export async function playTicket({ api, ticket, glpiId, agentId, dataset, rawDir, log = () => {} }) {
  const base = {
    n: ticket.n,
    family: ticket.family,
    lang: ticket.lang,
    expected: ticket.expected,
    forbidden: ticket.forbidden ?? [],
    acceptable: ticket.acceptable ?? [],
  };
  const interruptions = [];
  let currentId = glpiId;
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const response = await api.post(TRIAGE_ROUTE, {
        provider_key: 'glpi',
        target_key: String(currentId),
        agent_definition_id: agentId,
      }, { timeoutMs: 600_000 });
      const durationMs = Date.now() - started;
      if (rawDir) {
        fs.mkdirSync(path.join(rawDir, 'raw'), { recursive: true });
        fs.writeFileSync(path.join(rawDir, 'raw', `ticket-${String(ticket.n).padStart(2, '0')}.json`), JSON.stringify(response));
      }
      const run = extractTriage(response, dataset);
      return { ...base, glpi_id: currentId, interruptions, duration_ms: durationMs, ...run, verdict: verdictOf(ticket, run) };
    } catch (error) {
      const message = String(error?.message ?? error).slice(0, 500);
      if (isTransientFailure(error) && attempt < MAX_TRANSIENT_RETRIES) {
        interruptions.push({ glpi_id: currentId, error: message, at: new Date().toISOString() });
        log(`#${ticket.n}: API unreachable (${message.slice(0, 80)}), replaying once it answers`);
        await waitForApi(api.baseUrl, { log });
        currentId = glpiTicketId(freshRunSequence(), ticket.n);
        continue;
      }
      const result = { ...base, glpi_id: currentId, interruptions, error: message, transient: isTransientFailure(error), duration_ms: Date.now() - started };
      return { ...result, verdict: verdictOf(ticket, result) };
    }
  }
}
