import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Features } from '../config/features';
import { AI_SCREEN_LANGUAGES, type AiScreenLanguage } from './ai-unread-families';

/**
 * The user manual (`doc/help/docs/{en,fr,de,es}`), read by Plaid and the MCP server through
 * `list_help_topics` and `read_help_section`. The manual is public and static: the pages are read
 * once, at start, from the copy the API image carries (`/app/help-docs`, see backend/Dockerfile),
 * or from the repository's `doc/help/docs` when the API runs from a checkout (ts-node, the specs).
 * The pages the image carries are those of the running version, unlike doc.kanap.net.
 */

export const HELP_MANUAL_BASE_URL = 'https://doc.kanap.net';

/** The text one read returns at most; `truncated` says when the section holds more. */
export const HELP_SECTION_MAX_CHARS = 12_000;

/** The pages a filtered table of contents lists at most. */
export const HELP_TOPICS_FILTERED_MAX_PAGES = 10;

/** The on-premise installation pages: left out in the cloud (multi-tenant mode). */
const ON_PREMISE_PREFIX = 'on-premise/';

export type HelpManualSection = {
  /** The anchor of the heading on doc.kanap.net (`commitment-and-coverage`). */
  id: string;
  title: string;
  level: number;
  /** The titles of the H2 (and H3) above this heading, outermost first. */
  parents: string[];
  /** The line of the heading in the page, and the line where the section ends (exclusive). */
  start: number;
  end: number;
  /** The section's own text up to the next H2 or H3, normalized for the word search. */
  searchText: string;
};

export type HelpManualPage = {
  /** The path in the manual without `.md`: `contracts`, `on-premise/installation`, `index`. */
  path: string;
  title: string;
  url: string;
  lines: string[];
  sections: HelpManualSection[];
  searchTitle: string;
};

export type HelpTopicsResult = {
  language: AiScreenLanguage;
  query: string | null;
  pages: Array<{ page: string; title: string; url: string; sections: string[] }>;
  note: string;
  total: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
};

export type HelpSectionResult = {
  language: AiScreenLanguage;
  page: string;
  page_title: string;
  section: string | null;
  url: string;
  text: string;
  subsections: string[];
  chars: number;
  total: 1;
  returned: 1;
  truncated: boolean;
  complete: boolean;
};

/** Lower case, without accents: "Commitment and coverage", "Rattacher" read alike in every language. */
export function normalizeHelpText(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The anchor MkDocs gives a heading (Python-Markdown's `toc` slugify, ASCII mode). */
export function helpHeadingSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '-');
}

/** A heading's text as the page shows it: no link targets, emphasis, code marks or attribute list. */
function headingText(raw: string): { title: string; id: string | null } {
  const attr = raw.match(/\s*\{\s*#([\w-]+)[^}]*\}\s*$/);
  const text = (attr ? raw.slice(0, attr.index) : raw)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '');
  return { title: stripRepeatedly(text, /<[^>]+>/g).trim(), id: attr ? attr[1] : null };
}

/** Removes every match of `pattern`, again until none is left: one removal can join two halves into a new match. */
function stripRepeatedly(value: string, pattern: RegExp): string {
  let previous: string;
  let current = value;
  do {
    previous = current;
    current = current.replace(pattern, '');
  } while (current !== previous);
  return current;
}

/** Python-Markdown's `unique`: a second "Overview" on a page is `overview_1`. */
function uniqueId(id: string, used: Set<string>): string {
  let candidate = id;
  for (let n = 1; used.has(candidate); n += 1) candidate = `${id}_${n}`;
  used.add(candidate);
  return candidate;
}

export function helpPageUrl(language: AiScreenLanguage, pagePath: string): string {
  const prefix = language === 'en' ? '' : `/${language}`;
  const slug = pagePath === 'index' ? '' : pagePath.endsWith('/index') ? `${pagePath.slice(0, -'index'.length)}` : `${pagePath}/`;
  return `${HELP_MANUAL_BASE_URL}${prefix}/${slug}`;
}

/** One page of the manual: its title, its headings with their anchors and their extent. */
export function parseHelpPage(language: AiScreenLanguage, pagePath: string, markdown: string): HelpManualPage {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const used = new Set<string>();
  const headings: Array<{ line: number; level: number; title: string; id: string }> = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;
    const { title, id } = headingText(match[2]);
    if (!title) return;
    headings.push({ line: index, level: match[1].length, title, id: uniqueId(id ?? helpHeadingSlug(title), used) });
  });

  const h1 = headings.find((heading) => heading.level === 1);
  const sections: HelpManualSection[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  headings.forEach((heading, index) => {
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    if (heading.level >= 2) {
      const next = headings.slice(index + 1).find((other) => other.level <= heading.level);
      const nextListed = headings.slice(index + 1).find((other) => other.level <= 3);
      sections.push({
        id: heading.id,
        title: heading.title,
        level: heading.level,
        parents: stack.filter((entry) => entry.level >= 2).map((entry) => entry.title),
        start: heading.line,
        end: next ? next.line : lines.length,
        searchText: normalizeHelpText(lines.slice(heading.line, nextListed ? nextListed.line : lines.length).join('\n')),
      });
    }
    stack.push({ level: heading.level, title: heading.title });
  });

  const title = h1?.title ?? pagePath;
  return { path: pagePath, title, url: helpPageUrl(language, pagePath), lines, sections, searchTitle: normalizeHelpText(title) };
}

/**
 * The text of a page or section for a reader outside MkDocs: images, HTML wrappers, comments and
 * attribute lists removed, admonitions and tabs as a title line with their body unindented, and
 * the links to other pages of the manual written as their doc.kanap.net address.
 */
export function cleanHelpMarkdown(language: AiScreenLanguage, pagePath: string, lines: string[]): string {
  const out: string[] = [];
  // The indent of the open admonition or tab bodies, innermost last.
  const blocks: number[] = [];
  let fence: string | null = null;
  for (const raw of lines) {
    let line = raw;
    while (blocks.length && line.trim() && indentOf(line) < blocks[blocks.length - 1]) blocks.pop();
    const strip = blocks.length ? blocks.length * 4 : 0;
    if (strip) line = line.replace(new RegExp(`^ {0,${strip}}`), '');

    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }

    const block = line.match(/^(\s*)(?:!!!|\?\?\?\+?)\s+(\w[\w-]*)(?:\s+"([^"]*)")?\s*$/)
      ?? line.match(/^(\s*)===\s+()"([^"]*)"\s*$/);
    if (block) {
      const label = block[3] || (block[2] ? block[2][0].toUpperCase() + block[2].slice(1) : '');
      if (label) out.push(`${block[1]}**${label}**`);
      blocks.push(indentOf(raw) + 4);
      continue;
    }
    if (/^\s*--8<--/.test(line)) continue;

    line = stripRepeatedly(stripRepeatedly(line, /<!--[\s\S]*?-->/g), /<\/?(?:div|span|p|figure|figcaption|img|details|summary|center)\b[^>]*>/gi)
      .replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\s*\{\s*[#.:][^}]*\}\s*$/, '')
      .replace(/\]\(([^)\s]+)\)/g, (_match, target: string) => `](${helpLinkTarget(language, pagePath, target)})`);
    out.push(line.replace(/\s+$/, ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** A link of a manual page, resolved to its doc.kanap.net address; other addresses stay. */
function helpLinkTarget(language: AiScreenLanguage, pagePath: string, target: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  const [file, anchor] = target.split('#', 2);
  const hash = anchor ? `#${anchor}` : '';
  if (!file) return `${helpPageUrl(language, pagePath)}${hash}`;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(pagePath), file));
  if (resolved.startsWith('..')) return target;
  if (resolved.endsWith('.md')) return `${helpPageUrl(language, resolved.slice(0, -3))}${hash}`;
  const prefix = language === 'en' ? '' : `/${language}`;
  return `${HELP_MANUAL_BASE_URL}${prefix}/${resolved}${hash}`;
}

/**
 * The directory holding `en/index.md`: `help-docs` in the API image (next to `dist/` or `src/`),
 * `doc/help/docs` in a checkout. Looked for above this file, so ts-node, `dist/` and the compiled
 * specs of `ci-dist/` find the same pages.
 */
export function findHelpManualRoot(from = __dirname): string | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    for (const candidate of [path.join(dir, 'help-docs'), path.join(dir, 'doc', 'help', 'docs')]) {
      if (fs.existsSync(path.join(candidate, 'en', 'index.md'))) return candidate;
    }
    if (path.dirname(dir) === dir) return null;
  }
}

function listMarkdownFiles(root: string, dir = ''): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return listMarkdownFiles(root, relative);
      return entry.isFile() && entry.name.endsWith('.md') ? [relative] : [];
    })
    .sort();
}

/** The words of a filter: three letters or more, without the most common little words. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'how', 'can', 'what', 'with', 'from', 'into', 'does', 'kanap',
  'les', 'des', 'une', 'pour', 'dans', 'avec', 'comment', 'est', 'que', 'qui', 'sur', 'par', 'aux', 'faire',
  'der', 'die', 'das', 'und', 'wie', 'ein', 'eine', 'mit', 'fur', 'auf', 'den', 'dem',
  'los', 'las', 'del', 'como', 'una', 'con', 'por', 'para',
]);

function queryWords(query: string): string[] {
  return Array.from(new Set(normalizeHelpText(query).split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))));
}

function wordPattern(word: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

@Injectable()
export class AiHelpManualService {
  private readonly logger = new Logger(AiHelpManualService.name);
  private readonly pages = new Map<AiScreenLanguage, Map<string, HelpManualPage>>();

  constructor() {
    this.load(findHelpManualRoot());
  }

  /** Reads the pages of every language from `root`; null or a missing folder leaves the manual empty. */
  load(root: string | null): void {
    this.pages.clear();
    if (!root) {
      this.logger.warn('The user manual was not found: list_help_topics and read_help_section are off.');
      return;
    }
    let count = 0;
    for (const language of AI_SCREEN_LANGUAGES) {
      if (!fs.existsSync(path.join(root, language))) continue;
      const pages = new Map<string, HelpManualPage>();
      for (const file of listMarkdownFiles(path.join(root, language))) {
        const pagePath = file.slice(0, -3);
        pages.set(pagePath, parseHelpPage(language, pagePath, fs.readFileSync(path.join(root, language, file), 'utf8')));
        count += 1;
      }
      this.pages.set(language, pages);
    }
    this.logger.log(`User manual loaded: ${count} pages from ${root}.`);
  }

  available(): boolean {
    return (this.pages.get('en')?.size ?? 0) > 0;
  }

  /** The pages of one language, the on-premise installation pages left out in the cloud. */
  private pagesOf(language: AiScreenLanguage): { language: AiScreenLanguage; pages: HelpManualPage[] } {
    const resolved = this.pages.get(language)?.size ? language : 'en';
    const pages = Array.from(this.pages.get(resolved)?.values() ?? [])
      .filter((page) => Features.SINGLE_TENANT || !page.path.startsWith(ON_PREMISE_PREFIX));
    return { language: resolved, pages };
  }

  private findPage(language: AiScreenLanguage, pagePath: string): { language: AiScreenLanguage; page: HelpManualPage } {
    // A path, a file name or a doc.kanap.net address: `contracts`, `contracts.md`, `https://doc.kanap.net/fr/contracts/#relations`.
    const wanted = pagePath.trim().split('#')[0].replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^\/+|\/+$/g, '').replace(/\.md$/, '').replace(/^(?:en|fr|de|es)(?:\/|$)/, '') || 'index';
    for (const candidate of language === 'en' ? ['en' as const] : [language, 'en' as const]) {
      const { pages } = this.pagesOf(candidate);
      const page = pages.find((entry) => entry.path === wanted)
        ?? pages.find((entry) => entry.path === `${wanted}/index`)
        ?? pages.find((entry) => entry.searchTitle === normalizeHelpText(wanted));
      if (page) return { language: candidate, page };
    }
    throw new NotFoundException(`No manual page "${pagePath}". list_help_topics gives the pages and their paths.`);
  }

  /**
   * The table of contents: every page with its H2 headings, or with words, the pages that hold
   * them, best first, with the H2 and H3 sections (`Parent › Child`) where they appear.
   */
  listTopics(language: AiScreenLanguage, query?: string | null): HelpTopicsResult {
    const { language: resolved, pages } = this.pagesOf(language);
    const words = query ? queryWords(query) : [];
    if (!words.length) {
      const listed = pages.map((page) => ({
        page: page.path,
        title: page.title,
        url: page.url,
        sections: page.sections.filter((section) => section.level === 2).map((section) => section.title),
      }));
      return {
        language: resolved,
        query: query?.trim() || null,
        pages: listed,
        note: 'Every page with its main sections. read_help_section reads a page or one section by its title; words in `query` also find the subsections.',
        total: listed.length,
        returned: listed.length,
        truncated: false,
        complete: true,
      };
    }

    const patterns = words.map(wordPattern);
    const scored = pages.map((page) => {
      const titleHits = patterns.filter((pattern) => pattern.test(page.searchTitle)).length;
      const sections = page.sections
        .filter((section) => section.level <= 3)
        .map((section) => {
          const heading = normalizeHelpText(section.title);
          const score = patterns.reduce((sum, pattern) => sum + (pattern.test(heading) ? 3 : pattern.test(section.searchText) ? 1 : 0), 0);
          const covered = patterns.filter((pattern) => pattern.test(section.searchText)).length;
          return { section, score: score + covered * 2 };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score);
      const bodyWords = patterns.filter((pattern) => page.sections.some((section) => pattern.test(section.searchText))).length;
      return { page, sections, score: titleHits * 4 + bodyWords * 2 + (sections[0]?.score ?? 0) };
    })
      .filter((entry) => entry.sections.length > 0 || entry.score > 0)
      .sort((left, right) => right.score - left.score);

    const listed = scored.slice(0, HELP_TOPICS_FILTERED_MAX_PAGES).map(({ page, sections }) => ({
      page: page.path,
      title: page.title,
      url: page.url,
      sections: sections.slice(0, 8)
        .sort((left, right) => left.section.start - right.section.start)
        .map(({ section }) => [...section.parents, section.title].join(' › ')),
    }));
    return {
      language: resolved,
      query: query!.trim(),
      pages: listed,
      note: 'The pages holding these words, best first, with the sections where they appear. Without a match, list_help_topics without words gives every page.',
      total: scored.length,
      returned: listed.length,
      truncated: scored.length > listed.length,
      complete: scored.length <= listed.length,
    };
  }

  /** One page, or one of its sections (by title, `Parent › Child`, or anchor), as text with its link. */
  readSection(language: AiScreenLanguage, pagePath: string, sectionName?: string | null, maxChars = HELP_SECTION_MAX_CHARS): HelpSectionResult {
    const { language: resolved, page } = this.findPage(language, pagePath);
    const section = sectionName?.trim() ? this.findSection(page, sectionName.trim()) : null;
    const lines = section ? page.lines.slice(section.start, section.end) : page.lines;
    const text = cleanHelpMarkdown(resolved, page.path, lines);
    const truncated = text.length > maxChars;
    // Cut at a line end when one is near the cap.
    const lineEnd = text.lastIndexOf('\n', maxChars);
    const cut = truncated ? text.slice(0, lineEnd > maxChars / 2 ? lineEnd : maxChars) : text;
    const inner = page.sections.filter((entry) => entry.start > (section?.start ?? -1) && entry.end <= (section?.end ?? page.lines.length)
      && entry.level === (section ? section.level + 1 : 2));
    return {
      language: resolved,
      page: page.path,
      page_title: page.title,
      section: section ? section.title : null,
      url: section ? `${page.url}#${section.id}` : page.url,
      text: cut,
      subsections: inner.map((entry) => entry.title),
      chars: text.length,
      total: 1,
      returned: 1,
      truncated,
      complete: !truncated,
    };
  }

  private findSection(page: HelpManualPage, name: string): HelpManualSection {
    const parts = name.split('›').map((part) => normalizeHelpText(part.replace(/^#/, '').trim())).filter(Boolean);
    const wanted = parts[parts.length - 1] ?? '';
    const parents = parts.slice(0, -1);
    const underParents = (section: HelpManualSection) => parents.every((parent) =>
      section.parents.some((title) => normalizeHelpText(title) === parent));
    const candidates = page.sections.filter(underParents);
    const section = candidates.find((entry) => entry.id === wanted)
      ?? candidates.find((entry) => normalizeHelpText(entry.title) === wanted)
      ?? candidates.find((entry) => entry.id === helpHeadingSlug(wanted))
      ?? candidates.find((entry) => normalizeHelpText(entry.title).startsWith(wanted))
      ?? candidates.find((entry) => normalizeHelpText(entry.title).includes(wanted));
    if (section) return section;
    const titles = page.sections.filter((entry) => entry.level <= 3).map((entry) => entry.title).join('; ');
    throw new NotFoundException(`No section "${name}" on the manual page "${page.path}". Its sections: ${titles}.`);
  }
}
