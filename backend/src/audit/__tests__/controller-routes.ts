import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { backendPath } from '../../common/__tests__/backend-root';
import { isExportRoutePath, joinRoutePath } from '../security-events';

/**
 * A route method of the API, read from the controllers' source with the TypeScript parser:
 * `GET /incidents/:id/report`, whether it is recorded as an export (path ending with `/export`
 * or `@ExportRoute()`), and the signs that it sends a file, found in its body and in the
 * methods and functions of the same file it calls.
 */
export type ScannedRoute = {
  route: string;
  file: string;
  handler: string;
  recordedAsExport: boolean;
  fileSigns: string[];
};

const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All']);

function decoratorCalls(node: ts.Node): Array<{ name: string; args: readonly ts.Expression[] }> {
  const decorators = (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined) ?? [];
  return decorators.flatMap((decorator) => {
    const expr = decorator.expression;
    if (!ts.isCallExpression(expr)) return [];
    const callee = expr.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
    return [{ name, args: expr.arguments }];
  });
}

/** The path literals of a route or controller decorator; any other form fails the scan. */
function literalPaths(args: readonly ts.Expression[], where: string): string[] {
  const first = args[0];
  if (!first) return [''];
  if (ts.isStringLiteralLike(first)) return [first.text];
  if (ts.isArrayLiteralExpression(first) && first.elements.every(ts.isStringLiteralLike)) {
    return first.elements.map((element) => (element as ts.StringLiteralLike).text);
  }
  if (ts.isObjectLiteralExpression(first)) {
    const pathProperty = first.properties.find(
      (property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && property.name.getText() === 'path',
    );
    if (!pathProperty) return [''];
    return literalPaths([pathProperty.initializer], where);
  }
  throw new Error(`${where}: a route path that is not a string literal (${first.getText()})`);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The signs, in `text`, that a route sends a file: a `StreamableFile`, a `Content-Disposition`
 * header, a download (`res.download`, `res.sendFile`, `res.attachment`), a body or buffer written
 * to the response (`res.send(content)`, `res.end(buffer)`), a stream piped into it.
 * `responses`: the names the response object goes by.
 */
export function fileSigns(text: string, responses: Iterable<string>): string[] {
  const signs = new Set<string>();
  if (/\bStreamableFile\b/.test(text)) signs.add('StreamableFile');
  if (/content-disposition/i.test(text)) signs.add('Content-Disposition');
  for (const name of responses) {
    const res = escapeRegExp(name);
    if (new RegExp(`\\b${res}\\s*\\.\\s*(download|sendFile|attachment)\\s*\\(`).test(text)) signs.add('download');
    if (new RegExp(`\\.pipe\\(\\s*${res}\\b`).test(text)) signs.add('stream sent');
    if (new RegExp(`\\b${res}(\\s*\\.\\s*\\w+\\([^()]*\\))*\\s*\\.\\s*(send|end)\\(\\s*[^)\\s]`).test(text)) signs.add('body sent');
  }
  return [...signs].sort();
}

/** Parameters that hold the response: `@Res()` / `@Response()`, or typed `Response`. */
function responseNames(fn: ts.SignatureDeclarationBase): string[] {
  return fn.parameters.flatMap((parameter) => {
    const decorated = decoratorCalls(parameter).some((call) => call.name === 'Res' || call.name === 'Response');
    const typed = parameter.type ? /^(express\.)?Response\b/.test(parameter.type.getText()) : false;
    return (decorated || typed) && ts.isIdentifier(parameter.name) ? [parameter.name.text] : [];
  });
}

function controllerFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && fs.readFileSync(full, 'utf8').includes('@Controller(')) files.push(full);
    }
  };
  walk(backendPath('src'));
  return files.sort();
}

/** Every route of the API with its export and file signs. */
export function scanRoutes(): ScannedRoute[] {
  const srcRoot = backendPath('src');
  const routes: ScannedRoute[] = [];
  for (const file of controllerFiles()) {
    const relative = path.relative(srcRoot, file);
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    // Functions of the file a route may call (declarations and `const name = (...) =>`).
    const fileFunctions = new Map<string, ts.Node>();
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) fileFunctions.set(statement.name.text, statement);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer
            && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
            fileFunctions.set(declaration.name.text, declaration.initializer);
          }
        }
      }
    }
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      const controller = decoratorCalls(statement).find((call) => call.name === 'Controller');
      if (!controller) continue;
      const className = statement.name?.text ?? '(anonymous)';
      const bases = literalPaths(controller.args, `${relative} ${className}`);
      const members = new Map<string, ts.MethodDeclaration>();
      for (const member of statement.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) members.set(member.name.text, member);
      }
      for (const method of members.values()) {
        const calls = decoratorCalls(method);
        const routeCalls = calls.filter((call) => ROUTE_DECORATORS.has(call.name));
        if (!routeCalls.length) continue;
        const handler = `${className}.${(method.name as ts.Identifier).text}`;
        // The method and what it calls in the same file, followed to the end.
        const seen = new Set<ts.Node>([method]);
        const queue: ts.Node[] = [method];
        const names = new Set<string>(['res', 'response']);
        let text = '';
        while (queue.length) {
          const node = queue.shift()!;
          const nodeText = node.getText(source);
          text += `\n${nodeText}`;
          if (ts.isFunctionLike(node)) for (const name of responseNames(node)) names.add(name);
          for (const match of nodeText.matchAll(/this\.(\w+)\s*\(/g)) {
            const callee = members.get(match[1]);
            if (callee && !seen.has(callee)) { seen.add(callee); queue.push(callee); }
          }
          for (const match of nodeText.matchAll(/(?<![.\w])(\w+)\s*\(/g)) {
            const callee = fileFunctions.get(match[1]);
            if (callee && !seen.has(callee)) { seen.add(callee); queue.push(callee); }
          }
        }
        const marked = calls.some((call) => call.name === 'ExportRoute');
        const signs = fileSigns(text, names);
        for (const routeCall of routeCalls) {
          for (const base of bases) {
            for (const own of literalPaths(routeCall.args, handler)) {
              const route = joinRoutePath(base, own);
              routes.push({
                route: `${routeCall.name.toUpperCase()} ${route}`,
                file: relative,
                handler,
                recordedAsExport: isExportRoutePath(route) || marked,
                fileSigns: signs,
              });
            }
          }
        }
      }
    }
  }
  return routes;
}
