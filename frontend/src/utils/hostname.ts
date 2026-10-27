/**
 * What the asset form accepts as a host name, mirroring the backend rule in
 * `backend/src/assets/hostname.util.ts`.
 *
 * A host name is one or more RFC 1123 labels separated by single dots. Device
 * names such as `DL3.ROBOT-15MS.IE2000` carry dots that are part of the name
 * and not a DNS domain, so they are valid; `srv01` stays valid too.
 */

const HOSTNAME_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;

export const HOSTNAME_MAX_LENGTH = 253;
export const HOSTNAME_LABEL_MAX_LENGTH = 63;

export function isValidHostname(value: string): boolean {
  if (value.length === 0 || value.length > HOSTNAME_MAX_LENGTH) return false;
  return value
    .split('.')
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= HOSTNAME_LABEL_MAX_LENGTH &&
        HOSTNAME_LABEL_RE.test(label),
    );
}

/**
 * Turns a free-text asset name into a usable host name: lower case, spaces and
 * underscores become hyphens, anything else that is not a letter, digit, hyphen
 * or dot is dropped, and no label is left empty or hyphen-edged.
 */
export function sanitizeHostname(value: string): string {
  const labels = value
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-.]/g, '')
    .split('.')
    .map((label) =>
      label
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, HOSTNAME_LABEL_MAX_LENGTH)
        // The length cut runs after edge hyphens are removed, so it can end on one.
        .replace(/-+$/, ''),
    )
    .filter((label) => label.length > 0);
  // The 253 cut can end on a hyphen, or on the dot of a label the cut dropped.
  return labels.join('.').slice(0, HOSTNAME_MAX_LENGTH).replace(/[-.]+$/, '');
}
