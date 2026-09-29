import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { CHEAT_SHEET_ID, matchCheatSheet, parseCheatSheet, type CheatMatch, type OwnerApiRow, type TierSection } from '../cheatSheet.js';
import { analyzeComponent, locateComponent, suggestComponents, type SyncTarget } from '../component.js';
import { fail, json, type ToolContext } from '../context.js';
import { dirContains } from '../match.js';
import { ghErrorMessage, ghJson } from '../sources/gh.js';
import { prsTouching, prStats, type PrStats } from '../sources/prs.js';

export const estimateChangeScopeInput = z.object({
  name: z.string().min(1).describe('Component or sub-component name'),
  issue: z.number().int().positive().optional().describe('Upstream issue number; its title, labels and body supply keywords'),
  keywords: z.array(z.string()).optional().describe('Extra keywords describing the change (e.g. "aria-label", "hover", "size")'),
});

export interface AccountingItem { file: string; reason: string; rule: string }

export type SizeClass = 'S' | 'M' | 'L';

export interface EstimateResult {
  dir: string;
  focus?: string;
  keywords: string[];
  issue?: { number: number; title: string; labels: string[] };
  mustTouch: (SyncTarget & { from: string })[];
  accounting: AccountingItem[];
  cheatSheetRows: { rows: CheatMatch<OwnerApiRow>[]; sections: CheatMatch<TierSection>[] };
  estimate: { sizeClass: SizeClass; basis: PrStats } | { sizeClass: 'insufficient data'; basis?: PrStats };
  warnings: string[];
}

const PROP_WORDS = ['prop', 'props', 'default', 'type', 'api', 'option', 'rename', 'deprecat'];
const A11Y_WORDS = ['aria', 'role', 'focus', 'name', 'label', 'a11y', 'accessib', 'keyboard', 'screen reader', 'announce', 'tab'];

export function sizeClassOf(files: number, lines: number): SizeClass {
  if (files <= 3 && lines <= 80) return 'S';
  if (files <= 8 && lines <= 300) return 'M';
  return 'L';
}

/** Words from an issue title/labels, plus every PascalCase identifier that names a component. */
export function keywordsFromIssue(issue: { title: string; labels: string[]; body: string }): string[] {
  const words = issue.title.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const pascal = `${issue.title}\n${issue.body}`.match(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g) ?? [];
  return [...new Set([...words, ...issue.labels.map((l) => l.toLowerCase()), ...pascal])];
}

export function estimateChangeScope(ctx: ToolContext, input: z.infer<typeof estimateChangeScopeInput>): EstimateResult | { error: string; suggestions: string[] } {
  const loc = locateComponent(ctx.repoRoot, input.name);
  if (!loc) return { error: `no component named ${input.name}`, suggestions: suggestComponents(ctx.repoRoot, input.name) };
  const report = analyzeComponent(ctx.repoRoot, loc);
  const warnings = [...ctx.index.warnings, ...report.warnings];

  let issue: EstimateResult['issue'];
  const keywords = new Set((input.keywords ?? []).map((k) => k.toLowerCase()));
  if (input.issue) {
    try {
      const raw = ghJson<{ number: number; title: string; body: string; labels: { name: string }[] }>(ctx.gh, [
        'issue', 'view', String(input.issue), '--repo', ctx.upstream, '--json', 'number,title,body,labels',
      ]);
      const labels = raw.labels.map((l) => l.name);
      issue = { number: raw.number, title: raw.title, labels };
      for (const k of keywordsFromIssue({ title: raw.title, labels, body: raw.body ?? '' })) keywords.add(k.toLowerCase());
    } catch (err) {
      warnings.push(`issue #${input.issue} not loaded: ${ghErrorMessage(err)}`);
    }
  }
  const kws = [...keywords];
  const has = (words: string[]) => kws.some((k) => words.some((w) => k.includes(w)));

  const units = loc.focus ? report.units.filter((u) => u.name === loc.focus) : report.units;
  const mustTouch: EstimateResult['mustTouch'] = [];
  for (const u of units) for (const t of u.syncTargets) if (!mustTouch.some((m) => m.path === t.path)) mustTouch.push({ ...t, from: u.impl });

  const accounting: AccountingItem[] = [];
  const add = (file: string, reason: string, rule: string) => { if (!accounting.some((a) => a.file === file)) accounting.push({ file, reason, rule }); };
  add('.changeset/<name>.md', 'any change under packages/* ships with a changeset (patch unless [breaking])', 'changeset');
  const records = [...ctx.index.docs.values()].filter((d) => d.source === 'repo' && d.frontmatter && ['component', 'module'].includes(d.frontmatter.kind ?? '') && dirContains(loc.dir, d.path));
  for (const d of records) {
    const fm = d.frontmatter!;
    const overlap = fm.review_triggers.filter((t) => kws.some((k) => k.includes(t) || t.includes(k)));
    if (fm.authority === 'current' && (overlap.length || !kws.length)) {
      add(d.path, overlap.length ? `authority: current record with review_triggers ${overlap.join(', ')} matching the keywords` : 'authority: current record; check whether the contract lines still hold', 'spec');
    }
    for (const t of fm.verified_by) add(t, `verified_by of ${d.id}: run it, and extend it if the contract changes`, 'verified_by');
    for (const f of fm.families) {
      const fam = ctx.index.get(f);
      if (fam) add(fam.path, `family contract ${f}: read it so the change does not drift from siblings`, 'family');
    }
  }
  for (const u of units) {
    if (u.doc && has(PROP_WORDS)) add(u.doc, 'props table, defaults and features must match shipped behavior', 'doc');
    if (has(A11Y_WORDS)) {
      const states = report.files.filter((f) => f.role === 'a11y-states' || f.role === 'a11y-known-failures');
      for (const f of states) add(f.path, 'a11y keywords: binding states / known-failures may need a row added or removed', 'a11y');
      if (!states.length) add(`${loc.dir}/__tests__/${u.name}.a11y.states.ts`, 'a11y keywords but no binding yet: the reviewer asks for contract evidence', 'a11y');
    }
  }
  for (const s of report.stories) add(s, 'the reviewer reproduces claims in a story; add or extend one for the changed state', 'story');
  if (has(['rtl', 'direction', 'locale', 'i18n'])) add('apps/storybook/rtl-audit/verified-not-applicable.json', 'RTL registry must be measured or verified-N/A', 'rtl');

  const sheet = parseCheatSheet(ctx.index.get(CHEAT_SHEET_ID));
  if (!sheet) warnings.push(`cheat sheet not loaded: ${CHEAT_SHEET_ID}`);
  const cheatSheetRows = sheet ? matchCheatSheet(sheet, kws, report.ownerHooks.map((h) => h.hook)) : { rows: [], sections: [] };

  let estimate: EstimateResult['estimate'] = { sizeClass: 'insufficient data' };
  try {
    const { prs } = prsTouching({ run: ctx.gh, upstream: ctx.upstream, cacheDir: ctx.cacheDir }, loc.dir);
    const basis = prStats(prs);
    if (basis && basis.prs >= 3) estimate = { sizeClass: sizeClassOf(basis.medianFiles, basis.medianLines), basis };
    else if (basis) estimate = { sizeClass: 'insufficient data', basis };
    if (!basis || basis.prs < 3) warnings.push(`fewer than 3 merged PRs touched ${loc.dir}; no size estimate`);
  } catch (err) {
    warnings.push(`PR history unavailable: ${ghErrorMessage(err)}`);
  }

  return { dir: loc.dir, ...(loc.focus ? { focus: loc.focus } : {}), keywords: kws, ...(issue ? { issue } : {}), mustTouch, accounting, cheatSheetRows, estimate, warnings };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'estimate_change_scope',
    {
      description: 'Before starting an issue: which files a change to this component must touch (SYNC header targets), the accounting the reviewer checks (changeset, spec record, verified_by tests, doc.mjs, a11y states, stories), the Architecture-Cheat-Sheet rows the keywords and owner hooks trigger, and a size class (S/M/L) from merged PRs that touched the same directory.',
      inputSchema: estimateChangeScopeInput,
    },
    async (input) => {
      const r = estimateChangeScope(ctx, input);
      return 'error' in r ? fail(`${r.error}. Did you mean: ${r.suggestions.join(', ') || '(no similar names)'}`) : json(r);
    },
  );
}
