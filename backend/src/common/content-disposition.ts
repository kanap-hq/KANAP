/** Build an RFC 5987-compliant Content-Disposition header value. */
export function contentDisposition(filename: string, type: 'attachment' | 'inline' = 'attachment'): string {
  if (!filename) return type;
  // `\` and `"` are escaped together in the quoted form; either one, like a non-ASCII
  // character, also adds the `filename*` form, which carries the exact name.
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/[\\"]/g, '\\$&');
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  if (ascii === filename) {
    return `${type}; filename="${filename}"`;
  }
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
