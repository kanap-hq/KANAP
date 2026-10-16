import { BadRequestException } from '@nestjs/common';

/**
 * Where a link row comes from (plan planning/cartographie-technologies.md, "Provenance des liens").
 * A link table that records it carries three columns:
 * - `source text NOT NULL DEFAULT 'manual'`, CHECK on `LINK_SOURCES`;
 * - `source_ref text NULL` (at most `SOURCE_REF_MAX` characters): the import, mutation plan or agent
 *   that wrote the row;
 * - `observed_at timestamptz NULL`: when an automatic source last saw the link; NULL for a link
 *   typed by a person.
 * A manual write sets `source = 'manual'` and clears the other two. The proof of a proposal and the
 * refusals have no link row: they live elsewhere (the side table of R3).
 *
 * First users: `asset_technologies` and `application_technologies` (migration 1854190000000). A
 * new link table copies the columns and calls `linkProvenance()`; nothing here names a table.
 */

export const LINK_SOURCES = ['manual', 'import', 'ai', 'agent', 'netbox'] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

export const SOURCE_REF_MAX = 200;

/** The three columns, in the order `LINK_PROVENANCE_COLUMNS` names them. */
export type LinkProvenance = { source: LinkSource; source_ref: string | null; observed_at: Date | null };

/** The column list, for an INSERT or a SELECT: `source, source_ref, observed_at`. */
export const LINK_PROVENANCE_COLUMNS = ['source', 'source_ref', 'observed_at'] as const;

/** The provenance of a link a person typed. */
export const MANUAL_PROVENANCE: LinkProvenance = Object.freeze({ source: 'manual', source_ref: null, observed_at: null }) as LinkProvenance;

export function isLinkSource(value: unknown): value is LinkSource {
  return typeof value === 'string' && (LINK_SOURCES as readonly string[]).includes(value);
}

/**
 * The three column values of a link written by `source`. A manual link has no reference and no
 * observation date; an automatic one is observed now unless `observedAt` says when. An unknown
 * source or an over-long reference is a 400.
 */
export function linkProvenance(
  source: LinkSource | string = 'manual',
  sourceRef?: string | null,
  observedAt?: Date | string | null,
): LinkProvenance {
  if (!isLinkSource(source)) throw new BadRequestException(`Unknown link source: ${String(source)}.`);
  if (source === 'manual') return { ...MANUAL_PROVENANCE };
  const ref = sourceRef == null ? null : String(sourceRef).trim() || null;
  if (ref && ref.length > SOURCE_REF_MAX) throw new BadRequestException(`The source reference is longer than ${SOURCE_REF_MAX} characters.`);
  const observed = observedAt == null ? new Date() : new Date(observedAt);
  if (Number.isNaN(observed.getTime())) throw new BadRequestException('Invalid observation date.');
  return { source, source_ref: ref, observed_at: observed };
}

/** The values in `LINK_PROVENANCE_COLUMNS` order, to append to the parameters of a statement. */
export function provenanceParams(provenance: LinkProvenance): [LinkSource, string | null, Date | null] {
  return [provenance.source, provenance.source_ref, provenance.observed_at];
}
