import { z } from 'zod';

/**
 * The message Zod 3 produced for an issue. Zod 4 rewords its defaults ("Invalid input: expected
 * string, received undefined" for "Required", "Invalid option: expected one of ..." for an enum
 * refusal); the API keeps the Zod 3 sentences so that a failing request reads the same as before.
 * Custom messages (a refinement, a `message` on a check) pass through unchanged.
 *
 * The issue's `input` is only present when the schema was parsed with `{ reportInput: true }`;
 * without it the helpers fall back to the message Zod 4 built, which still names the reason.
 */
export function legacyIssueMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type': {
      const received = issue.input !== undefined ? receivedType(issue.input) : receivedFromMessage(issue.message);
      if (!received || received === 'undefined') return 'Required';
      return `Expected ${legacyExpected(issue.expected)}, received ${received}`;
    }
    case 'invalid_value': {
      const options = issue.values.map((value) => (typeof value === 'string' ? `'${value}'` : JSON.stringify(value))).join(' | ');
      if (issue.input === undefined) return 'Required';
      if (typeof issue.input === 'string') {
        return `Invalid enum value. Expected ${options}, received '${issue.input}'`;
      }
      return `Expected ${options}, received ${receivedType(issue.input)}`;
    }
    case 'invalid_format':
      if (issue.format === 'uuid') return 'Invalid uuid';
      if (issue.format === 'email') return 'Invalid email';
      return issue.message;
    default:
      return issue.message;
  }
}

/** `ZodError.flatten()` with the Zod 3 messages, for the responses that carried them before. */
export function legacyFlattenError(error: z.ZodError): {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
} {
  const formErrors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const message = legacyIssueMessage(issue);
    if (issue.path.length === 0) {
      formErrors.push(message);
      continue;
    }
    const field = String(issue.path[0]);
    (fieldErrors[field] ??= []).push(message);
  }
  return { formErrors, fieldErrors };
}

function legacyExpected(expected: string): string {
  return expected === 'int' || expected === 'float' ? 'number' : expected;
}

function receivedFromMessage(message: string): string | null {
  const match = /received ([a-z]+)$/.exec(message);
  return match ? match[1] : null;
}

function receivedType(input: unknown): string {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  if (input instanceof Date) return 'date';
  if (typeof input === 'number' && Number.isNaN(input)) return 'nan';
  return typeof input;
}
