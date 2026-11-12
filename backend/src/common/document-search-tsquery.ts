/**
 * SQL fragment matching the bilingual document search vector built by
 * `documents_search_vector_compute()` (migrations 1852900000000 and
 * 1856190000000), which the `documents_search_vector_sync()` trigger calls: the same text is
 * indexed under both `kanap_fr` and `kanap_en` (unaccent + language stemmer),
 * so queries must OR the two configurations to get accent folding and
 * French/English stemming in either direction.
 *
 * `paramRef` is the SQL placeholder holding the raw user query
 * (e.g. `$1` or `:searchTerm`).
 */
export function bilingualDocumentTsQuerySql(paramRef: string): string {
  return `(websearch_to_tsquery('kanap_fr', ${paramRef}) || websearch_to_tsquery('kanap_en', ${paramRef}))`;
}

const ANY_TERM_QUERY_STOP_WORDS = new Set([
  'a',
  'au',
  'aux',
  'avec',
  'ce',
  'ces',
  'cette',
  'dans',
  'de',
  'des',
  'du',
  'elle',
  'en',
  'est',
  'et',
  'faire',
  'fait',
  'il',
  'je',
  'la',
  'le',
  'les',
  'mes',
  'mon',
  'ma',
  'notre',
  'nous',
  'ou',
  'par',
  'pas',
  'plus',
  'pour',
  'qui',
  'que',
  'quoi',
  'un',
  'une',
  'son',
  'sa',
  'ses',
  'sur',
  'the',
  'to',
  'of',
  'and',
  'or',
  'in',
  'with',
  'for',
]);

export function normalizeDocumentAnyTermQuery(value: string): string {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const rawToken of String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}'-]+/gu, ' ')
    .split(/\s+/)) {
    for (const part of rawToken.split(/['-]/)) {
      const token = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (token.length < 3 || ANY_TERM_QUERY_STOP_WORDS.has(token) || seen.has(token)) {
        continue;
      }
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens.length > 0 ? tokens.join(' ') : String(value ?? '').trim();
}

function anyTermTsQuerySql(config: 'kanap_fr' | 'kanap_en', paramRef: string): string {
  const query = `websearch_to_tsquery('${config}', ${paramRef})`;
  return `(CASE
    WHEN ${query}::text LIKE '%!%' THEN ${query}
    ELSE replace(${query}::text, '&', '|')::tsquery
  END)`;
}

/**
 * High-recall AI retrieval variant: keep websearch_to_tsquery's parsing and
 * sanitisation, but turn positive term conjunctions into disjunctions so an
 * otherwise relevant document is not vetoed by one extra generated term.
 *
 * Queries with a NOT operator are intentionally left in their original form:
 * blindly transforming `foo & !bar` into `foo | !bar` would match almost
 * everything that does not contain `bar`.
 */
export function bilingualDocumentTsQueryAnyTermSql(paramRef: string): string {
  return `(${anyTermTsQuerySql('kanap_fr', paramRef)} || ${anyTermTsQuerySql('kanap_en', paramRef)})`;
}
