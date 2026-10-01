import { parseString } from '@fast-csv/parse';

const LINE_BREAK = /\r\n|\r|\n/g;

/** fast-csv's own test for a row `ignoreEmpty` drops: every cell blank or whitespace. */
function isEmptyRecord(values: string[]): boolean {
  return values.join('').replace(/\s+/g, '') === '';
}

/**
 * The physical line of the file where each data row starts, in the order a
 * `parseString(content, { headers: true, ignoreEmpty: true, delimiter })`
 * emits them: `lines[i]` is the line of the i-th data row.
 *
 * `ignoreEmpty` drops blank lines, so a row's index no longer tells its line
 * (`index + 2` drifts after a blank line), and a quoted cell may span several
 * lines. This reads the file again without dropping anything and counts the
 * line breaks each record consumes. Use `rowLine(lines, index)` to read it.
 */
export async function csvDataRowLines(content: string, delimiter: string): Promise<number[]> {
  const records: string[][] = [];
  await new Promise<void>((resolve, reject) => {
    parseString(content, { headers: false, delimiter, ignoreEmpty: false })
      .on('error', reject)
      .on('data', (values: string[]) => records.push(values))
      .on('end', () => resolve());
  });
  const lines: number[] = [];
  let line = 1;
  let headerSeen = false;
  for (const values of records) {
    if (!isEmptyRecord(values)) {
      if (headerSeen) lines.push(line);
      headerSeen = true;
    }
    // One line for the record itself, plus the line breaks inside its quoted cells.
    line += 1 + (values.join('').match(LINE_BREAK)?.length ?? 0);
  }
  return lines;
}

/** The line of the data row at `index` (0-based), or the old `index + 2` if the file could not be mapped. */
export function rowLine(lines: readonly number[], index: number): number {
  return lines[index] ?? index + 2;
}
