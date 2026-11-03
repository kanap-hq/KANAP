/**
 * The field labels of a "Missing: …" message, joined for the middle of a sentence: sentence case
 * lowers each label's first letter ("Missing: paying company, account"). German keeps it (nouns
 * take a capital there), and so does a label that starts with an acronym ("IT tower").
 */
export function missingFieldsList(labels: string[], language: string | undefined): string {
  const german = (language ?? '').toLowerCase().startsWith('de');
  return labels
    .map((label) => {
      if (german) return label;
      const [first, second] = Array.from(label);
      if (!first || (second && second !== second.toLocaleLowerCase())) return label;
      return first.toLocaleLowerCase(language) + label.slice(first.length);
    })
    .join(', ');
}
