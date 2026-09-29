import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, type ToolContext } from '../src/context.js';
import { estimateChangeScope, keywordsFromIssue, sizeClassOf, type EstimateResult } from '../src/tools/estimateChangeScope.js';
import { explainComponentInternals, type ExplainResult } from '../src/tools/explainComponentInternals.js';
import { replayGh } from './ghReplay.js';
import { cleanupWikiFixtures, gitWikiFixture } from './wikiFixture.js';

const REPO = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));

let ctx: ToolContext;
let gh: ReturnType<typeof replayGh>;
beforeAll(async () => {
  gh = replayGh();
  ctx = await createContext({ repoRoot: REPO, wikiDir: gitWikiFixture(), gh, upstream: 'facebook/astryx', cacheDir: mkdtempSync(join(tmpdir(), 'ctx-cache-')) });
});
afterAll(cleanupWikiFixtures);

describe('explain_component_internals', () => {
  test('joins the file analysis with cheat-sheet triggers, spec records and scores', () => {
    const r = explainComponentInternals(ctx, { name: 'ChatComposer' }) as ExplainResult;
    expect(r.focus).toBe('ChatComposer');
    expect(r.ownerHooks.map((h) => [h.hook, h.cheatSheetTrigger])).toEqual([
      ['useAnnounce', 'Announce a state transition'], ['useFocusTrap', 'Trap/restore focus'], ['useMergedRefs', undefined],
      ['useLayer', 'Open floating/modal UI'], ['useTranslator', 'Announce a state transition'],
    ]);
    expect(r.records).toEqual([{
      id: 'component:ChatComposer', path: 'packages/core/src/Chat/ChatComposer.spec.md', authority: 'current', owners: ['cixzhang'],
      reviewTriggers: ['public-api', 'accessibility'], verifiedBy: ['packages/core/src/Chat/ChatComposer.test.tsx'], families: ['family:buttons'], architecture: ['architecture:public-api'],
    }]);
    expect(r.scores).toEqual({});
    expect(r.lifecycle).toBeUndefined();
    expect(r.warnings).toEqual(['no SYNC header: packages/core/src/Chat/ChatMessage.tsx']);
  });
  test('lab component carries the lifecycle note and a no-record warning', () => {
    const r = explainComponentInternals(ctx, { name: 'Stat' }) as ExplainResult;
    expect(r.lifecycle).toMatch(/wiki:Component-Lifecycle/);
    expect(r.warnings).toContain('no spec record under packages/lab/src/Stat (usual for lab)');
  });
  test('unknown name returns suggestions', () => {
    expect(explainComponentInternals(ctx, { name: 'Composer' })).toEqual({ error: expect.stringContaining('no component named Composer'), suggestions: ['ChatComposer'] });
  });
});

describe('estimate_change_scope', () => {
  test('sizeClassOf boundaries', () => {
    expect(sizeClassOf(3, 80)).toBe('S');
    expect(sizeClassOf(4, 80)).toBe('M');
    expect(sizeClassOf(8, 300)).toBe('M');
    expect(sizeClassOf(8, 301)).toBe('L');
  });
  test('keywordsFromIssue takes title words, labels and PascalCase names', () => {
    expect(keywordsFromIssue({ title: 'ChatComposer loses its label', labels: ['bug'], body: 'The TextInput pattern applies.' }))
      .toEqual(['chatcomposer', 'loses', 'its', 'label', 'bug', 'ChatComposer', 'TextInput']);
  });
  test('issue-driven estimate: keywords, mustTouch, accounting, cheat-sheet rows, size from PR history', () => {
    const r = estimateChangeScope(ctx, { name: 'ChatComposer', issue: 123, keywords: ['Hover'] }) as EstimateResult;
    expect(r.issue).toEqual({ number: 123, title: 'ChatComposer textarea loses its accessible label when busy', labels: ['bug', 'accessibility'] });
    expect(r.keywords).toContain('hover');
    expect(r.keywords).toContain('accessibility');
    expect(r.mustTouch).toEqual([
      { path: 'packages/core/src/Chat/ChatComposer.doc.mjs', note: 'props table', from: 'packages/core/src/Chat/ChatComposer.tsx' },
      { path: 'packages/core/src/Chat/ChatComposer.test.tsx', from: 'packages/core/src/Chat/ChatComposer.tsx' },
      { path: 'apps/storybook/stories/ChatComposer.stories.tsx', from: 'packages/core/src/Chat/ChatComposer.tsx' },
    ]);
    expect(r.accounting.map((a) => `${a.rule}: ${a.file}`)).toEqual([
      'changeset: .changeset/<name>.md',
      'spec: packages/core/src/Chat/ChatComposer.spec.md',
      'verified_by: packages/core/src/Chat/ChatComposer.test.tsx',
      'family: docs/families/buttons.md',
      'a11y: packages/core/src/Chat/__tests__/ChatComposer.a11y.known-failures.ts',
      'a11y: packages/core/src/Chat/__tests__/ChatComposer.a11y.states.ts',
      'a11y: packages/core/src/Chat/__tests__/Listbox.a11y.states.ts',
      'story: apps/storybook/stories/Chat.stories.tsx',
      'story: apps/storybook/stories/ChatComposer.stories.tsx',
      'story: apps/storybook/stories/ChatComposerA11y.stories.tsx',
      'story: apps/storybook/stories/ChatMessage.stories.tsx',
    ]);
    expect(r.accounting.find((a) => a.rule === 'spec')!.reason).toMatch(/review_triggers accessibility/);
    expect(r.cheatSheetRows.rows.map((x) => x.item.trigger)).toEqual(['Announce a state transition', 'Trap/restore focus', 'Open floating/modal UI']);
    expect(r.cheatSheetRows.sections.map((x) => x.item.heading)).toEqual(['Layer protocol suite', 'Accessibility primitives']);
    expect(r.estimate).toEqual({ sizeClass: 'insufficient data', basis: { prs: 2, medianFiles: 5.5, medianLines: 245, medianReviewRounds: 0.5 } });
    expect(r.warnings).toContain('fewer than 3 merged PRs touched packages/core/src/Chat; no size estimate');
  });
  test('prop keywords add the doc.mjs; a missing issue is a warning, not a failure', () => {
    const r = estimateChangeScope(ctx, { name: 'ChatComposer', issue: 999, keywords: ['default prop'] }) as EstimateResult;
    expect(r.issue).toBeUndefined();
    expect(r.warnings).toContain('issue #999 not loaded: gh: Not Found (HTTP 404) [issue-999.json]');
    expect(r.accounting.some((a) => a.rule === 'doc' && a.file.endsWith('ChatComposer.doc.mjs'))).toBe(true);
    expect(r.accounting.some((a) => a.rule === 'a11y')).toBe(false);
  });
  test('PR history is served from the cache on the second call', () => {
    const before = gh.calls.filter((c) => c[1]?.includes('/commits?path=')).length;
    estimateChangeScope(ctx, { name: 'ChatMessage' });
    expect(gh.calls.filter((c) => c[1]?.includes('/commits?path=')).length).toBe(before);
  });
});
