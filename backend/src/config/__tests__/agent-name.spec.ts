import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as ts from 'typescript';
import { backendPath } from '../../common/__tests__/backend-root';
import { AGENT_NAME } from '../product';

// The AI agent's name is one constant (`config/product.ts`), so that a new name is one change. The
// instructions to the model and the email texts write `${AGENT_NAME}`: this spec fails on a string
// of theirs that writes the name itself. Comments may name the agent. The interface texts have
// their own check (`frontend/src/locales/agentName.test.ts`).

const NAME = new RegExp(`\\b${AGENT_NAME}\\b`);

const EMAIL_LOCALES = backendPath('src', 'i18n', 'email-locales');
const FILES = [
  backendPath('src', 'ai', 'ai-system-prompt.service.ts'),
  ...fs.readdirSync(EMAIL_LOCALES).filter((name) => name.endsWith('.ts')).sort().map((name) => `${EMAIL_LOCALES}/${name}`),
];

/** The strings and template parts of a source that write the agent's name, with their line. */
function namedLiterals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node))
      && NAME.test(node.text)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      found.push(`${file.slice(backendPath().length + 1)}:${line}: ${node.text.slice(0, 120)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// The check sees a written name in a string and in a template, and leaves comments and the constant alone.
const sample = [
  `// ${AGENT_NAME} in a comment`,
  `const a = 'Ask ${AGENT_NAME}';`,
  `const b = \`Ask ${AGENT_NAME} about \${x}\`;`,
  'const c = `Ask ${AGENT_NAME}`;',
].join('\n');
assert.deepEqual(namedLiterals(backendPath('sample.ts'), sample).map((entry) => entry.split(':')[1]), ['2', '3']);

assert.ok(FILES.length >= 5, `the system prompt and the four email languages, found ${FILES.length} files`);
const offenders = FILES.flatMap((file) => namedLiterals(file, fs.readFileSync(file, 'utf8')));
assert.deepEqual(offenders, [], `write \${AGENT_NAME} instead of "${AGENT_NAME}":\n${offenders.join('\n')}`);

console.log(`agent-name: ${FILES.length} files write the agent's name through AGENT_NAME`);
