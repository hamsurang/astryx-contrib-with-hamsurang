import { parse as parseYaml } from 'yaml';
import type { Authority, Frontmatter, Section } from './types.js';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseFrontmatter(text: string): { frontmatter?: Record<string, unknown>; body: string } {
  const m = FM_RE.exec(text);
  if (!m) return { body: text };
  const body = text.slice(m[0].length).replace(/^\r?\n/, '');
  try {
    const fm = parseYaml(m[1]);
    if (fm && typeof fm === 'object' && !Array.isArray(fm)) {
      return { frontmatter: fm as Record<string, unknown>, body };
    }
    return { body };
  } catch (err) {
    console.error(`frontmatter parse failed: ${(err as Error).message}`);
    return { body: text };
  }
}

const LIST_FIELDS = [
  'applies_to', 'verified_by', 'review_triggers', 'families', 'architecture',
  'modules', 'members', 'components', 'design_specs',
] as const;

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return [v];
  return [];
}

export function normalizeFrontmatter(raw: Record<string, unknown>): Frontmatter {
  const fm = {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    kind: typeof raw.kind === 'string' ? raw.kind : undefined,
    authority: typeof raw.authority === 'string' ? (raw.authority as Authority) : undefined,
    parent_component: typeof raw.parent_component === 'string' ? raw.parent_component : undefined,
  } as Frontmatter;
  for (const f of LIST_FIELDS) fm[f] = list(raw[f]);
  return fm;
}

export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const HEADING_RE = /^(#{1,3})\s+(.+?)(?:\s+#+)?\s*$/;

function getFenceMarker(line: string): '```' | '~~~' | null {
  const m = /^\s*(```|~~~)/.exec(line);
  return m ? (m[1] as '```' | '~~~') : null;
}

export function splitSections(docId: string, body: string): Section[] {
  const sections: Section[] = [];
  const used = new Map<string, number>();
  let current: Section = { id: `${docId}#intro`, heading: '', level: 0, body: '' };
  let lines: string[] = [];
  let fence: '```' | '~~~' | null = null;

  const flush = () => {
    current.body = lines.join('\n').trim();
    if (current.level > 0 || current.body) sections.push(current);
    lines = [];
  };

  for (const line of body.split(/\r?\n/)) {
    const marker = getFenceMarker(line);
    if (marker) {
      if (fence === marker) {
        fence = null;
      } else if (fence === null) {
        fence = marker;
      }
    }
    const m = fence ? null : HEADING_RE.exec(line);
    if (m) {
      flush();
      const base = slugify(m[2]);
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      current = { id: `${docId}#${n === 1 ? base : `${base}-${n}`}`, heading: m[2].trim(), level: m[1].length, body: '' };
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

export function titleOf(body: string, fallback: string): string {
  let fence: '```' | '~~~' | null = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = getFenceMarker(line);
    if (marker) {
      if (fence === marker) {
        fence = null;
      } else if (fence === null) {
        fence = marker;
      }
    }
    if (!fence) {
      const m = /^#\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
      if (m) return m[1].trim();
    }
  }
  return fallback;
}
