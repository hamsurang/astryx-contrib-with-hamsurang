import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { collectRepoFiles, isAstryxRepo, loadRepoDocs, loadTemplate, loadTemplateVersions, resolveRepoRoot } from '../src/sources/repo.js';

export const FIXTURE_REPO = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));

describe('isAstryxRepo', () => {
  test('true for fixture, false for /tmp', () => {
    expect(isAstryxRepo(FIXTURE_REPO)).toBe(true);
    expect(isAstryxRepo('/tmp')).toBe(false);
  });
});

describe('collectRepoFiles', () => {
  test('finds docs, spec.md, workflow files; skips generated/node_modules', async () => {
    const paths = (await collectRepoFiles(FIXTURE_REPO)).map((f) => f.path).sort();
    expect(paths).toContain('docs/architecture/public-api.md');
    expect(paths).toContain('packages/core/src/Button/Button.spec.md');
    expect(paths).toContain('packages/core/src/Table/plugins/rowStatus/useTableRowStatus.spec.md');
    expect(paths).toContain('CONTRIBUTING.md');
    expect(paths).toContain('.github/REVIEW_GATE.md');
    expect(paths).toContain('docs/README.md');
    expect(paths.some((p) => p.includes('generated'))).toBe(false);
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    expect(paths.some((p) => p.startsWith('docs/templates'))).toBe(false);
  });
});

describe('loadRepoDocs', () => {
  test('assigns ids, drops archived, keeps draft', async () => {
    const docs = await loadRepoDocs(FIXTURE_REPO);
    const ids = docs.map((d) => d.id);
    expect(ids).toContain('architecture:public-api');
    expect(ids).toContain('component:Button');
    expect(ids).toContain('workflow:contributing');
    expect(ids).toContain('workflow:review-gate');
    expect(ids).toContain('workflow:knowledge-map');
    expect(ids).toContain('architecture:draft-idea');
    expect(ids).not.toContain('architecture:old');
    const btn = docs.find((d) => d.id === 'component:Button')!;
    expect(btn.source).toBe('repo');
    expect(btn.title).toBe('Button component contract');
    expect(btn.frontmatter?.families).toEqual(['family:buttons']);
    expect(btn.sections.map((s) => s.id)).toContain('component:Button#intent');
    const contrib = docs.find((d) => d.id === 'workflow:contributing')!;
    expect(contrib.source).toBe('workflow');
    expect(contrib.sections.map((s) => s.id)).toContain('workflow:contributing#before-you-push');
  });
});

describe('templates', () => {
  test('loads template text and versions', async () => {
    expect(await loadTemplate(FIXTURE_REPO, 'component-spec.md')).toContain('<PublicName>');
    expect(await loadTemplate(FIXTURE_REPO, 'nope.md')).toBeUndefined();
    expect(await loadTemplateVersions(FIXTURE_REPO)).toEqual({ component: 4, module: 1 });
  });
});

describe('resolveRepoRoot', () => {
  const FIX = FIXTURE_REPO;
  test('cwd wins when it is a checkout', () => {
    expect(resolveRepoRoot({ ASTRYX_REPO: '/elsewhere' }, FIX)).toBe(FIX);
  });
  test('falls back to ASTRYX_REPO when cwd is not a checkout', () => {
    expect(resolveRepoRoot({ ASTRYX_REPO: FIX }, '/tmp')).toBe(FIX);
  });
  test('returns cwd when neither applies', () => {
    expect(resolveRepoRoot({}, '/tmp')).toBe('/tmp');
  });
});
