// Budget file helper shared by the fromage fixture and the perf loader.
//
// The CSV unification branch removed the three old budget routes
// (`/spend-items/import`, `/capex-items/import`, `/budget-rows/import`) and
// replaced them with one budget file per list, loaded in two steps
// (preflight, then import). The fixture dataset and the perf dataset still
// carry the old shapes: relative `y_*` amount columns in the item files, and
// one row per (item, year, measure) with jan..dec in 29-budget-rows.csv.
//
// This module converts those shapes into the budget file layout at load time
// and runs the two calls. Layout and rules:
//   backend/src/spend/budget-file/columns.ts
//   planning/sfr/csv-unification-design.md   ("File layout", "Cell rules")
//   planning/sfr/briefs/csv-c2.md            (preflight and load contract)
//
// Files are written in English conventions (`,` separator, `.` decimal,
// `YYYY-MM-DD` dates) and both routes are called with `language=en`.

/** The five amount columns, in the order the export writes them. */
const FILE_COLUMNS = ['budget', 'revision', 'forecast', 'actual', 'landing'];

/** Detail columns before the dimension columns, per scope. */
const DETAIL_START = {
  opex: ['item_number', 'name', 'description'],
  capex: ['item_number', 'name', 'ppe_type', 'investment_type', 'priority'],
};

const DETAIL_BEFORE_DIMENSIONS = [
  'company_name', 'supplier_name', 'supplier_erp_id', 'account_number', 'cost_center_code', 'run_build',
];

const DETAIL_AFTER_DIMENSIONS = [
  'owner_it_email', 'owner_business_email', 'project', 'currency', 'effective_start', 'end_of_validity', 'notes',
];

/** Detail columns the source names differently. Everything else keeps its name. */
const DETAIL_RENAME = {
  opex: { product_name: 'name', description: 'description' },
  capex: { description: 'name' },
};

/** Detail columns copied under their own name when the source has them. */
const DETAIL_SAME_NAME = [
  'ppe_type', 'investment_type', 'priority', 'company_name', 'supplier_name', 'supplier_erp_id',
  'account_number', 'cost_center_code', 'run_build', 'owner_it_email', 'owner_business_email',
  'project', 'currency', 'effective_start', 'notes',
];

/** Old relative amount columns: [source, file column, year offset from Y]. */
const AMOUNT_SOURCE = [
  ['y_minus1_budget', 'budget', -1],
  ['y_minus1_landing', 'landing', -1],
  ['y_budget', 'budget', 0],
  ['y_follow_up', 'actual', 0],
  ['y_landing', 'landing', 0],
  ['y_revision', 'revision', 0],
  ['y_plus1_budget', 'budget', 1],
  ['y_plus1_revision', 'revision', 1],
  ['y_plus2_budget', 'budget', 2],
];

/** Stored measure and file column names, both accepted in a budget rows file. */
const MEASURE_COLUMN = {
  planned: 'budget',
  committed: 'revision',
  forecast: 'forecast',
  actual: 'actual',
  expected_landing: 'landing',
  budget: 'budget',
  revision: 'revision',
  landing: 'landing',
  follow_up: 'actual',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const PAD = (month) => String(month).padStart(2, '0');

/* ---- CSV writing (RFC 4180, English conventions) ---- */

function cell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\n') + '\n';
}

function valueOf(row, column) {
  const value = row?.[column];
  return value == null ? '' : String(value).trim();
}

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** The dimension columns of the file: the default one first, then the source's. */
export function dimensionColumns(sourceHeader, defaultDimensionCode) {
  const columns = [];
  const hasCategory = sourceHeader.includes('analytics_category');
  if (hasCategory) {
    if (!defaultDimensionCode) {
      throw new Error('defaultDimensionCode is required: the source has an analytics_category column.');
    }
    columns.push(`analytics:${defaultDimensionCode}`);
  }
  for (const column of sourceHeader) {
    if (!column.startsWith('analytics:') || column === 'analytics_category') continue;
    if (!columns.includes(column)) columns.push(column);
  }
  return columns;
}

/** The end of validity of a source row: `disabled_at`, or the end of Y-1 for a disabled row without one. */
export function endOfValidityOf(row, year) {
  const disabledAt = valueOf(row, 'disabled_at');
  if (disabledAt) return disabledAt;
  return normalized(row?.status) === 'disabled' ? `${year - 1}-12-31` : '';
}

/**
 * The lines file of one scope (OPEX or CAPEX), from a source file's rows.
 *
 * `year` is Y, the calendar year the relative `y_*` columns are read against.
 * `defaultDimensionCode` is the tenant's default analytics dimension, which
 * receives the source's `analytics_category` values. `existingNumbers` maps a
 * line name to its `item_number`: a name found there is an update, anything
 * else is a new line (blank `item_number`).
 */
export function buildLinesFile(scope, sourceRows, { year, defaultDimensionCode, existingNumbers } = {}) {
  if (scope !== 'opex' && scope !== 'capex') throw new Error(`Unknown scope '${scope}'.`);
  if (!Number.isInteger(year)) throw new Error('year is required (the calendar year of the y_* columns).');
  const rows = sourceRows ?? [];
  const sourceHeader = Object.keys(rows[0] ?? {});
  const dimensions = dimensionColumns(sourceHeader, defaultDimensionCode);
  // Amount columns in the export's order: year ascending, then the five file
  // columns in their fixed order.
  const amounts = AMOUNT_SOURCE
    .filter(([source]) => sourceHeader.includes(source))
    .map(([source, column, offset]) => ({ source, column, header: `${column}_${year + offset}`, year: year + offset }))
    .sort((a, b) => a.year - b.year || FILE_COLUMNS.indexOf(a.column) - FILE_COLUMNS.indexOf(b.column));

  const header = [
    ...DETAIL_START[scope],
    ...DETAIL_BEFORE_DIMENSIONS,
    ...dimensions,
    ...DETAIL_AFTER_DIMENSIONS,
    ...amounts.map((amount) => amount.header),
    'kanap_token',
  ];

  const numbers = existingNumbers instanceof Map ? existingNumbers : new Map(Object.entries(existingNumbers ?? {}));

  const out = rows.map((row) => {
    const values = new Map();
    const name = valueOf(row, scope === 'opex' ? 'product_name' : 'description');
    for (const [source, target] of Object.entries(DETAIL_RENAME[scope])) {
      values.set(target, valueOf(row, source));
    }
    for (const column of DETAIL_SAME_NAME) {
      if (sourceHeader.includes(column)) values.set(column, valueOf(row, column));
    }
    for (const column of dimensions) {
      const source = column === `analytics:${defaultDimensionCode}` ? 'analytics_category' : column;
      values.set(column, valueOf(row, source));
    }
    values.set('item_number', numbers.get(name) ?? '');
    values.set('end_of_validity', endOfValidityOf(row, year));
    for (const amount of amounts) values.set(amount.header, valueOf(row, amount.source));
    return header.map((column) => values.get(column) ?? '');
  });

  return toCsv(header, out);
}

/**
 * The monthly file of one scope, from the rows of 29-budget-rows.csv (both
 * scopes may be passed: rows of the other scope are ignored).
 *
 * One output row per line, with `item_number` from `numbersByName` (name ->
 * `item_number`). Rows whose item is not in that map are skipped: the caller
 * warns, as the old loader did. Only month headers are written: a yearly
 * header and the months of the same column and year never share a file.
 */
export function buildMonthlyFile(scope, budgetRows, { numbersByName } = {}) {
  if (scope !== 'opex' && scope !== 'capex') throw new Error(`Unknown scope '${scope}'.`);
  const numbers = numbersByName instanceof Map ? numbersByName : new Map(Object.entries(numbersByName ?? {}));
  const rows = (budgetRows ?? []).filter((row) => normalized(row?.item_type) === scope);

  const order = [];
  const byNumber = new Map();
  const cells = new Set();
  for (const row of rows) {
    const number = numbers.get(valueOf(row, 'item_name'));
    if (!number) continue;
    const measure = normalized(row.measure);
    const column = MEASURE_COLUMN[measure];
    if (!column) throw new Error(`Unknown measure '${row.measure}' in the budget rows file.`);
    const year = Number(row.year);
    if (!Number.isInteger(year)) throw new Error(`Unknown year '${row.year}' in the budget rows file.`);
    if (!byNumber.has(number)) {
      byNumber.set(number, new Map());
      order.push(number);
    }
    const item = byNumber.get(number);
    for (let month = 1; month <= 12; month += 1) {
      const header = `${column}_${year}_${PAD(month)}`;
      item.set(header, valueOf(row, MONTHS[month - 1]));
      cells.add(`${year}|${column}`);
    }
  }

  const groups = [...cells]
    .map((key) => {
      const [year, column] = key.split('|');
      return { year: Number(year), column };
    })
    .sort((a, b) => a.year - b.year || FILE_COLUMNS.indexOf(a.column) - FILE_COLUMNS.indexOf(b.column));

  const header = ['item_number'];
  for (const group of groups) {
    for (let month = 1; month <= 12; month += 1) {
      header.push(`${group.column}_${group.year}_${PAD(month)}`);
    }
  }

  const out = order.map((number) => {
    const item = byNumber.get(number);
    return header.map((column) => (column === 'item_number' ? number : item.get(column) ?? ''));
  });

  return toCsv(header, out);
}

/* ---- The tenant's default dimension ---- */

/** The code of the tenant's default analytics dimension (`GET /analytics-axes`). */
export async function fetchDefaultDimensionCode(request) {
  const { status, data } = await request('GET', '/analytics-axes', {});
  if (status !== 200) throw new Error(`GET /analytics-axes answered ${status}.`);
  const axes = Array.isArray(data) ? data : data?.items ?? [];
  const axis = axes.find((item) => item?.is_default === true);
  if (!axis?.code) throw new Error('The tenant has no default analytics dimension.');
  return axis.code;
}

/* ---- The two-step load ---- */

function messageOf(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data.trim();
  const message = data.message ?? data.error;
  if (Array.isArray(message)) return message.join(' ').trim();
  return String(message ?? '').trim();
}

function countRows(csv) {
  return csv.split('\n').filter((line) => line.trim().length > 0).length - 1;
}

function reportProblems(report) {
  const problems = [
    ...(report.fileErrors ?? []),
    ...(report.headerErrors ?? []),
    ...(report.errors ?? []).map((error) => {
      const where = error.column ? `${error.column} ` : '';
      return `line ${error.line}: ${where}${error.message}`;
    }),
  ];
  return problems.map((problem) => String(problem));
}

function refusal(step, response, bytes, rows) {
  const message = messageOf(response.data) || `HTTP ${response.status}`;
  return new Error(`Budget file ${step} refused (${response.status}, ${bytes.length} bytes, ${rows} rows): ${message}`);
}

/**
 * Runs the preflight then the load of one budget file.
 *
 * `request(method, path, { bytes, filename, snapshot })` is the caller's HTTP
 * client, reduced to what the two routes need: it resolves to
 * `{ status, data }` for every answer (a non-2xx answer does not throw) and it
 * sends `bytes` as the multipart field `file`, plus the multipart field
 * `snapshot` (a string) when one is given. Both routes are called with
 * `language=en&createSuppliers=true`.
 *
 * Resolves to `{ preflightMs, importMs, created, updated, unchanged, rows }`,
 * the counts coming from the preflight's `changes`. Throws with the first five
 * messages when the preflight is not ok, and on a failed load (a 409 included:
 * nothing else writes during a fixture run).
 */
export async function loadBudgetFile({ request, scope, csvText, filename }) {
  if (typeof request !== 'function') throw new Error('request is required (the caller\'s HTTP client).');
  if (scope !== 'opex' && scope !== 'capex') throw new Error(`Unknown scope '${scope}'.`);
  const bytes = Buffer.from(String(csvText ?? ''), 'utf8');
  const rows = countRows(String(csvText ?? ''));
  const name = filename || `${scope}.csv`;
  const base = scope === 'opex' ? '/spend-items/budget-file' : '/capex-items/budget-file';
  const query = '?language=en&createSuppliers=true';

  const startedPreflight = Date.now();
  const preflight = await request('POST', `${base}/preflight${query}`, { bytes, filename: name });
  const preflightMs = Date.now() - startedPreflight;
  if (preflight?.status !== 200) throw refusal('preflight', preflight ?? { status: 0, data: null }, bytes, rows);
  const report = preflight.data;
  if (!report || !Array.isArray(report.fileErrors)) {
    throw new Error(`Budget file preflight answered an unexpected body (${preflight.status}).`);
  }
  const problems = reportProblems(report);
  if (report.ok !== true || problems.length > 0) {
    const first = problems.slice(0, 5).map((problem) => `- ${problem}`).join('\n');
    const count = report.errorCount ?? problems.length;
    throw new Error(`Budget file preflight refused ${name} (${rows} rows, ${count} error(s)):\n${first}`);
  }

  const startedImport = Date.now();
  const load = await request('POST', `${base}/import${query}`, { bytes, filename: name, snapshot: report.snapshot });
  const importMs = Date.now() - startedImport;
  if (load?.status !== 200) throw refusal('import', load ?? { status: 0, data: null }, bytes, rows);
  if (load.data?.ok === false) {
    const problemsAfterLoad = reportProblems(load.data);
    const first = problemsAfterLoad.slice(0, 5).map((problem) => `- ${problem}`).join('\n');
    throw new Error(`Budget file import refused ${name} (${rows} rows):\n${first || messageOf(load.data)}`);
  }

  return {
    preflightMs,
    importMs,
    created: report.changes?.created ?? 0,
    updated: report.changes?.updated ?? 0,
    unchanged: report.changes?.unchanged ?? 0,
    rows,
  };
}
