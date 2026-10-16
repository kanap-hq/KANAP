import { describe, expect, it } from 'vitest';

// Dates are typed and picked with the app's fields (DateEUField, IncidentDateTimeField), which
// follow the app's language. The browser's date inputs follow the browser's language: none is left.
const sources = import.meta.glob<string>(['../../**/*.tsx', '!../../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });

// A `type` attribute or property set to a browser date input (not a CSS selector `input[type="date"]`).
const NATIVE_DATE_INPUT = /(?<!\[)\btype(?:=\{?|:\s*)["'](?:date|datetime-local|month|week)["']/;

describe('date inputs', () => {
  it('no browser date input in the app', () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => NATIVE_DATE_INPUT.test(source))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('the roadmap start date and pin dates use the app date field', () => {
    const roadmap = sources['../../pages/portfolio/components/RoadmapGenerator.tsx'];
    expect(roadmap).toBeTruthy();
    expect(roadmap.match(/<DateEUField\b/g)?.length).toBe(2);
  });
});
