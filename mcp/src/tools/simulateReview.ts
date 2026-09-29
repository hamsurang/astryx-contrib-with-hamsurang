import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseSyncHeader } from '../component.js';
import { fail, json, type ToolContext } from '../context.js';
import { changedFiles, commitMessage, diffHunks, hasRef, headSha, movedOnBase, parseUnifiedDiff, prettierCheck, type Hunk } from '../git.js';
import { dirContains } from '../match.js';
import { ghErrorMessage } from '../sources/gh.js';
import { fetchPrDiff, fetchPrView, type Gh } from '../sources/github.js';
import { fireRules, loadCorpus, loadRules, relatedReviews, type FiredRule, type PastReview } from '../sources/reviews.js';
import { diffRole } from './findReferencePr.js';

export const simulateReviewInput = z.object({
  base: z.string().optional().describe('Base ref for a local diff (default upstream/main, then origin/main, then main)'),
  head: z.string().optional().describe('Head ref for a local diff (default HEAD)'),
  pr: z.number().int().positive().optional().describe('Review an upstream PR instead of the local checkout'),
});

export interface Accounting {
  changeset: { present: boolean; needed: boolean; note?: string };
  prettier: { ran: boolean; unformatted: string[]; note?: string };
  testsForChangedFiles: { impl: string; test?: string; changed: boolean }[];
  syncTargetsUntouched: { impl: string; target: string }[];
  specDrift: { impl: string; spec: string }[];
  mainMoved: string[];
}

export interface SimulateResult {
  mode: 'local' | 'pr';
  head: string;
  base?: string;
  claim: { source: string; text: string };
  files: { path: string; role: string }[];
  hunks: Omit<Hunk, 'addedText'>[];
  axesFired: FiredRule[];
  pastReviews: PastReview[];
  accounting: Accounting;
  instruction: string;
  warnings: string[];
}

export const INSTRUCTION = [
  'Frame the claim in the reviewer\'s words: who is affected, what they can do after this head that they could not before.',
  'For each fired axis, answer the check against the hunks; a clean axis produces nothing.',
  'Report verdict first: one line ship / fix first / ask. Then at most 3 blockers (what breaks, for whom, file:line), at most 2 things the reviewer will probably ask with prepared answers, and one line of what was not run.',
  'Keep axis names and passing checks out of the message; they belong in the PR body\'s Test Plan.',
].join('\n');

function resolveBase(ctx: ToolContext, requested?: string): string | undefined {
  const candidates = requested ? [requested] : ['upstream/main', 'origin/main', 'main'];
  return candidates.find((r) => hasRef(ctx.git, ctx.repoRoot, r));
}

function localAccounting(ctx: ToolContext, files: string[], base: string, head: string, warnings: string[]): Accounting {
  const roles = files.map(diffRole);
  const touchesPackages = files.some((f) => f.startsWith('packages/'));
  const consumerVisible = files.some((f) => f.startsWith('packages/') && !['test', 'a11y', 'story', 'docs', 'spec'].includes(diffRole(f)));
  const changeset = {
    present: roles.includes('changeset'), needed: consumerVisible,
    ...(roles.includes('changeset') && !consumerVisible ? { note: 'changeset present but only tests/stories/docs changed under packages/*; the reviewer drops it' } : {}),
    ...(!roles.includes('changeset') && consumerVisible ? { note: 'consumer-visible change under packages/* without a changeset' } : {}),
  };
  const existing = files.filter((f) => existsSync(join(ctx.repoRoot, f)));
  const pc = prettierCheck(ctx.repoRoot, existing.filter((f) => /\.(tsx?|mjs|cjs|js|md|json|css)$/.test(f)));
  const prettier = pc ? { ran: true, unformatted: pc.unformatted } : { ran: false, unformatted: [], note: 'prettier not installed in the checkout (pnpm install)' };

  const impls = files.filter((f) => diffRole(f) === 'impl' && !/index\.tsx?$/.test(f));
  const testsForChangedFiles = impls.map((impl) => {
    const dir = dirname(impl);
    const stem = basename(impl).replace(/\.tsx?$/, '');
    const candidates = [`${dir}/${stem}.test.tsx`, `${dir}/${stem}.test.ts`, `${dir}/__tests__/${stem}.test.tsx`];
    const test = candidates.find((c) => existsSync(join(ctx.repoRoot, c)));
    const changed = files.some((f) => f !== impl && (f.startsWith(`${dir}/`) && (diffRole(f) === 'test' || diffRole(f) === 'a11y')));
    return { impl, ...(test ? { test } : {}), changed };
  });

  const syncTargetsUntouched: Accounting['syncTargetsUntouched'] = [];
  const specDrift: Accounting['specDrift'] = [];
  for (const impl of impls) {
    const abs = join(ctx.repoRoot, impl);
    if (!existsSync(abs)) continue;
    for (const t of parseSyncHeader(readFileSync(abs, 'utf8')).targets) {
      const hit = files.some((f) => f === t.path || dirContains(t.path, f));
      if (!hit) syncTargetsUntouched.push({ impl, target: t.path });
    }
    for (const doc of ctx.index.docs.values()) {
      const fm = doc.frontmatter;
      if (fm?.kind === 'component' && fm.authority === 'current' && dirname(doc.path) === dirname(impl) && !files.includes(doc.path)) specDrift.push({ impl, spec: doc.path });
    }
  }
  let mainMoved: string[] = [];
  try { mainMoved = movedOnBase(ctx.git, ctx.repoRoot, base, head, files); } catch (err) { warnings.push(`main-moved check failed: ${(err as Error).message.split('\n')[0]}`); }
  if (!touchesPackages) warnings.push('no files under packages/*; changeset and spec checks are moot');
  return { changeset, prettier, testsForChangedFiles, syncTargetsUntouched, specDrift, mainMoved };
}

export function simulateReview(ctx: ToolContext, input: z.infer<typeof simulateReviewInput>): SimulateResult | { error: string } {
  const warnings = [...ctx.index.warnings];
  let rules;
  try { rules = loadRules(); } catch (err) { return { error: (err as Error).message }; }
  const corpus = loadCorpus();
  if (!corpus.length) warnings.push('review corpus empty; run scripts/collect-reviews.mjs');

  let files: string[];
  let hunks: Hunk[];
  let claim: SimulateResult['claim'];
  let head: string;
  let base: string | undefined;
  let accounting: Accounting;

  if (input.pr) {
    const gh: Gh = { run: ctx.gh, upstream: ctx.upstream, cacheDir: ctx.cacheDir, now: ctx.now };
    try {
      const pr = fetchPrView(gh, input.pr);
      hunks = parseUnifiedDiff(fetchPrDiff(gh, input.pr));
      files = hunks.map((h) => h.file);
      claim = { source: `PR #${input.pr} body`, text: pr.body };
      head = pr.lastCommit?.oid.slice(0, 7) ?? `PR #${input.pr}`;
    } catch (err) {
      return { error: `PR #${input.pr}: ${ghErrorMessage(err)}` };
    }
    const roles = files.map(diffRole);
    const consumerVisible = files.some((f) => f.startsWith('packages/') && !['test', 'a11y', 'story', 'docs', 'spec'].includes(diffRole(f)));
    accounting = {
      changeset: { present: roles.includes('changeset'), needed: consumerVisible },
      prettier: { ran: false, unformatted: [], note: 'not run for a remote PR' },
      testsForChangedFiles: [], syncTargetsUntouched: [], specDrift: [], mainMoved: [],
    };
    warnings.push('pr mode: prettier, SYNC, spec-drift and main-moved checks need a local checkout of the branch');
  } else {
    base = resolveBase(ctx, input.base);
    if (!base) return { error: `no base ref found (tried ${input.base ?? 'upstream/main, origin/main, main'}); run from an astryx checkout with the upstream remote` };
    const headRef = input.head ?? 'HEAD';
    try {
      files = changedFiles(ctx.git, ctx.repoRoot, base, headRef);
      hunks = diffHunks(ctx.git, ctx.repoRoot, base, headRef);
      head = headSha(ctx.git, ctx.repoRoot, headRef);
    } catch (err) {
      return { error: `git diff ${base}...${headRef} failed: ${(err as Error).message.split('\n')[0]}` };
    }
    const draft = join(ctx.repoRoot, 'PR_DRAFT.md');
    if (existsSync(draft)) claim = { source: 'PR_DRAFT.md', text: readFileSync(draft, 'utf8') };
    else {
      let msg = '';
      try { msg = commitMessage(ctx.git, ctx.repoRoot, base, headRef); } catch { /* no commits yet */ }
      claim = msg ? { source: 'last commit message', text: msg } : { source: 'none', text: '' };
      warnings.push('no PR_DRAFT.md; write the claim first (one sentence: who is affected, what they can now do)');
    }
    accounting = localAccounting(ctx, files, base, headRef, warnings);
  }
  if (!files.length) warnings.push('empty diff');

  const text = `${hunks.map((h) => h.addedText).join('\n')}\n${claim.text}`.toLowerCase();
  const axesFired = fireRules(rules, { files, text, touchesPackages: files.some((f) => f.startsWith('packages/')) });
  const pastReviews = relatedReviews(corpus, files);

  return {
    mode: input.pr ? 'pr' : 'local', head, ...(base ? { base } : {}), claim,
    files: files.map((path) => ({ path, role: diffRole(path) })),
    hunks: hunks.map(({ addedText: _a, ...h }) => h),
    axesFired, pastReviews, accounting, instruction: INSTRUCTION, warnings,
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'simulate_review',
    {
      description: 'Self-review a diff the way the astryx maintainer\'s review bot will: the hunks, the review axes the diff triggers (with the reviewer\'s own sentences and example PRs), past bot reviews on the same directories, and deterministic accounting (changeset, prettier, tests for changed files, SYNC targets untouched, spec drift, main moved). Local diff against upstream/main by default; pass pr: <number> for an upstream PR. Verdict is yours: ship / fix first / ask.',
      inputSchema: simulateReviewInput,
    },
    async (input) => {
      const r = simulateReview(ctx, input);
      return 'error' in r ? fail(r.error) : json(r);
    },
  );
}
