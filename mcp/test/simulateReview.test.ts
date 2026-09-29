import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, type ToolContext } from '../src/context.js';
import { parseUnifiedDiff } from '../src/git.js';
import { fireRules, loadCorpus, loadRules, relatedReviews } from '../src/sources/reviews.js';
import { simulateReview, type SimulateResult } from '../src/tools/simulateReview.js';
import { replayGh } from './ghReplay.js';

const FIXTURE_REPO = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));
const DATA = fileURLToPath(new URL('./fixtures/reviewdata/', import.meta.url));

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });

/** Fixture repo as a git history: main, then a feature branch that edits ChatComposer, then main moves the same file. */
function gitRepoFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'astryx-sim-'));
  cpSync(FIXTURE_REPO, dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'checkout', '-q', '-b', 'feat');
  const impl = join(dir, 'packages/core/src/Chat/ChatComposer.tsx');
  appendFileSync(impl, "export const onClick = () => {};\n");
  git(dir, 'commit', '-q', '-am', 'feat(ChatComposer): expose onClick\n\nBuilders can now attach a click handler.');
  git(dir, 'checkout', '-q', 'main');
  appendFileSync(impl, '\n// main moved\n');
  git(dir, 'commit', '-q', '-am', 'chore: touch composer on main');
  git(dir, 'checkout', '-q', 'feat');
  return dir;
}

let repo: string;
let ctx: ToolContext;
beforeAll(async () => {
  process.env.ASTRYX_REVIEW_DATA = DATA;
  repo = gitRepoFixture();
  ctx = await createContext({ repoRoot: repo, gh: replayGh(), upstream: 'facebook/astryx', cacheDir: mkdtempSync(join(tmpdir(), 'c-')) });
});
afterAll(() => {
  delete process.env.ASTRYX_REVIEW_DATA;
  rmSync(repo, { recursive: true, force: true });
});

describe('rules and corpus', () => {
  test('loadRules / fireRules cover always, roles, keywords, paths and missing', () => {
    const rules = loadRules(DATA);
    expect(rules.map((r) => r.id)).toEqual(['always-rule', 'impl-rule', 'keyword-rule', 'path-rule', 'changeset-missing', 'test-missing']);
    const fired = fireRules(rules, { files: ['packages/core/src/Chat/ChatComposer.tsx', 'packages/cli/src/x.ts'], text: 'adds onclick handler', touchesPackages: true });
    expect(fired.map((f) => [f.id, f.firedBy])).toEqual([
      ['always-rule', ['always']],
      ['impl-rule', ['packages/core/src/Chat/ChatComposer.tsx', 'packages/cli/src/x.ts']],
      ['keyword-rule', ['"onclick"']],
      ['path-rule', ['packages/cli/src/x.ts']],
      ['changeset-missing', ['no changeset in diff']],
      ['test-missing', ['no test in diff']],
    ]);
    const withA11y = fireRules(rules, { files: ['packages/core/src/X/X.tsx', 'packages/core/src/X/__tests__/X.a11y.states.ts', '.changeset/x.md'], text: '', touchesPackages: true });
    expect(withA11y.map((f) => f.id)).toEqual(['always-rule', 'impl-rule']);
    expect(fireRules(rules, { files: ['README.md'], text: '', touchesPackages: false }).map((f) => f.id)).toEqual(['always-rule']);
  });
  test('relatedReviews ranks by directory overlap, skipping records without files', () => {
    const corpus = loadCorpus(DATA);
    expect(corpus).toHaveLength(4);
    const r = relatedReviews(corpus, ['packages/core/src/Chat/ChatComposer.tsx']);
    expect(r.map((x) => [x.pr, x.state, x.overlap])).toEqual([[6002, 'APPROVED', ['packages/core/src/Chat']], [6001, 'CHANGES_REQUESTED', ['packages/core/src/Chat']]]);
    expect(r[1].excerpt).toBe('Semantic verdict: request changes The composer drops its name when busy. [Reviewed by Robohands]');
    expect(loadCorpus('/nope')).toEqual([]);
  });
  test('parseUnifiedDiff counts and snippets', () => {
    const h = parseUnifiedDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n+more\n', 1);
    expect(h).toEqual([{ file: 'a.ts', added: 2, removed: 1, snippet: '-old\n… (2 more changed lines)', addedText: 'new\nmore' }]);
  });
});

describe('simulate_review', () => {
  test('local diff: hunks, fired axes, past reviews and accounting', () => {
    const r = simulateReview(ctx, { base: 'main' }) as SimulateResult;
    expect(r.mode).toBe('local');
    expect(r.base).toBe('main');
    expect(r.claim).toEqual({ source: 'last commit message', text: 'feat(ChatComposer): expose onClick\n\nBuilders can now attach a click handler.' });
    expect(r.files).toEqual([{ path: 'packages/core/src/Chat/ChatComposer.tsx', role: 'impl' }]);
    expect(r.hunks[0]).toMatchObject({ file: 'packages/core/src/Chat/ChatComposer.tsx', added: 1, removed: 0 });
    expect(r.hunks[0]).not.toHaveProperty('addedText');
    expect(r.axesFired.map((a) => a.id)).toEqual(['always-rule', 'impl-rule', 'keyword-rule', 'changeset-missing', 'test-missing']);
    expect(r.pastReviews.map((p) => p.pr)).toEqual([6002, 6001]);
    expect(r.accounting.changeset).toEqual({ present: false, needed: true, note: 'consumer-visible change under packages/* without a changeset' });
    expect(r.accounting.prettier).toEqual({ ran: false, unformatted: [], note: 'prettier not installed in the checkout (pnpm install)' });
    expect(r.accounting.testsForChangedFiles).toEqual([{ impl: 'packages/core/src/Chat/ChatComposer.tsx', test: 'packages/core/src/Chat/ChatComposer.test.tsx', changed: false }]);
    expect(r.accounting.syncTargetsUntouched.map((s) => s.target)).toEqual([
      'packages/core/src/Chat/ChatComposer.doc.mjs', 'packages/core/src/Chat/ChatComposer.test.tsx', 'apps/storybook/stories/ChatComposer.stories.tsx',
    ]);
    expect(r.accounting.specDrift).toEqual([{ impl: 'packages/core/src/Chat/ChatComposer.tsx', spec: 'packages/core/src/Chat/ChatComposer.spec.md' }]);
    expect(r.accounting.mainMoved).toEqual(['packages/core/src/Chat/ChatComposer.tsx']);
    expect(r.warnings).toContain('no PR_DRAFT.md; write the claim first (one sentence: who is affected, what they can now do)');
    expect(r.instruction).toMatch(/ship \/ fix first \/ ask/);
  });
  test('PR_DRAFT.md becomes the claim; a changeset satisfies the missing rule', () => {
    writeFileSync(join(repo, 'PR_DRAFT.md'), '# Title\n\nA keyboard user can now click.');
    mkdirSync(join(repo, '.changeset'));
    writeFileSync(join(repo, '.changeset', 'x.md'), "---\n'@astryxdesign/core': patch\n---\n");
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'chore: draft');
    const r = simulateReview(ctx, { base: 'main' }) as SimulateResult;
    expect(r.claim).toEqual({ source: 'PR_DRAFT.md', text: '# Title\n\nA keyboard user can now click.' });
    expect(r.axesFired.map((a) => a.id)).not.toContain('changeset-missing');
    expect(r.accounting.changeset).toEqual({ present: true, needed: true });
    expect(r.warnings).not.toContain(expect.stringContaining('no PR_DRAFT.md'));
  });
  test('missing base ref is an error', () => {
    expect(simulateReview(ctx, { base: 'nope/main' })).toEqual({ error: expect.stringContaining('no base ref found (tried nope/main)') });
  });
  test('pr mode uses the PR body and diff and skips local-only accounting', () => {
    const r = simulateReview(ctx, { pr: 6395 }) as SimulateResult;
    expect(r).toMatchObject({ mode: 'pr', head: 'bbb', claim: { source: 'PR #6395 body' } });
    expect(r.files.map((f) => `${f.role}:${f.path}`)).toEqual([
      'changeset:.changeset/selector-name.md', 'impl:packages/core/src/Selector/Selector.tsx', 'a11y:packages/core/src/Selector/__tests__/Selector.a11y.chromium.spec.ts',
    ]);
    expect(r.axesFired.map((a) => a.id)).toEqual(['always-rule', 'impl-rule']);
    expect(r.accounting.prettier.note).toBe('not run for a remote PR');
    expect(r.warnings).toContain('pr mode: prettier, SYNC, spec-drift and main-moved checks need a local checkout of the branch');
  });
});
