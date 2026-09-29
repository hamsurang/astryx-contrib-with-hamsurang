import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { json, type ToolContext } from '../context.js';
import { normalizePath } from '../match.js';
import { fireRows, parseTriggerTable, RUBRIC_SECTION_ID, type RubricRow } from '../rubric.js';
import { DOC_DIRS } from '../sources/repo.js';

export const prChecklistInput = z.object({
  changedPaths: z.array(z.string()).min(1).describe('Output of `git diff --name-only main...HEAD`'),
});

export interface ChecklistResult {
  changesetRequired: boolean;
  specOwnerApproval: boolean;
  designReview: boolean;
  verifiedBy: string[];
  draftRecordsIncluded: string[];
  rubricChecks: RubricRow[];
  rubricParsed: boolean;
  rubricNote: string;
  rubricRaw?: string;
  commands: string[];
  sources: { rule: string; sectionId: string }[];
  warnings: string[];
}

const SPEC_FILE = /^packages\/.+\.spec\.md$/;

/** A knowledge record the index would have picked up, had it been built after this file appeared. */
function isRecordFile(path: string): boolean {
  if (path === 'docs/README.md') return true;
  if (DOC_DIRS.some((dir) => path.startsWith(`${dir}/`))) return true;
  return SPEC_FILE.test(path) && !path.endsWith('.generated.spec.md');
}

const RUBRIC_NOTE = 'firedBy is a filename heuristic. Rows with detectable: false must be judged by reading the diff.';

const SOURCE_SECTIONS: Record<string, string> = {
  changesetRequired: 'workflow:contributing#before-you-push',
  specOwnerApproval: 'workflow:review-gate#spec-records',
  designReview: 'workflow:review-gate#tl-dr',
  rubricChecks: RUBRIC_SECTION_ID,
};

export function prChecklist(ctx: ToolContext, input: z.infer<typeof prChecklistInput>): ChecklistResult {
  const idx = ctx.index;
  const paths = input.changedPaths.map((p) => normalizePath(p, ctx.repoRoot));
  const warnings = [...idx.warnings];

  const changedSet = new Set(paths);
  const touchedRecords = [...idx.docs.values()].filter((d) => d.source === 'repo' && changedSet.has(d.path));
  const touchedCurrent = touchedRecords.filter((d) => d.frontmatter?.authority === 'current');

  const { matches } = idx.recordsForPaths(paths, { includeDraft: true });
  const verifiedBy = [...new Set(matches.flatMap((m) => m.doc.frontmatter?.verified_by ?? []))].sort();
  const draftRecordsIncluded = matches.filter((m) => m.doc.frontmatter?.authority === 'draft').map((m) => m.doc.id).sort();

  const indexedPaths = new Set([...idx.docs.values()].map((d) => d.path));
  for (const p of paths) {
    if (indexedPaths.has(p) || !isRecordFile(p)) continue;
    warnings.push(`record file not in index — run refresh: ${p}`);
  }

  const rubricSection = idx.getSection(RUBRIC_SECTION_ID);
  const rows = rubricSection ? parseTriggerTable(rubricSection.body) : [];
  const rubricParsed = rows.length > 0;
  if (!rubricSection) warnings.push(`rubric section not loaded: ${RUBRIC_SECTION_ID}`);

  const result: ChecklistResult = {
    changesetRequired: paths.some((p) => p.startsWith('packages/')),
    specOwnerApproval: touchedCurrent.length > 0,
    designReview: paths.some((p) => p.startsWith('docs/design/')) || touchedCurrent.some((d) => d.frontmatter?.kind === 'design'),
    verifiedBy,
    draftRecordsIncluded,
    rubricChecks: fireRows(rows, paths),
    rubricParsed,
    rubricNote: RUBRIC_NOTE,
    rubricRaw: rubricSection && !rubricParsed ? rubricSection.body : undefined,
    commands: ['pnpm lint:strict', 'pnpm test', 'pnpm build'],
    sources: [],
    warnings,
  };

  for (const [rule, sectionId] of Object.entries(SOURCE_SECTIONS)) {
    if (idx.getSection(sectionId)) result.sources.push({ rule, sectionId });
    else warnings.push(`source section not loaded: ${sectionId}`);
  }
  return result;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'pr_checklist',
    { description: 'Before opening a PR: whether a changeset, spec-owner approval, or design review is needed; which verified_by tests to run; which audit rubric rows your diff fires (a filename heuristic — rows with detectable: false still need a read of the diff). Call with the changed file list.', inputSchema: prChecklistInput },
    async (input) => json(prChecklist(ctx, input)),
  );
}
