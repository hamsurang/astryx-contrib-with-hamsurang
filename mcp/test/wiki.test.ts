import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureWiki, loadScores, loadScoresMeta, loadWikiDocs, pullWiki } from '../src/sources/wiki.js';
import { FIXTURE_WIKI } from './wikiFixture.js';

describe('loadWikiDocs', () => {
  test('loads pages with wiki: ids and skips Night-Watch/_Sidebar', async () => {
    const docs = await loadWikiDocs(FIXTURE_WIKI);
    const ids = docs.map((d) => d.id);
    expect(ids).toContain('wiki:Contributing');
    expect(ids).toContain('wiki:Component-Audit-Rubric');
    expect(ids).not.toContain('wiki:Night-Watch-QA');
    expect(ids).not.toContain('wiki:_Sidebar');
    const rubric = docs.find((d) => d.id === 'wiki:Component-Audit-Rubric')!;
    expect(rubric.source).toBe('wiki');
    expect(rubric.title).toBe('Component Audit Rubric');
    expect(rubric.sections.map((s) => s.id)).toContain('wiki:Component-Audit-Rubric#reviewing-a-change');
  });
});

describe('loadScores', () => {
  test('maps component name to score entry', async () => {
    const scores = await loadScores(FIXTURE_WIKI);
    expect(scores.get('Button')).toEqual({ component: 'Button', package: 'core', status: 'audited', score: 91.2, grade: 'A' });
  });
  test('empty map when file missing', async () => {
    expect((await loadScores('/tmp')).size).toBe(0);
  });
  test('loadScoresMeta reads the ledger caveats', async () => {
    expect(await loadScoresMeta(FIXTURE_WIKI)).toEqual({ updated: '2026-08-27', rubricVersion: '1.2.1' });
    expect(await loadScoresMeta('/tmp')).toBeUndefined();
  });
});

describe('ensureWiki + pullWiki against a local git repo', () => {
  test('clones when missing, is ok when present, pull reports no change', () => {
    const base = mkdtempSync(join(tmpdir(), 'wiki-'));
    const origin = join(base, 'origin');
    execFileSync('git', ['init', '-q', '-b', 'master', origin]);
    writeFileSync(join(origin, 'Home.md'), '# Home\n');
    execFileSync('git', ['-C', origin, 'add', '.']);
    execFileSync('git', ['-C', origin, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
    const target = join(base, 'cache', 'wiki');
    expect(ensureWiki(target, origin)).toEqual({ ok: true });
    expect(ensureWiki(target, origin)).toEqual({ ok: true });
    expect(pullWiki(target)).toBe(false);
  });
  test('refuses a directory that is not a clone, without running git', () => {
    const base = mkdtempSync(join(tmpdir(), 'wiki-'));
    const r = ensureWiki(base, 'file:///does-not-exist');
    expect(r).toEqual({ ok: false, reason: `wiki dir exists but is not a git clone; rm -rf ${base} and restart` });
  });
  test('reports failure for a bad url', () => {
    const base = mkdtempSync(join(tmpdir(), 'wiki-'));
    const r = ensureWiki(join(base, 'w'), join(base, 'does-not-exist'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^fatal: repository .* does not exist$/);
  });
});
