import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createContext, type ToolContext } from '../src/context.js';
import { searchTool } from '../src/tools/search.js';
import { getDoc } from '../src/tools/getDoc.js';
import { rulesForPaths } from '../src/tools/rulesForPaths.js';
import { prChecklist } from '../src/tools/prChecklist.js';
import { authoringGuide } from '../src/tools/authoringGuide.js';
import { refresh } from '../src/tools/refresh.js';
import { cleanupWikiFixtures, FIXTURE_WIKI, gitWikiFixture } from './wikiFixture.js';

const REPO = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));

let ctx: ToolContext;
beforeAll(async () => {
  ctx = await createContext({ repoRoot: REPO, wikiDir: gitWikiFixture() });
});
afterAll(cleanupWikiFixtures);

describe('rules_for_paths', () => {
  test('returns records, component specs with score, linked docs, wiki pages, always, warnings', () => {
    const r = rulesForPaths(ctx, { paths: [`${REPO}packages/core/src/Button/Button.tsx`, 'README.md'] });
    expect(r.records.map((x) => x.id).sort()).toEqual(['architecture:public-api', 'design:color', 'family:buttons']);
    const rec = r.records.find((x) => x.id === 'architecture:public-api')!;
    expect(rec).toMatchObject({ kind: 'architecture', authority: 'current', title: 'Public component API', path: 'docs/architecture/public-api.md', via: 'applies_to' });
    expect(rec.summary).toBe('Every core component accepts BaseProps and passes rest props through.');
    expect(r.componentSpecs).toEqual([
      {
        id: 'component:Button', component: 'Button', path: 'packages/core/src/Button/Button.spec.md',
        reviewTriggers: ['public-api', 'behavior', 'accessibility'], families: ['family:buttons'],
        architecture: ['architecture:public-api'], designSpecs: [], verifiedBy: ['packages/core/src/Button/Button.test.tsx'],
        score: { component: 'Button', package: 'core', status: 'audited', score: 91.2, grade: 'A' },
      },
    ]);
    expect(r.scoreLedger).toEqual({ updated: '2026-08-27', rubricVersion: '1.2.1', note: 'static-evidence audit; see wiki:Component-Audit-Rubric' });
    expect(r.wiki.map((w) => w.id)).toContain('wiki:Component-Authoring-Guide');
    expect(r.always.map((w) => w.id)).toEqual(['wiki:Contributing', 'wiki:Astryx-Philosophy']);
    expect(r.warnings).toContain('no record matches README.md');
    expect(r.warnings.some((w) => w.includes('wiki page not loaded: wiki:Design-Conventions'))).toBe(true);
  });
  test('includeDraft surfaces draft records', () => {
    const r = rulesForPaths(ctx, { paths: ['packages/core/src/x.ts'], includeDraft: true });
    expect(r.records.map((x) => x.id)).toContain('architecture:draft-idea');
  });
  test('suppressed draft records are named in warnings', () => {
    const r = rulesForPaths(ctx, { paths: ['packages/core/src/Typeahead/Typeahead.tsx'] });
    expect(r.componentSpecs).toEqual([]);
    expect(r.warnings).toContain('draft records suppressed: component:Typeahead (pass includeDraft: true)');
    expect(r.warnings).toContain('draft records suppressed: architecture:draft-idea (pass includeDraft: true)');
  });
  test('module spec derives component from parent_component', () => {
    const r = rulesForPaths(ctx, { paths: ['packages/core/src/Table/plugins/rowStatus/useTableRowStatus.ts'] });
    const spec = r.componentSpecs.find((x) => x.id === 'module:Table/useTableRowStatus')!;
    expect(spec).toMatchObject({ id: 'module:Table/useTableRowStatus', component: 'Table' });
    expect(spec.score).toBeUndefined();
    expect(r.scoreLedger).toBeUndefined();
  });
});

describe('search', () => {
  test('returns hits and warnings', () => {
    const r = searchTool(ctx, { query: 'spec-owner-approval' });
    expect(r.hits[0].sectionId).toBe('workflow:review-gate#spec-records');
    expect(r.warnings).toEqual([]);
  });
});

describe('get_doc', () => {
  test('small doc returns full body', () => {
    const r = getDoc(ctx, { id: 'wiki:Contributing' });
    expect(r.ok && r.body).toContain('Fork, branch');
  });
  test('section returns just that section', () => {
    const r = getDoc(ctx, { id: 'workflow:review-gate', section: 'spec-records' });
    expect(r.ok && r.body).toBe('Any PR that changes a current record waits on spec-owner-approval.');
    expect(r.ok && r.sectionId).toBe('workflow:review-gate#spec-records');
  });
  test('large doc without section returns toc', () => {
    const big = { ...ctx.index.get('wiki:Contributing')!, id: 'wiki:Big', sections: [{ id: 'wiki:Big#a', heading: 'A', level: 1, body: 'x'.repeat(9000) }] };
    ctx.index.docs.set('wiki:Big', big);
    ctx.index.sections.set('wiki:Big#a', { docId: 'wiki:Big', section: big.sections[0] });
    const r = getDoc(ctx, { id: 'wiki:Big' });
    expect(r.ok && r.toc).toEqual([{ sectionId: 'wiki:Big#a', heading: 'A', level: 1, bytes: 9000 }]);
    expect(r.ok && r.body).toBeUndefined();
  });
  test('unknown id suggests candidates', () => {
    const r = getDoc(ctx, { id: 'component:button' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.suggestions).toContain('component:Button');
  });
  test('unknown section lists section ids', () => {
    const r = getDoc(ctx, { id: 'wiki:Contributing', section: 'nope' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.suggestions).toContain('wiki:Contributing#contributing');
  });
});

describe('pr_checklist', () => {
  test('component change: changeset, verified_by, fired rubric rows, sources', () => {
    const r = prChecklist(ctx, { changedPaths: ['packages/core/src/Button/Button.tsx', 'packages/core/src/Button/button.stylex.ts'] });
    expect(r.changesetRequired).toBe(true);
    expect(r.specOwnerApproval).toBe(false);
    expect(r.designReview).toBe(false);
    expect(r.verifiedBy).toEqual(['packages/core/src/Button/Button.test.tsx', 'packages/core/src/api.test.ts']);
    expect(r.draftRecordsIncluded).toEqual(['architecture:draft-idea']);
    expect(r.rubricParsed).toBe(true);
    expect(r.rubricChecks.find((x) => x.touched.includes('stylex'))?.firedBy).toEqual(['packages/core/src/Button/button.stylex.ts']);
    expect(r.rubricChecks.find((x) => x.touched.includes('published'))?.firedBy).toEqual([]);
    expect(r.rubricChecks.every((x) => x.detectable)).toBe(true);
    expect(r.rubricNote).toBe('firedBy is a filename heuristic. Rows with detectable: false must be judged by reading the diff.');
    expect(r.commands).toEqual(['pnpm lint:strict', 'pnpm test', 'pnpm build']);
    expect(r.sources).toContainEqual({ rule: 'changesetRequired', sectionId: 'workflow:contributing#before-you-push' });
    expect(r.sources).toContainEqual({ rule: 'rubricChecks', sectionId: 'wiki:Component-Audit-Rubric#reviewing-a-change' });
  });
  test('editing a current record needs spec owner approval; design record needs design review', () => {
    const r = prChecklist(ctx, { changedPaths: ['docs/design/color.md'] });
    expect(r.changesetRequired).toBe(false);
    expect(r.specOwnerApproval).toBe(true);
    expect(r.designReview).toBe(true);
    expect(r.sources).toContainEqual({ rule: 'specOwnerApproval', sectionId: 'workflow:review-gate#spec-records' });
  });
  test('draft records count towards verifiedBy and are listed', () => {
    const r = prChecklist(ctx, { changedPaths: ['packages/core/src/Typeahead/Typeahead.tsx'] });
    expect(r.draftRecordsIncluded).toEqual(['architecture:draft-idea', 'component:Typeahead']);
    expect(r.verifiedBy).toContain('packages/core/src/Typeahead/Typeahead.test.tsx');
  });
  test('a record file the index has never seen is flagged', () => {
    const r = prChecklist(ctx, { changedPaths: ['docs/architecture/new-record.md', 'docs/design/color.md', 'packages/core/src/Button/Button.tsx'] });
    expect(r.warnings).toContain('record file not in index — run refresh: docs/architecture/new-record.md');
    expect(r.warnings.filter((w) => w.startsWith('record file not in index'))).toHaveLength(1);
  });
  test('draft record edit does not need approval', () => {
    expect(prChecklist(ctx, { changedPaths: ['docs/architecture/draft-idea.md'] }).specOwnerApproval).toBe(false);
  });
  test('.md files outside the indexed doc dirs are not flagged as missing records', () => {
    const r = prChecklist(ctx, { changedPaths: ['docs/release.md', 'docs/templates/knowledge/component-spec.md', 'docs/architecture/new-record.md'] });
    expect(r.warnings).not.toContain('record file not in index — run refresh: docs/release.md');
    expect(r.warnings).not.toContain('record file not in index — run refresh: docs/templates/knowledge/component-spec.md');
    expect(r.warnings).toContain('record file not in index — run refresh: docs/architecture/new-record.md');
  });
});

describe('authoring_guide', () => {
  test('component: lifecycle + build steps, template, version, missing steps flagged', async () => {
    const r = await authoringGuide(ctx, { kind: 'component' });
    expect(r.steps[0]).toMatchObject({ sectionId: 'wiki:Component-Lifecycle#before-you-start', heading: 'Before You Start' });
    expect(r.steps.find((s) => s.sectionId === 'wiki:Component-Build-Protocol#phase-1-setup')?.body).toBe('Scaffold.');
    expect(r.steps.find((s) => s.sectionId === 'wiki:Component-Build-Protocol#phase-7-tests')).toMatchObject({ missing: true });
    expect(r.template).toContain('<PublicName>');
    expect(r.templateVersion).toBe(4);
  });
  test('family: knowledge-map sections, no template in fixture', async () => {
    const r = await authoringGuide(ctx, { kind: 'family' });
    expect(r.steps[0].sectionId).toBe('workflow:knowledge-map#placement');
    expect(r.template).toBeUndefined();
    expect(r.warnings).toContain('template not found: family-contract.md');
  });
  test('theme: steps resolve against the real wiki page headings', async () => {
    const r = await authoringGuide(ctx, { kind: 'theme' });
    expect(r.steps[0]).toMatchObject({ sectionId: 'wiki:Theming-Infrastructure#theming-infrastructure', heading: 'Theming Infrastructure', body: 'Themes override declared targets.' });
    expect(r.steps[1].body).toBe('Components expose theme targets.');
  });
});

describe('refresh', () => {
  test('a wiki dir that is not a clone is reported once, and the index still rebuilds', async () => {
    const c = await createContext({ repoRoot: REPO, wikiDir: FIXTURE_WIKI });
    const r = await refresh(c);
    expect(r.wikiUpdated).toBe(false);
    expect(r.docs).toBeGreaterThan(5);
    expect(r.warnings.filter((w) => w.startsWith('wiki unavailable'))).toEqual([
      `wiki unavailable: wiki dir exists but is not a git clone; rm -rf ${FIXTURE_WIKI} and restart`,
    ]);
  });
  test('rebuilds the index; a clone with no upstream reports the failed pull', async () => {
    const r = await refresh(ctx);
    expect(r.wikiUpdated).toBe(false);
    expect(r.docs).toBeGreaterThan(5);
    expect(r.sections).toBeGreaterThan(r.docs);
    expect(r.warnings.some((w) => w.startsWith('wiki pull failed'))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('wiki unavailable'))).toBe(false);
  });
});
