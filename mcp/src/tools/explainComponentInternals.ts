import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { CHEAT_SHEET_ID, parseCheatSheet } from '../cheatSheet.js';
import { analyzeComponent, locateComponent, suggestComponents, type ComponentReport } from '../component.js';
import { fail, json, type ToolContext } from '../context.js';
import { dirContains } from '../match.js';
import type { ComponentScore } from '../sources/wiki.js';

export const explainComponentInternalsInput = z.object({
  name: z.string().min(1).describe('Component or sub-component name, e.g. Selector or ChatComposer'),
});

export interface ComponentRecord {
  id: string; path: string; authority?: string; owners: string[]; reviewTriggers: string[]; verifiedBy: string[]; families: string[]; architecture: string[];
}

export interface ExplainResult extends Omit<ComponentReport, 'ownerHooks'> {
  ownerHooks: (ComponentReport['ownerHooks'][number] & { cheatSheetTrigger?: string })[];
  records: ComponentRecord[];
  scores: Record<string, ComponentScore>;
  lifecycle?: string;
}

export function explainComponentInternals(ctx: ToolContext, input: z.infer<typeof explainComponentInternalsInput>): ExplainResult | { error: string; suggestions: string[] } {
  const loc = locateComponent(ctx.repoRoot, input.name);
  if (!loc) return { error: `no component named ${input.name} under packages/{core,lab,charts,richtext}/src`, suggestions: suggestComponents(ctx.repoRoot, input.name) };
  const report = analyzeComponent(ctx.repoRoot, loc);
  const sheet = parseCheatSheet(ctx.index.get(CHEAT_SHEET_ID));
  const warnings = [...ctx.index.warnings, ...report.warnings];
  if (!sheet) warnings.push(`cheat sheet not loaded: ${CHEAT_SHEET_ID}`);

  const ownerHooks = report.ownerHooks.map((h) => {
    const row = sheet?.rows.find((r) => r.hooks.includes(h.hook));
    return row ? { ...h, cheatSheetTrigger: row.trigger } : h;
  });

  const records: ComponentRecord[] = [];
  const scores: Record<string, ComponentScore> = {};
  for (const doc of ctx.index.docs.values()) {
    const fm = doc.frontmatter;
    if (doc.source !== 'repo' || !fm || (fm.kind !== 'component' && fm.kind !== 'module') || !dirContains(loc.dir, doc.path)) continue;
    records.push({ id: doc.id, path: doc.path, authority: fm.authority, owners: fm.owners, reviewTriggers: fm.review_triggers, verifiedBy: fm.verified_by, families: fm.families, architecture: fm.architecture });
  }
  if (!records.length) warnings.push(`no spec record under ${loc.dir}${loc.package === 'lab' ? ' (usual for lab)' : ''}`);
  for (const u of report.units) {
    const s = ctx.index.scores.get(u.name);
    if (s) scores[u.name] = s;
  }

  return {
    ...report, ownerHooks, records, scores, warnings,
    ...(loc.package === 'lab' ? { lifecycle: 'lab component: see wiki:Component-Lifecycle for the promotion path to core' } : {}),
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'explain_component_internals',
    {
      description: 'How an astryx component is put together: every file with its role, SYNC-header targets per component, where StyleX styles live (inline vs *.stylex.ts) and which tokens they use, themeProps slots, owner hooks (with the cheat-sheet trigger they answer), a11y bindings and every aria/role line, i18n calls, stories, spec records and audit scores. Call before reading a component you have not touched before.',
      inputSchema: explainComponentInternalsInput,
    },
    async (input) => {
      const r = explainComponentInternals(ctx, input);
      return 'error' in r ? fail(`${r.error}. Did you mean: ${r.suggestions.join(', ') || '(no similar names)'}`) : json(r);
    },
  );
}
