import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, type ToolContext } from '../src/context.js';
import { maintainersFromRecords, standingOf } from '../src/people.js';
import { loadMembers } from '../src/sources/members.js';
import { assessIssueFit, mentionsIssue, reproSignals, type AssessResult } from '../src/tools/assessIssueFit.js';
import { diffRole, findReferencePr, parseDiff, targetDir, type DetailResult, type FindResult } from '../src/tools/findReferencePr.js';
import { parseGithubUrl, translateKr, type TranslateResult } from '../src/tools/translateKr.js';
import { replayGh } from './ghReplay.js';
import { cleanupWikiFixtures, gitWikiFixture } from './wikiFixture.js';

const REPO = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));
const MEMBERS = fileURLToPath(new URL('./fixtures/members.yml', import.meta.url));
const NOW = Date.parse('2026-09-29T00:00:00Z');

let ctx: ToolContext;
let gh: ReturnType<typeof replayGh>;
beforeAll(async () => {
  gh = replayGh();
  process.env.ASTRYX_MEMBERS = MEMBERS;
  ctx = await createContext({ repoRoot: REPO, wikiDir: gitWikiFixture(), gh, upstream: 'facebook/astryx', cacheDir: mkdtempSync(join(tmpdir(), 'ctx-cache-')), now: () => NOW });
});
afterAll(() => {
  delete process.env.ASTRYX_MEMBERS;
  cleanupWikiFixtures();
});

describe('people', () => {
  test('maintainers come from spec owners/approved_by; standing ladder', () => {
    const m = maintainersFromRecords(ctx.index);
    expect(m.has('cixzhang')).toBe(true);
    expect(maintainersFromRecords({ docs: new Map() } as never).has('cixzhang')).toBe(true);
    expect(standingOf('cixzhang', 'CONTRIBUTOR', m)).toEqual({ standing: 'maintainer', reason: 'named as owner/approved_by on a spec record' });
    expect(standingOf('astracat-bot', 'NONE', m).standing).toBe('bot');
    expect(standingOf('x', 'MEMBER', m).standing).toBe('maintainer');
    expect(standingOf('x', 'COLLABORATOR', m).standing).toBe('member');
    expect(standingOf('x', 'CONTRIBUTOR', m, 60).standing).toBe('maintainer');
    expect(standingOf('x', 'NONE', m, 2)).toEqual({ standing: 'contributor', reason: '2 merged PRs' });
    expect(standingOf('x', 'NONE', m, 0)).toEqual({ standing: 'community', reason: 'author_association NONE' });
  });
  test('loadMembers reads logins and reports a missing file', () => {
    expect(loadMembers(MEMBERS)).toEqual({ members: [{ login: 'kyu', name: '홍규진' }, { login: 'teammate' }] });
    expect(loadMembers('/nope/members.yml').warning).toMatch(/not found/);
  });
});

describe('find_reference_pr', () => {
  test('diffRole and targetDir', () => {
    expect(['.changeset/a.md', 'packages/core/src/X/X.spec.md', 'packages/core/src/X/X.doc.mjs', 'apps/storybook/stories/X.stories.tsx',
      'packages/core/src/X/__tests__/X.a11y.states.ts', 'packages/core/src/X/X.test.tsx', 'packages/core/src/X/x.stylex.ts', 'docs/families/a.md',
      'packages/core/src/X/X.tsx', 'package.json'].map(diffRole))
      .toEqual(['changeset', 'spec', 'doc', 'story', 'a11y', 'test', 'stylex', 'docs', 'impl', 'other']);
    expect(targetDir('packages/core/src/Chat/ChatComposer.tsx')).toBe('packages/core/src/Chat');
    expect(targetDir('apps/storybook/stories/X.stories.tsx')).toBe('apps/storybook/stories');
  });
  test('ranks PRs touching the component directory with reasons', () => {
    const r = findReferencePr(ctx, { component: 'ChatComposer' }) as FindResult;
    expect(r.candidates.map((c) => c.number)).toEqual([6001, 6002]);
    expect(r.candidates[0]).toMatchObject({
      number: 6001, files: 2, lines: 40, reviewRounds: 1, authorAssociation: 'CONTRIBUTOR', touched: ['packages/core/src/Chat/ChatComposer.tsx'],
      reasons: ['1/2 files in the target directory', 'small diff (40 lines, median 245)', 'accounting: changeset', 'merged in the last 90 days', 'external contributor, same standing as us'],
    });
    expect(r.candidates[1].reasons).toEqual(['no changes-requested round', '1/1 files in the target directory', 'merged in the last 90 days']);
    expect(r.candidates[0].score).toBeGreaterThan(r.candidates[1].score);
  });
  test('query search merges into the candidate set; missing inputs error', () => {
    const r = findReferencePr(ctx, { query: 'listbox name', paths: [`${REPO}packages/core/src/Chat/ChatMessage.tsx`] }) as FindResult;
    expect(r.candidates.map((c) => c.number).sort()).toEqual([6001, 6002]);
    expect(gh.calls.some((c) => c[0] === 'search' && c[1] === 'prs' && c.includes('listbox name'))).toBe(true);
    expect(findReferencePr(ctx, {})).toEqual({ error: 'give at least one of paths, component or query' });
    expect((findReferencePr(ctx, { component: 'Nope', query: 'x' }) as FindResult).warnings).toContain('component Nope not found; ignoring');
  });
  test('detail groups the diff by role', () => {
    const r = findReferencePr(ctx, { detail: 6395 }) as DetailResult;
    expect(Object.keys(r.byRole)).toEqual(['changeset', 'impl', 'a11y']);
    expect(r.byRole.impl[0]).toMatchObject({ path: 'packages/core/src/Selector/Selector.tsx', additions: 2, deletions: 1 });
    expect(r.byRole.impl[0].patch).toContain('+new');
    expect(r.truncated).toBe(false);
    const big = parseDiff(`diff --git a/x.ts b/x.ts\n${'+line\n'.repeat(500)}`);
    expect(big.truncated).toBe(true);
    expect(big.files[0].patch).toMatch(/… \(\d+ more lines\)$/);
  });
});

describe('assess_issue_fit', () => {
  test('reproSignals and mentionsIssue', () => {
    expect(reproSignals('```tsx\nx\n```\nsee https://x.example/iframe.html?id=a and https://codesandbox.io/s/abc\n## Steps to reproduce'))
      .toEqual({ codeBlocks: 1, storybookLinks: ['https://x.example/iframe.html?id=a'], sandboxLinks: ['https://codesandbox.io/s/abc'], stepsHeading: true });
    expect(mentionsIssue('Fixes facebook/astryx#456', 'facebook/astryx', 456)).toBe(true);
    expect(mentionsIssue('see #4567', 'facebook/astryx', 456)).toBe(false);
    expect(mentionsIssue('https://github.com/facebook/astryx/issues/456', 'facebook/astryx', 456)).toBe(true);
  });
  test('community-filed issue with maintainer direction, open linked PR and a teammate fork PR', () => {
    const r = assessIssueFit(ctx, { issue: 456 }) as AssessResult;
    expect(r.issue).toMatchObject({ number: 456, labels: ['bug'], ageDays: 28, quietDays: 19 });
    expect(r.author).toEqual({ login: 'reporter', standing: 'community', reason: 'author_association NONE' });
    expect(r.maintainerComments).toHaveLength(1);
    expect(r.lastMaintainerComment).toMatchObject({ author: 'cixzhang', givesDirection: true, url: 'https://github.com/facebook/astryx/issues/456#issuecomment-2' });
    expect(r.repro).toEqual({ codeBlocks: 1, storybookLinks: ['https://astryx-storybook.example/iframe.html?id=selector--sheet'], sandboxLinks: [], stepsHeading: true });
    expect(r.linkedPrs.map((p) => `${p.number}:${p.state}`)).toEqual(['6395:open', '6000:merged']);
    expect(r.teamInProgress).toEqual([
      { login: 'kyu', fork: 'kyu/astryx', pr: 'https://github.com/kyu/astryx/pull/3' },
      { login: 'kyu', pr: 'https://github.com/facebook/astryx/pull/6395' },
    ]);
    expect(r.siblings.map((s) => s.number)).toEqual([300]);
    const fired = Object.fromEntries(r.signals.map((s) => [s.id, s.fired]));
    expect(fired).toEqual({ taken: true, 'team-in-progress': true, 'needs-record-not-code': false, 'maintainer-gave-direction': true, 'maintainer-filed-bug': false, 'unverified-community-report': false, 'closed-sibling': true, stale: false });
    expect(r.signals.find((s) => s.id === 'closed-sibling')!.evidence).toEqual(['https://github.com/facebook/astryx/issues/300 (MultiSelector listbox name)']);
    expect(r.instruction).toMatch(/TAKE \/ SKIP \/ ASK/);
    expect(r.warnings).toEqual([]);
  });
  test('maintainer-filed bug on hold, assigned, stale', () => {
    const r = assessIssueFit(ctx, { issue: 789 }) as AssessResult;
    expect(r.author.standing).toBe('maintainer');
    const fired = Object.fromEntries(r.signals.map((s) => [s.id, s.fired]));
    expect(fired).toMatchObject({ taken: true, 'needs-record-not-code': true, 'maintainer-filed-bug': true, stale: true, 'unverified-community-report': false });
    expect(r.signals.find((s) => s.id === 'needs-record-not-code')!.evidence).toEqual(['label needs-scoping']);
    expect(r.signals.find((s) => s.id === 'stale')!.evidence).toEqual(['no activity for 76 days']);
  });
  test('unknown issue is an error', () => {
    expect(assessIssueFit(ctx, { issue: 1 })).toEqual({ error: 'issue #1: gh: Not Found (HTTP 404) [issue-1.json]' });
  });
});

describe('translate_kr', () => {
  test('parseGithubUrl handles anchors', () => {
    expect(parseGithubUrl('https://github.com/facebook/astryx/pull/6395#pullrequestreview-501')).toEqual({ owner: 'facebook', repo: 'astryx', kind: 'pull', number: 6395, anchor: { type: 'pullrequestreview', id: 501 } });
    expect(parseGithubUrl('https://github.com/facebook/astryx/issues/456#issuecomment-2')).toEqual({ owner: 'facebook', repo: 'astryx', kind: 'issues', number: 456, anchor: { type: 'issuecomment', id: 2 } });
    expect(parseGithubUrl('https://github.com/facebook/astryx/pull/6395/files#discussion_r901')!.anchor).toEqual({ type: 'discussion_r', id: 901 });
    expect(parseGithubUrl('https://example.com')).toBeUndefined();
  });
  test('PR review anchor: target, thread, standing, labels, staleness', () => {
    const r = translateKr(ctx, { url: 'https://github.com/facebook/astryx/pull/6395#pullrequestreview-501' }) as TranslateResult;
    expect(r.target).toEqual({ kind: 'review', author: 'cixzhang', standing: 'maintainer', state: 'CHANGES_REQUESTED', timestamp: '2026-09-21T00:00:00Z', url: 'https://github.com/facebook/astryx/pull/6395#pullrequestreview-501', body: 'Could we derive the name from the label?' });
    expect(r.context!.author).toEqual({ login: 'kyu', standing: 'contributor', reason: '12 merged PRs', company: null, bio: null, mergedPrs: 12 });
    expect(r.context!.thread.map((t) => `${t.kind}:${t.author}:${t.standing}`)).toEqual(['comment:vercel:bot', 'review:cixzhang:maintainer', 'inline:cixzhang:maintainer', 'review:astracat-bot:bot']);
    expect(r.context!.unusedLabels).toEqual(['bug', 'documentation', 'needs-scoping']);
    expect(r.context!.staleness).toEqual({ lastCommit: '2026-09-22T00:00:00Z', reviewsBeforeLastCommit: ['cixzhang CHANGES_REQUESTED 2026-09-21T00:00:00Z'] });
    expect(r.warnings).toEqual(['target review is 1 day(s) older than the last push; it may be stale']);
    expect(r.instruction).toMatch(/line by line/);
  });
  test('inline anchor and issue comment anchor', () => {
    const inline = translateKr(ctx, { url: 'https://github.com/facebook/astryx/pull/6395/files#discussion_r901' }) as TranslateResult;
    expect(inline.target).toMatchObject({ kind: 'inline', path: 'packages/core/src/Selector/Selector.tsx', line: 1290 });
    const issue = translateKr(ctx, { url: 'https://github.com/facebook/astryx/issues/456#issuecomment-2' }) as TranslateResult;
    expect(issue.target).toMatchObject({ kind: 'comment', author: 'cixzhang', standing: 'maintainer' });
    expect(issue.context!.author).toMatchObject({ login: 'reporter', standing: 'community', company: 'Acme', mergedPrs: 0 });
    expect(issue.context!.siblings.map((s) => s.number)).toEqual([300]);
    const body = translateKr(ctx, { url: 'https://github.com/facebook/astryx/issues/456#issuecomment-77' }) as TranslateResult;
    expect(body.target.kind).toBe('issue-body');
    expect(body.warnings).toContain('comment 77 not found; translating the body');
  });
  test('text mode and errors', () => {
    expect(translateKr(ctx, { text: 'Hello' })).toEqual({ target: { kind: 'text', body: 'Hello' }, instruction: expect.any(String), warnings: [] });
    expect(translateKr(ctx, {})).toEqual({ error: 'give url or text' });
    expect(translateKr(ctx, { url: 'https://example.com/x' })).toEqual({ error: 'not a GitHub issue/PR URL: https://example.com/x' });
  });
});
