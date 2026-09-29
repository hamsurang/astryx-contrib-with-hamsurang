import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { KnowledgeIndex, snippet, summaryOf } from '../src/index.js';
import { wikiPagesForPath } from '../src/pathMap.js';
import { cleanupWikiFixtures, FIXTURE_WIKI, gitWikiFixture } from './wikiFixture.js';

const REPO = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));

let idx: KnowledgeIndex;
beforeAll(async () => {
  idx = await KnowledgeIndex.build({ repoRoot: REPO, wikiDir: gitWikiFixture() });
});
afterAll(cleanupWikiFixtures);

describe('build', () => {
  test('holds repo, workflow and wiki docs and sections', () => {
    expect(idx.get('component:Button')?.source).toBe('repo');
    expect(idx.get('wiki:Contributing')?.source).toBe('wiki');
    expect(idx.getSection('workflow:review-gate#spec-records')?.body).toContain('spec-owner-approval');
    expect(idx.scores.get('Button')?.grade).toBe('A');
    expect(idx.warnings).toEqual([]);
  });
  test('without wiki dir it warns', async () => {
    const i = await KnowledgeIndex.build({ repoRoot: REPO });
    expect(i.warnings[0]).toMatch(/wiki unavailable/);
    expect(i.get('wiki:Contributing')).toBeUndefined();
  });
  test('a wiki dir that is not a clone warns once and loads no wiki docs', async () => {
    const i = await KnowledgeIndex.build({ repoRoot: REPO, wikiDir: FIXTURE_WIKI });
    expect(i.warnings).toEqual([`wiki unavailable: wiki dir exists but is not a git clone; rm -rf ${FIXTURE_WIKI} and restart`]);
    expect([...i.docs.values()].some((d) => d.source === 'wiki')).toBe(false);
  });
});

describe('search', () => {
  test('finds section by body text with snippet', () => {
    const hits = idx.search('hardcode colors');
    expect(hits[0].docId).toBe('wiki:Component-Authoring-Guide');
    expect(hits[0].sectionId).toBe('wiki:Component-Authoring-Guide#props');
    expect(hits[0].snippet).toContain('hardcode');
  });
  test('source filter and limit', () => {
    const hits = idx.search('component', { source: 'repo', limit: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits.every((h) => idx.get(h.docId)?.source === 'repo')).toBe(true);
  });
});

describe('recordsForPaths', () => {
  test('applies_to prefix + glob, excludes draft by default', () => {
    const { matches: m } = idx.recordsForPaths(['packages/core/src/theme/x.ts']);
    const ids = m.map((x) => x.doc.id).sort();
    expect(ids).toEqual(['architecture:public-api', 'architecture:theme-surface']);
    expect(m.every((x) => x.via === 'applies_to')).toBe(true);
  });
  test('includeDraft adds draft records, which are otherwise reported as suppressed', () => {
    const withDraft = idx.recordsForPaths(['packages/core/src/x.ts'], { includeDraft: true });
    expect(withDraft.matches.map((x) => x.doc.id)).toContain('architecture:draft-idea');
    expect(withDraft.suppressedDrafts).toEqual([]);
    const without = idx.recordsForPaths(['packages/core/src/x.ts']);
    expect(without.matches.map((x) => x.doc.id)).not.toContain('architecture:draft-idea');
    expect(without.suppressedDrafts).toEqual(['architecture:draft-idea']);
  });
  test('a draft component spec is suppressed by its own directory match', () => {
    const r = idx.recordsForPaths(['packages/core/src/Typeahead/Typeahead.tsx']);
    expect(r.suppressedDrafts).toContain('component:Typeahead');
    expect(r.matches.map((x) => x.doc.id)).not.toContain('component:Typeahead');
  });
  test('component spec matches by its own directory, family by members, design by families', () => {
    const { matches: m } = idx.recordsForPaths(['packages/core/src/Button/Button.tsx']);
    const by = Object.fromEntries(m.map((x) => [x.doc.id, x.via]));
    expect(by['component:Button']).toBe('spec-dir');
    expect(by['family:buttons']).toBe('members');
    expect(by['design:color']).toBe('families');
    expect(by['architecture:public-api']).toBe('applies_to');
    expect(m.find((x) => x.doc.id === 'component:Button')?.matchedBy).toEqual(['packages/core/src/Button/Button.tsx']);
  });
  test('module spec matches deeper directory only', () => {
    const ids = idx.recordsForPaths(['packages/core/src/Table/plugins/rowStatus/useTableRowStatus.ts']).matches.map((x) => x.doc.id);
    expect(ids).toContain('module:Table/useTableRowStatus');
    expect(idx.recordsForPaths(['packages/core/src/Table/Table.tsx']).matches.map((x) => x.doc.id)).not.toContain('module:Table/useTableRowStatus');
  });
});

describe('suggest', () => {
  test('ranks by how many query tokens an id contains', () => {
    expect(idx.suggest('component:button')[0]).toBe('component:Button');
    expect(idx.suggest('wiki:api-conventions')[0]).toBe('wiki:API-Conventions');
  });
});

describe('helpers', () => {
  test('snippet centers on first matching term', () => {
    const s = snippet('a'.repeat(300) + ' needle here ' + 'b'.repeat(300), 'needle', 40);
    expect(s).toContain('needle');
    expect(s.length).toBeLessThan(60);
  });
  test('summaryOf takes first non-empty paragraph', () => {
    expect(summaryOf(idx.get('component:Button')!)).toBe('Button triggers an action.');
  });
  test('wikiPagesForPath', () => {
    expect(wikiPagesForPath('packages/core/src/Button/Button.tsx')).toContain('wiki:API-Conventions');
    expect(wikiPagesForPath('README.md')).toEqual([]);
  });
});
