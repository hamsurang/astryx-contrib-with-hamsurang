import { describe, expect, test } from 'vitest';
import { createContext } from '../src/context.js';
import { rulesForPaths } from '../src/tools/rulesForPaths.js';
import { prChecklist } from '../src/tools/prChecklist.js';

const REPO = process.env.ASTRYX_REPO;
const WIKI = process.env.ASTRYX_WIKI_DIR;

describe.skipIf(!REPO)('real astryx checkout', () => {
  test('Selector.tsx resolves to component:Selector and rubric parses', async () => {
    const ctx = await createContext({ repoRoot: REPO!, wikiDir: WIKI });
    const r = rulesForPaths(ctx, { paths: ['packages/core/src/Selector/Selector.tsx'] });
    expect(r.componentSpecs.map((c) => c.id)).toContain('component:Selector');
    expect(r.records.map((x) => x.id)).toContain('architecture:public-component-api');
    if (WIKI) {
      const c = prChecklist(ctx, { changedPaths: ['packages/core/src/Selector/Selector.tsx'] });
      expect(c.rubricParsed).toBe(true);
      expect(c.rubricChecks.length).toBeGreaterThan(5);
    }
  });
});
