import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from './backend-root';

// A 403 carries a translatable `code` (and `params` when it names a right, a family or a module),
// so the screen shows it in the language of the person (`errors:<code>`). This inventory fails
// when a refusal is written with a bare sentence outside the allowlist below:
//   - `new ForbiddenException('...')`, a template or a constant (`new ForbiddenException(MESSAGE)`);
//   - `new HttpException('...', 403)` or `HttpStatus.FORBIDDEN` with a bare sentence.
// Write it through `codedForbidden(code, message, params?)`, `moduleRightRequired(...)` or one of
// the helpers of `src/auth/module-right-required.ts`, or with an object holding a `code`.
// It reads files outside its own folder: `backendPath()`, never `__dirname` (the compiled tree
// has no `.ts` file).

const BARE_FORBIDDEN = /new\s+ForbiddenException\(\s*(?:['"`]|[A-Za-z_$][\w$]*\s*[,)])/g;
const BARE_HTTP_EXCEPTION = /new\s+HttpException\(\s*(?:['"`]|[A-Za-z_$][\w$]*\s*,)[^;]*?,\s*(?:403|HttpStatus\.FORBIDDEN)\s*\)/g;

/**
 * Files that still hold a bare refusal: the AI module, until its own lot codes them. The list
 * only shrinks: remove a file once its refusals are coded.
 */
const ALLOWED_FILES = new Set<string>([
  'src/ai/ai-admin-overview.controller.ts',
  'src/ai/ai-api-keys.controller.ts',
  'src/ai/ai-attachment.service.ts',
  'src/ai/ai-mcp.controller.ts',
  'src/ai/ai-mutation-preview.service.ts',
  'src/ai/ai-policy.service.ts',
  'src/ai/control-plane/action-request/ai-action-request.service.ts',
  'src/ai/control-plane/agent-control/agent-control-definition.util.ts',
  'src/ai/control-plane/agent-control/ai-agent-control.controller.ts',
  'src/ai/control-plane/agent-control/ai-agent-control.service.ts',
  'src/ai/control-plane/agent/ai-agent-builtin-quota.service.ts',
  'src/ai/control-plane/agent/ai-agent-helpdesk-ticketing-ingestion.service.ts',
  'src/ai/control-plane/agent/ai-agent-monitoring-alert-ingestion.service.ts',
  'src/ai/control-plane/agent/ai-agent-work-queue.service.ts',
  'src/ai/control-plane/approval/ai-approval.service.ts',
  'src/ai/control-plane/automation/ai-automation-job-catalog.service.ts',
  'src/ai/control-plane/capability/ai-capability.registry.ts',
  'src/ai/control-plane/diagnostics/ai-readonly-diagnostic-workflow.service.ts',
  'src/ai/control-plane/dispatcher/ai-capability-dispatcher.service.ts',
  'src/ai/control-plane/live-readiness/ai-live-contract-harness.service.ts',
  'src/ai/control-plane/live-readiness/ai-live-test-target.service.ts',
  'src/ai/control-plane/mcp/ai-external-mcp-bridge.service.ts',
  'src/ai/control-plane/mcp/ai-mcp-access-policy.ts',
  'src/ai/control-plane/mcp/ai-mcp-exposure.service.ts',
  'src/ai/control-plane/pause/ai-emergency-pause.service.ts',
  'src/ai/control-plane/policy/ai-autonomy-routine.service.ts',
  'src/ai/control-plane/providers/tenant-secret-resolver.service.ts',
  'src/ai/mutation/ai-business-record-mutation-support.service.ts',
  'src/ai/mutation/ai-document-mutation-support.service.ts',
  'src/ai/mutation/ai-incident-mutation-support.service.ts',
  'src/ai/mutation/ai-task-mutation-support.service.ts',
  'src/ai/query/ai-aggregate.executor.ts',
  'src/ai/query/ai-query.executor.ts',
  'src/ai/search-index/ai-admin-search-index.controller.ts',
]);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function run(): void {
  const failures: string[] = [];
  const stale: string[] = [];
  const seenAllowed = new Set<string>();
  for (const file of sourceFiles(backendPath('src'))) {
    const relative = path.relative(backendPath(), file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    const hits = [...source.matchAll(BARE_FORBIDDEN), ...source.matchAll(BARE_HTTP_EXCEPTION)];
    if (ALLOWED_FILES.has(relative)) {
      if (hits.length > 0) seenAllowed.add(relative);
      continue;
    }
    for (const match of hits) {
      failures.push(
        `${relative}:${lineOf(source, match.index ?? 0)}: a 403 with a bare sentence. Use codedForbidden(code, message, params?) ` +
        'or moduleRightRequired(...) from src/auth/module-right-required.ts, and add errors:<code> to the four locales.',
      );
    }
  }
  for (const allowed of ALLOWED_FILES) {
    if (!seenAllowed.has(allowed)) stale.push(allowed);
  }
  assert.deepEqual(failures, [], `Bare 403 refusals found:\n${failures.join('\n')}`);
  assert.deepEqual(stale, [], `Remove from ALLOWED_FILES (no bare 403 left there):\n${stale.join('\n')}`);
  console.log('coded-forbidden.inventory.spec: ok');
}

run();
