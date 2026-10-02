/**
 * Whether the CAPEX list runs on the SQL list engine (lot 2B, PR C). Every CAPEX behaviour that
 * needs the engine follows this one constant:
 * - page requests ask for the lean grid rows (`shape=grid`) with the FTE columns shown (`fte=`),
 *   so showing or hiding an FTE column reloads the rows;
 * - the footer totals ask for the amount columns shown (`amounts=`);
 * - "All" then untick in a set filter keeps an exclude model (values added later show);
 * - previous / next in the workspace ask the server where the line stands (`summary/neighbors`)
 *   and prefetch the lines next door.
 * Until then (false), the CAPEX list keeps its in-memory behaviour: full rows, every footer total,
 * include models only, and previous / next from the list's ordered ids (one `summary/ids` per list
 * state, the steps computed in the browser, no prefetch). The in-memory endpoints would rebuild
 * the whole list for each of those parameters without using them.
 */
export const CAPEX_LIST_ON_ENGINE = false;
