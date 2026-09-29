import { expect, test } from 'vitest';
import type { Doc } from '../src/types.js';

test('types compile and vitest runs', () => {
  const doc: Doc = { id: 'x', source: 'repo', path: 'x.md', title: 'x', sections: [] };
  expect(doc.id).toBe('x');
});
