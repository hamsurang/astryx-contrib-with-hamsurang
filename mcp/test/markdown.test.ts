import { describe, expect, test } from 'vitest';
import { normalizeFrontmatter, parseFrontmatter, slugify, splitSections, titleOf } from '../src/markdown.js';

describe('parseFrontmatter', () => {
  test('extracts yaml block and body', () => {
    const { frontmatter, body } = parseFrontmatter('---\nid: a:b\napplies_to:\n  [\n    packages/core/,\n  ]\n---\n\n# Title\ntext');
    expect(frontmatter).toEqual({ id: 'a:b', applies_to: ['packages/core/'] });
    expect(body).toBe('# Title\ntext');
  });
  test('no frontmatter returns whole text', () => {
    expect(parseFrontmatter('# Only\nbody')).toEqual({ body: '# Only\nbody' });
  });
  test('invalid yaml falls back to whole text', () => {
    const { frontmatter, body } = parseFrontmatter('---\n: : :\n  - [\n---\nbody');
    expect(frontmatter).toBeUndefined();
    expect(body).toContain('body');
  });
});

describe('normalizeFrontmatter', () => {
  test('coerces list fields to string arrays and keeps scalars', () => {
    const fm = normalizeFrontmatter({ id: 'component:X', kind: 'component', authority: 'current', families: 'family:a', verified_by: ['t.ts'] });
    expect(fm.id).toBe('component:X');
    expect(fm.authority).toBe('current');
    expect(fm.families).toEqual(['family:a']);
    expect(fm.verified_by).toEqual(['t.ts']);
    expect(fm.applies_to).toEqual([]);
    expect(fm.members).toEqual([]);
  });
});

describe('slugify', () => {
  test('lowercases, strips punctuation, collapses dashes', () => {
    expect(slugify('Phase 2: Research — Internal')).toBe('phase-2-research-internal');
    expect(slugify('TL;DR')).toBe('tl-dr');
    expect(slugify('`stylex` rules')).toBe('stylex-rules');
  });
  test('preserves trailing # when not preceded by whitespace', () => {
    const body = ['# C#', '## C#'].join('\n');
    const s = splitSections('d', body);
    expect(s[0].heading).toBe('C#');
    expect(s[1].heading).toBe('C#');
    expect(s[1].id).toContain('c');
  });
});

describe('splitSections', () => {
  test('splits on h1-h3, keeps intro, ignores headings inside fences', () => {
    const body = ['intro text', '# Title', 'a', '## Sub', '```', '# not a heading', '```', 'b', '#### deep', 'c'].join('\n');
    const s = splitSections('d', body);
    expect(s.map((x) => x.id)).toEqual(['d#intro', 'd#title', 'd#sub']);
    expect(s[0].body).toBe('intro text');
    expect(s[2].body).toBe(['```', '# not a heading', '```', 'b', '#### deep', 'c'].join('\n'));
    expect(s[2].level).toBe(2);
  });
  test('omits empty intro and dedupes slugs', () => {
    const s = splitSections('d', '# A\n## Same\nx\n## Same\ny');
    expect(s.map((x) => x.id)).toEqual(['d#a', 'd#same', 'd#same-2']);
  });
  test('fence-type mismatch: tilde inside backtick fence does not close', () => {
    const body = ['# Real', '```', '~~~', '# not heading', '```', 'after'].join('\n');
    const s = splitSections('d', body);
    expect(s.map((x) => x.id)).toEqual(['d#real']);
    expect(s[0].body).toContain('# not heading');
    expect(s[0].body).toContain('after');
  });
});

describe('titleOf', () => {
  test('uses first h1 else fallback', () => {
    expect(titleOf('x\n# Real title\n', 'f')).toBe('Real title');
    expect(titleOf('no heading', 'f')).toBe('f');
  });
  test('ignores h1 inside code fences', () => {
    const body = ['```bash', '# not title', '```', '# Real title'].join('\n');
    expect(titleOf(body, 'fallback')).toBe('Real title');
  });
});
