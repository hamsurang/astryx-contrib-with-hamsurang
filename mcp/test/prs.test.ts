import { describe, expect, test } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cached, ghErrorMessage, ghJson } from '../src/sources/gh.js';
import { fetchPrs, prNumbersTouching, prStats, prsTouching, reviewRounds } from '../src/sources/prs.js';
import { replayGh } from './ghReplay.js';

describe('gh helpers', () => {
  test('ghJson rejects non-JSON with the command in the message', () => {
    expect(() => ghJson(() => 'not json', ['api', 'x'])).toThrow(/gh api x: response is not JSON/);
  });
  test('ghErrorMessage prefers the first stderr line', () => {
    const err = Object.assign(new Error('Command failed'), { stderr: 'gh: Not Found (HTTP 404)\nmore' });
    expect(ghErrorMessage(err)).toBe('gh: Not Found (HTTP 404)');
    expect(ghErrorMessage(new Error('plain'))).toBe('plain');
  });
  test('cached honours the TTL and survives a corrupt entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-'));
    let t = 1_000;
    let computed = 0;
    const get = () => cached({ dir, bucket: 'b', key: 'k', ttlMs: 100, now: () => t }, () => ++computed);
    expect(get()).toEqual({ value: 1, fromCache: false });
    expect(get()).toEqual({ value: 1, fromCache: true });
    t += 101;
    expect(get()).toEqual({ value: 2, fromCache: false });
    expect(readdirSync(join(dir, 'b'))).toHaveLength(1);
  });
});

describe('prs', () => {
  test('prNumbersTouching parses (#N) from squash titles, deduplicated, in order', () => {
    const gh = replayGh();
    expect(prNumbersTouching(gh, 'facebook/astryx', 'packages/core/src/Chat', 10)).toEqual([6001, 6002, 6003]);
    expect(gh.calls[0]).toEqual(['api', 'repos/facebook/astryx/commits?path=packages%2Fcore%2Fsrc%2FChat&per_page=10']);
  });
  test('fetchPrs drops unmerged PRs and flattens the GraphQL shape, newest first', () => {
    const gh = replayGh();
    const prs = fetchPrs(gh, 'facebook/astryx', [6001, 6002, 6003]);
    expect(prs.map((p) => p.number)).toEqual([6002, 6001]);
    expect(prs[1]).toEqual({
      number: 6001, title: 'fix(ChatComposer): keep the name', body: 'Closes #123', mergedAt: '2026-09-20T00:00:00Z', author: 'kyu',
      authorAssociation: 'CONTRIBUTOR', additions: 30, deletions: 10, changedFiles: 2,
      files: ['packages/core/src/Chat/ChatComposer.tsx', '.changeset/x.md'],
      reviews: [
        { state: 'CHANGES_REQUESTED', author: 'cixzhang', submittedAt: '2026-09-19T00:00:00Z' },
        { state: 'APPROVED', author: 'cixzhang', submittedAt: '2026-09-20T00:00:00Z' },
      ],
      labels: ['CLA Signed'], closesIssues: [123],
    });
    expect(gh.calls[0][3]).toContain('p6001: pullRequest(number: 6001)');
    expect(reviewRounds(prs[1])).toBe(1);
  });
  test('prsTouching caches per directory', () => {
    const gh = replayGh();
    const src = { run: gh, upstream: 'facebook/astryx', cacheDir: mkdtempSync(join(tmpdir(), 'prs-')) };
    expect(prsTouching(src, 'packages/core/src/Chat').fromCache).toBe(false);
    expect(prsTouching(src, 'packages/core/src/Chat').fromCache).toBe(true);
    expect(gh.calls).toHaveLength(2);
  });
  test('prStats medians', () => {
    const prs = fetchPrs(replayGh(), 'facebook/astryx', [6001, 6002]);
    expect(prStats(prs)).toEqual({ prs: 2, medianFiles: 5.5, medianLines: 245, medianReviewRounds: 0.5 });
    expect(prStats([])).toBeUndefined();
  });
});
