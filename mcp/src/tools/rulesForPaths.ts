import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { json, type ToolContext } from '../context.js';
import { summaryOf, type MatchVia } from '../index.js';
import { normalizePath } from '../match.js';
import { ALWAYS_WIKI, wikiPagesForPath } from '../pathMap.js';
import type { ComponentScore, ScoresMeta } from '../sources/wiki.js';

export const rulesForPathsInput = z.object({
  paths: z.array(z.string()).min(1).describe('Files you are about to change, repo-relative or absolute'),
  includeDraft: z.boolean().optional().describe('Also return authority: draft records'),
});

export interface RulesResult {
  records: { id: string; kind?: string; authority?: string; title: string; path: string; via: MatchVia; matchedBy: string[]; summary: string }[];
  componentSpecs: {
    id: string; component: string; path: string; reviewTriggers: string[]; families: string[];
    architecture: string[]; designSpecs: string[]; verifiedBy: string[]; score?: ComponentScore;
  }[];
  linked: { id: string; kind?: string; title: string }[];
  wiki: { id: string; title: string }[];
  always: { id: string; title: string }[];
  scoreLedger?: ScoresMeta & { note: string };
  warnings: string[];
}

export function rulesForPaths(ctx: ToolContext, input: z.infer<typeof rulesForPathsInput>): RulesResult {
  const idx = ctx.index;
  const paths = input.paths.map((p) => normalizePath(p, ctx.repoRoot));
  const warnings = [...idx.warnings];
  const { matches, suppressedDrafts, draftMatched } = idx.recordsForPaths(paths, { includeDraft: input.includeDraft });
  for (const id of suppressedDrafts) warnings.push(`draft records suppressed: ${id} (pass includeDraft: true)`);

  const result: RulesResult = { records: [], componentSpecs: [], linked: [], wiki: [], always: [], warnings };
  const linkIds = new Set<string>();

  for (const { doc, matchedBy, via } of matches) {
    const fm = doc.frontmatter!;
    if (fm.kind === 'component' || fm.kind === 'module') {
      const component = fm.parent_component
        ? fm.parent_component.replace(/^component:/, '')
        : doc.id.replace(/^(component|module):/, '').split('/').pop()!;
      result.componentSpecs.push({
        id: doc.id, component, path: doc.path, reviewTriggers: fm.review_triggers, families: fm.families,
        architecture: fm.architecture, designSpecs: fm.design_specs, verifiedBy: fm.verified_by,
        score: idx.scores.get(component),
      });
      for (const l of [...fm.families, ...fm.architecture, ...fm.design_specs]) linkIds.add(l);
    } else {
      result.records.push({ id: doc.id, kind: fm.kind, authority: fm.authority, title: doc.title, path: doc.path, via, matchedBy, summary: summaryOf(doc) });
    }
  }

  const present = new Set([...result.records.map((r) => r.id), ...result.componentSpecs.map((c) => c.id)]);
  for (const id of linkIds) {
    if (present.has(id)) continue;
    const doc = idx.get(id);
    if (doc) result.linked.push({ id, kind: doc.frontmatter?.kind, title: doc.title });
    else warnings.push(`linked record not found: ${id}`);
  }

  const wikiIds = new Set(paths.flatMap(wikiPagesForPath));
  for (const id of wikiIds) {
    const doc = idx.get(id);
    if (doc) result.wiki.push({ id, title: doc.title });
    else warnings.push(`wiki page not loaded: ${id}`);
  }
  for (const id of ALWAYS_WIKI) {
    const doc = idx.get(id);
    if (doc) result.always.push({ id, title: doc.title });
  }

  if (result.componentSpecs.some((c) => c.score)) {
    result.scoreLedger = { ...idx.scoresMeta, note: 'static-evidence audit; see wiki:Component-Audit-Rubric' };
  }

  const covered = new Set([...matches.flatMap((m) => m.matchedBy), ...draftMatched]);
  for (const p of paths) if (!covered.has(p)) warnings.push(`no record matches ${p}`);

  return result;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'rules_for_paths',
    {
      description: 'Which astryx rules apply to the files you are about to change: current knowledge records (architecture, family, design), component spec contracts, linked records, and wiki pages. Call before editing under packages/ or docs/.',
      inputSchema: rulesForPathsInput,
    },
    async (input) => json(rulesForPaths(ctx, input)),
  );
}
