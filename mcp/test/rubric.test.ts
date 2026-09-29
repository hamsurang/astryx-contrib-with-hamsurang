import { describe, expect, test } from 'vitest';
import { fireRows, parseTriggerTable } from '../src/rubric.js';

const BODY = [
  '> intro',
  '>',
  '> | If the diff touches… | Run |',
  '> |---|---|',
  '> | `stylex.create`, a `*.stylex.ts`, or any colour value | §2 T1–T3 |',
  '> | `.doc.mjs` props, stories, or a block | §8 X5 |',
  '> | a published export, or anything consumer-visible | §3 P11–P12 · X20 changeset |',
  '> | rendered output in any way | §5b screenshots |',
  '> | aria-* or keyboard handling | §1 A1 |',
  '>',
  '> after',
  '',
  '| Other | table |',
  '|---|---|',
  '| x | y |',
].join('\n');

describe('parseTriggerTable', () => {
  test('parses only the "If the diff touches" table, inside a blockquote', () => {
    const rows = parseTriggerTable(BODY);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ touched: '`stylex.create`, a `*.stylex.ts`, or any colour value', checks: '§2 T1–T3' });
    expect(rows[2].checks).toBe('§3 P11–P12 · X20 changeset');
  });
  test('returns [] when table missing', () => {
    expect(parseTriggerTable('no table here')).toEqual([]);
  });
});

describe('fireRows', () => {
  test('marks rows fired by path heuristics', () => {
    const rows = parseTriggerTable(BODY);
    const fired = fireRows(rows, ['packages/core/src/A/a.stylex.ts', 'packages/core/src/A/A.doc.mjs', 'packages/core/src/index.ts']);
    expect(fired[0].firedBy).toEqual(['packages/core/src/A/a.stylex.ts']);
    expect(fired[1].firedBy).toEqual(['packages/core/src/A/A.doc.mjs']);
    expect(fired[2].firedBy).toEqual(['packages/core/src/index.ts']);
  });
  test('unfired rows keep empty firedBy', () => {
    const fired = fireRows(parseTriggerTable(BODY), ['README.md']);
    expect(fired.every((r) => r.firedBy.length === 0)).toBe(true);
  });

  test('rows no heuristic can ever fire are marked undetectable', () => {
    const fired = fireRows(parseTriggerTable(BODY), ['packages/core/src/A/a.stylex.ts']);
    expect(fired[0]).toMatchObject({ touched: expect.stringContaining('stylex'), detectable: true });
    expect(fired[4]).toEqual({ touched: 'aria-* or keyboard handling', checks: '§1 A1', firedBy: [], detectable: false });
  });

  test('rendered-output heuristic excludes test and story files', () => {
    const rows = parseTriggerTable(BODY);
    const fired = fireRows(rows, [
      'packages/core/src/A/A.tsx',
      'packages/core/src/A/A.test.tsx',
      'packages/core/src/A/A.stories.tsx',
    ]);
    expect(fired[3].firedBy).toEqual(['packages/core/src/A/A.tsx']);
    expect(fired[1].firedBy).toEqual(['packages/core/src/A/A.stories.tsx']);
  });
});
