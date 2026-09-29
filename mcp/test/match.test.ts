import { describe, expect, test } from 'vitest';
import { dirContains, matchesAppliesTo, normalizePath } from '../src/match.js';

describe('normalizePath', () => {
  test('strips repo root, ./ prefix, backslashes', () => {
    expect(normalizePath('/r/astryx/packages/core/a.ts', '/r/astryx')).toBe('packages/core/a.ts');
    expect(normalizePath('./packages/core/a.ts', '/r/astryx')).toBe('packages/core/a.ts');
    expect(normalizePath('packages\\core\\a.ts', '/r/astryx')).toBe('packages/core/a.ts');
    expect(normalizePath('/other/x.ts', '/r/astryx')).toBe('/other/x.ts');
  });
});

describe('matchesAppliesTo', () => {
  test('directory prefix with or without trailing slash', () => {
    expect(matchesAppliesTo('packages/core/src/', 'packages/core/src/Button/Button.tsx')).toBe(true);
    expect(matchesAppliesTo('packages/cli', 'packages/cli/bin/x.mjs')).toBe(true);
    expect(matchesAppliesTo('packages/cli', 'packages/client/x.mjs')).toBe(false);
  });
  test('exact file', () => {
    expect(matchesAppliesTo('packages/core/src/BaseProps.ts', 'packages/core/src/BaseProps.ts')).toBe(true);
    expect(matchesAppliesTo('packages/core/src/BaseProps.ts', 'packages/core/src/BaseProps.tsx')).toBe(false);
  });
  test('glob', () => {
    expect(matchesAppliesTo('packages/**/theme/**', 'packages/core/src/theme/defineTheme.ts')).toBe(true);
    expect(matchesAppliesTo('packages/**/*.stylex.ts', 'packages/core/src/Layout/padding.stylex.ts')).toBe(true);
    expect(matchesAppliesTo('packages/**/*.stylex.ts', 'packages/core/src/Layout/padding.ts')).toBe(false);
  });
});

describe('dirContains', () => {
  test('spec directory contains component files', () => {
    expect(dirContains('packages/core/src/Button', 'packages/core/src/Button/Button.tsx')).toBe(true);
    expect(dirContains('packages/core/src/Button', 'packages/core/src/ButtonGroup/x.tsx')).toBe(false);
  });
});
