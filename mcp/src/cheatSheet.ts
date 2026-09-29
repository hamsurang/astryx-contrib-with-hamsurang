import type { Doc } from './types.js';

export const CHEAT_SHEET_ID = 'wiki:Architecture-Cheat-Sheet';

/** A row of the "Choose only what applies" table: trigger → owner API. */
export interface OwnerApiRow { trigger: string; ownerApi: string; hooks: string[] }

/** A `###` section under "Tier 1" or "Tier 2". */
export interface TierSection { tier: 1 | 2; heading: string; sectionId: string; summary: string; route?: string; hooks: string[] }

export interface CheatSheet { rows: OwnerApiRow[]; sections: TierSection[] }

const HOOK = /\buse[A-Z][A-Za-z0-9]*/g;

function hooksIn(text: string): string[] {
  return [...new Set([...text.matchAll(HOOK)].map((m) => m[0]))];
}

function cells(line: string): string[] | null {
  const s = line.trim();
  if (!s.startsWith('|')) return null;
  return s.split('|').slice(1, -1).map((c) => c.trim());
}

export function parseOwnerApiTable(body: string): OwnerApiRow[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => cells(l)?.[0]?.toLowerCase() === 'trigger');
  if (start === -1) return [];
  const rows: OwnerApiRow[] = [];
  for (const line of lines.slice(start + 1)) {
    const c = cells(line);
    if (!c) break;
    if (c.every((x) => /^-+$/.test(x))) continue;
    if (c.length < 2) continue;
    rows.push({ trigger: c[0], ownerApi: c[1], hooks: hooksIn(c[1]) });
  }
  return rows;
}

export function parseTierSections(doc: Doc): TierSection[] {
  const out: TierSection[] = [];
  let tier: 0 | 1 | 2 = 0;
  for (const s of doc.sections) {
    if (s.level <= 2) {
      tier = /^Tier 1/.test(s.heading) ? 1 : /^Tier 2/.test(s.heading) ? 2 : 0;
      continue;
    }
    if (!tier || s.level !== 3) continue;
    const paragraphs = s.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const summary = paragraphs.find((p) => !p.startsWith('```') && !p.startsWith('Route:')) ?? '';
    const route = paragraphs.find((p) => p.startsWith('Route:'))?.replace(/^Route:\s*/, '');
    out.push({ tier, heading: s.heading, sectionId: s.id, summary: summary.replace(/\s+/g, ' '), ...(route ? { route } : {}), hooks: hooksIn(s.body) });
  }
  return out;
}

export function parseCheatSheet(doc: Doc | undefined): CheatSheet | undefined {
  if (!doc) return undefined;
  const table = doc.sections.find((s) => /^Choose only what applies/i.test(s.heading));
  return { rows: table ? parseOwnerApiTable(table.body) : [], sections: parseTierSections(doc) };
}

/** Small synonym table so an issue that says "label" also reaches rows about accessible names. */
const SYNONYMS: Record<string, string[]> = {
  label: ['name', 'aria'], name: ['label', 'aria'], a11y: ['accessib', 'aria'], accessibility: ['aria', 'a11y'],
  hover: ['reveal'], focus: ['trap', 'restore'], dismiss: ['layer', 'escape'], escape: ['dismiss', 'layer'],
  popover: ['layer'], dialog: ['layer', 'modal'], modal: ['dialog', 'layer'], tooltip: ['layer'],
  theme: ['themeprops', 'visual'], color: ['theme', 'token'], rtl: ['direction', 'i18n'], locale: ['i18n'],
  size: ['density'], padding: ['container', 'bleed'], keyboard: ['focus', 'typeahead'], link: ['router', 'navigation'],
  input: ['field'], form: ['field', 'input'], announce: ['status', 'live'], loading: ['status', 'busy'],
};

export function expandKeywords(keywords: string[]): string[] {
  const out = new Set<string>();
  for (const k of keywords.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 2)) {
    out.add(k);
    for (const s of SYNONYMS[k] ?? []) out.add(s);
  }
  return [...out];
}

export interface CheatMatch<T> { item: T; matchedBy: string[] }

export function matchCheatSheet(sheet: CheatSheet, keywords: string[], hooks: string[]): { rows: CheatMatch<OwnerApiRow>[]; sections: CheatMatch<TierSection>[] } {
  const kws = expandKeywords(keywords);
  const hookSet = new Set(hooks);
  const hit = (text: string, rowHooks: string[]) => {
    const lower = text.toLowerCase();
    const by = kws.filter((k) => lower.includes(k));
    for (const h of rowHooks) if (hookSet.has(h)) by.push(h);
    return [...new Set(by)];
  };
  const rows = sheet.rows.map((r) => ({ item: r, matchedBy: hit(`${r.trigger} ${r.ownerApi}`, r.hooks) })).filter((m) => m.matchedBy.length);
  const sections = sheet.sections.map((s) => ({ item: s, matchedBy: hit(`${s.heading} ${s.summary}`, s.hooks) })).filter((m) => m.matchedBy.length);
  return { rows, sections };
}
