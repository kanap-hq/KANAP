import type { ErrorObject } from 'ajv';
import type { ZodIssue } from 'zod';

/**
 * Readable reasons for a tool input refused by its schema, for the caller's model (Plaid chat
 * and MCP clients get the message of the error): which field, and why. Only facts of the
 * schema: field names, expected types, allowed values. Never the value sent or an internal path.
 */

/** Allowed values listed in full up to this count; a longer list points to the tool's schema. */
const MAX_LISTED_VALUES = 30;

function fieldName(path: string | Array<string | number>): string {
  const parts = Array.isArray(path) ? path.map(String) : path.split('/').filter(Boolean);
  return parts.join('.');
}

function child(parent: string, name: string): string {
  return parent ? `${parent}.${name}` : name;
}

function listValues(values: unknown[]): string {
  if (values.length > MAX_LISTED_VALUES) return `one of the ${values.length} values listed in the tool's input schema`;
  return `one of: ${values.map((value) => JSON.stringify(value)).join(', ')}`;
}

function quoted(field: string): string {
  return field ? `"${field}"` : 'the input';
}

function ajvReason(error: ErrorObject): string | null {
  const field = fieldName(error.instancePath);
  const params = error.params as Record<string, any>;
  switch (error.keyword) {
    case 'additionalProperties': {
      const accepted = Object.keys((error.parentSchema as any)?.properties ?? {});
      return `unknown field "${child(field, params.additionalProperty)}"${accepted.length ? ` (accepted: ${accepted.join(', ')})` : ''}`;
    }
    case 'required':
      return `missing required field "${child(field, params.missingProperty)}"`;
    case 'type':
      return `${quoted(field)} must be ${Array.isArray(params.type) ? params.type.join(' or ') : params.type}`;
    case 'enum':
      return `${quoted(field)} must be ${listValues(params.allowedValues ?? [])}`;
    case 'const':
      return `${quoted(field)} must be ${JSON.stringify(params.allowedValue)}`;
    // A failed alternative already says what is wrong in it; the summary line adds nothing.
    case 'anyOf':
    case 'oneOf':
      return null;
    default:
      return `${quoted(field)} ${error.message ?? 'is invalid'}`;
  }
}

/** One line per problem, deduplicated, in schema order. */
export function describeAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  const reasons = (errors ?? []).map(ajvReason).filter((reason): reason is string => !!reason);
  return reasons.length ? Array.from(new Set(reasons)) : ['the input does not match the tool\'s input schema'];
}

function zodReason(issue: ZodIssue): string {
  const field = fieldName(issue.path);
  switch (issue.code) {
    case 'unrecognized_keys':
      return issue.keys.map((key) => `unknown field "${child(field, key)}"`).join('; ');
    case 'invalid_type':
      return issue.received === 'undefined'
        ? `missing required field "${field}"`
        : `${quoted(field)} must be ${issue.expected}`;
    case 'invalid_enum_value':
      return `${quoted(field)} must be ${listValues(issue.options)}`;
    case 'invalid_literal':
      return `${quoted(field)} must be ${JSON.stringify(issue.expected)}`;
    default:
      return `${quoted(field)}: ${issue.message}`;
  }
}

export function describeZodIssues(issues: ZodIssue[]): string[] {
  const reasons = issues.map(zodReason);
  return reasons.length ? Array.from(new Set(reasons)) : ['the input does not match the tool\'s input schema'];
}

/** The message of the refusal: the tool, then every reason. */
export function invalidInputMessage(toolName: string, reasons: string[]): string {
  return `Invalid input for ${toolName}: ${reasons.join('; ')}.`;
}
