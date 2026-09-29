import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { dirname } from 'node:path';
import { locateComponent } from '../component.js';
import { fail, json, type ToolContext } from '../context.js';
import { normalizePath } from '../match.js';
import { cached, DAY_MS, ghErrorMessage } from '../sources/gh.js';
import { fetchPrDiff, searchMergedPrNumbers, type Gh } from '../sources/github.js';
import { fetchPrs, median, prsTouching, reviewRounds, type PrSummary } from '../sources/prs.js';
import { maintainersFromRecords, daysBetween } from '../people.js';

export const findReferencePrInput = z.object({
  paths: z.array(z.string()).optional().describe('Files you will change; PRs that touched the same component directories rank first'),
  component: z.string().optional().describe('Component name, resolved to its directory'),
  query: z.string().optional().describe('Free-text search over merged PR titles/bodies'),
  limit: z.number().int().min(1).max(20).optional().describe('Candidates to return (default 5)'),
  detail: z.number().int().positive().optional().describe('PR number: return its diff grouped by file role instead of the ranking'),
});

export type DiffRole = 'impl' | 'stylex' | 'test' | 'a11y' | 'spec' | 'doc' | 'story' | 'changeset' | 'docs' | 'other';

export interface Candidate {
  number: number; title: string; url: string; mergedAt: string; author: string; authorAssociation: string;
  files: number; lines: number; reviewRounds: number; score: number; reasons: string[]; touched: string[];
}

export interface DetailFile { path: string; role: DiffRole; additions: number; deletions: number; patch: string }

export interface FindResult { candidates: Candidate[]; warnings: string[] }
export interface DetailResult { number: number; byRole: Record<string, DetailFile[]>; truncated: boolean; warnings: string[] }

export function diffRole(path: string): DiffRole {
  if (path.startsWith('.changeset/')) return 'changeset';
  if (/\.spec\.md$/.test(path)) return 'spec';
  if (/\.doc\.mjs$/.test(path)) return 'doc';
  if (/\.stories\.tsx?$/.test(path)) return 'story';
  if (/\.a11y\./.test(path) || /rtl-audit|a11y-baseline/.test(path)) return 'a11y';
  if (/__tests__\//.test(path) || /\.test(-[a-z]+)?\.(tsx?|mjs)$/.test(path) || /\.spec\.ts$/.test(path)) return 'test';
  if (/\.stylex\.ts$/.test(path)) return 'stylex';
  if (/^docs\//.test(path) || /\.md$/.test(path)) return 'docs';
  if (/^packages\/[^/]+\/src\/.+\.tsx?$/.test(path)) return 'impl';
  return 'other';
}

/** Directory a path is attributed to: the component dir under packages/<pkg>/src, else its parent. */
export function targetDir(path: string): string {
  const m = /^(packages\/[^/]+\/src\/[^/]+)\//.exec(path);
  return m ? m[1] : dirname(path);
}

function ageDays(iso: string, now: number): number {
  return daysBetween(iso, now);
}

export function rankCandidates(prs: PrSummary[], targetDirs: string[], maintainers: Set<string>, now: number): Candidate[] {
  const lines = prs.map((p) => p.additions + p.deletions);
  const medianLines = lines.length ? median(lines) : 0;
  return prs
    .map((pr) => {
      const reasons: string[] = [];
      let score = 0;
      const rounds = reviewRounds(pr);
      if (rounds === 0 && pr.reviews.some((r) => r.state === 'APPROVED')) { score += 3; reasons.push('approved without a changes-requested round'); }
      else if (rounds === 0) { score += 1; reasons.push('no changes-requested round'); }
      const touched = pr.files.filter((f) => targetDirs.some((d) => f.startsWith(`${d}/`)));
      if (targetDirs.length && touched.length) {
        const ratio = touched.length / pr.files.length;
        score += 2 * ratio;
        reasons.push(`${touched.length}/${pr.files.length} files in the target directory`);
      }
      const total = pr.additions + pr.deletions;
      if (lines.length > 1 && total <= medianLines) { score += 1; reasons.push(`small diff (${total} lines, median ${medianLines})`); }
      const roles = new Set(pr.files.map(diffRole));
      const accounting = ['changeset', 'spec', 'doc', 'test', 'story'].filter((r) => roles.has(r as DiffRole));
      if (accounting.length) { score += Math.min(2, accounting.length * 0.5); reasons.push(`accounting: ${accounting.join(', ')}`); }
      if (ageDays(pr.mergedAt, now) <= 90) { score += 1; reasons.push('merged in the last 90 days'); }
      if (!maintainers.has(pr.author) && !['OWNER', 'MEMBER'].includes(pr.authorAssociation)) { score += 1; reasons.push('external contributor, same standing as us'); }
      return {
        number: pr.number, title: pr.title, url: `https://github.com/facebook/astryx/pull/${pr.number}`, mergedAt: pr.mergedAt, author: pr.author,
        authorAssociation: pr.authorAssociation, files: pr.changedFiles, lines: total, reviewRounds: rounds, score: Math.round(score * 100) / 100, reasons, touched,
      };
    })
    .sort((a, b) => b.score - a.score || b.mergedAt.localeCompare(a.mergedAt));
}

export function parseDiff(diff: string): { files: DetailFile[]; truncated: boolean } {
  const files: DetailFile[] = [];
  let truncated = false;
  const chunks = diff.split(/^diff --git a\/(\S+) b\/\S+\n/m);
  for (let i = 1; i < chunks.length; i += 2) {
    const path = chunks[i];
    const body = chunks[i + 1] ?? '';
    const lines = body.split('\n');
    const additions = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    const deletions = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    let patch = body;
    if (lines.length > 400) { patch = `${lines.slice(0, 400).join('\n')}\n… (${lines.length - 400} more lines)`; truncated = true; }
    files.push({ path, role: diffRole(path), additions, deletions, patch });
  }
  return { files, truncated };
}

export function findReferencePr(ctx: ToolContext, input: z.infer<typeof findReferencePrInput>): FindResult | DetailResult | { error: string } {
  const gh: Gh = { run: ctx.gh, upstream: ctx.upstream, cacheDir: ctx.cacheDir, now: ctx.now };
  const warnings = [...ctx.index.warnings];

  if (input.detail) {
    try {
      const { files, truncated } = parseDiff(fetchPrDiff(gh, input.detail));
      const byRole: Record<string, DetailFile[]> = {};
      for (const f of files) (byRole[f.role] ??= []).push(f);
      return { number: input.detail, byRole, truncated, warnings };
    } catch (err) {
      return { error: `pr diff ${input.detail} failed: ${ghErrorMessage(err)}` };
    }
  }

  const dirs = new Set<string>();
  for (const p of input.paths ?? []) dirs.add(targetDir(normalizePath(p, ctx.repoRoot)));
  if (input.component) {
    const loc = locateComponent(ctx.repoRoot, input.component);
    if (loc) dirs.add(loc.dir);
    else warnings.push(`component ${input.component} not found; ignoring`);
  }
  if (!dirs.size && !input.query) return { error: 'give at least one of paths, component or query' };

  const seen = new Map<number, PrSummary>();
  try {
    for (const d of dirs) for (const pr of prsTouching({ run: ctx.gh, upstream: ctx.upstream, cacheDir: ctx.cacheDir, now: ctx.now }, d).prs) seen.set(pr.number, pr);
    if (input.query) {
      const { value } = cached({ dir: ctx.cacheDir, bucket: 'prs', key: `${ctx.upstream}:query:${input.query}`, ttlMs: DAY_MS, now: ctx.now }, () =>
        fetchPrs(ctx.gh, ctx.upstream, searchMergedPrNumbers(gh, input.query!)),
      );
      for (const pr of value) seen.set(pr.number, pr);
    }
  } catch (err) {
    return { error: `GitHub lookup failed: ${ghErrorMessage(err)}` };
  }
  if (!seen.size) warnings.push('no merged PRs matched');
  const candidates = rankCandidates([...seen.values()], [...dirs], maintainersFromRecords(ctx.index), ctx.now()).slice(0, input.limit ?? 5);
  return { candidates, warnings };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'find_reference_pr',
    {
      description: 'Merged astryx PRs worth copying for a change like yours, ranked by: approved without a changes-requested round, same component directory, small diff, complete accounting (changeset/spec/doc/test/story), recent, external author. Pass detail: <number> to get that PR\'s diff grouped by file role, which shows how astryx usually implements this kind of change.',
      inputSchema: findReferencePrInput,
    },
    async (input) => {
      const r = findReferencePr(ctx, input);
      return 'error' in r ? fail(r.error) : json(r);
    },
  );
}
