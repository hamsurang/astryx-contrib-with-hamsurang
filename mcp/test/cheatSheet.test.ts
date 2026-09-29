import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { expandKeywords, matchCheatSheet, parseCheatSheet, parseOwnerApiTable, parseTierSections } from '../src/cheatSheet.js';
import { splitSections, titleOf } from '../src/markdown.js';
import type { Doc } from '../src/types.js';
import { FIXTURE_WIKI } from './wikiFixture.js';

function sheetDoc(): Doc {
  const body = readFileSync(`${FIXTURE_WIKI}Architecture-Cheat-Sheet.md`, 'utf8');
  const id = 'wiki:Architecture-Cheat-Sheet';
  return { id, source: 'wiki', path: 'Architecture-Cheat-Sheet.md', title: titleOf(body, 'x'), sections: splitSections(id, body) };
}

describe('parseOwnerApiTable', () => {
  test('rows with the hooks named in the owner API cell', () => {
    const rows = parseOwnerApiTable('| Trigger | Compose this owner API |\n|---|---|\n| Announce a state transition | `useAnnounce` + `useTranslator`; audit A6 |\n| Trap/restore focus | `useFocusTrap` |\n\nafter');
    expect(rows).toEqual([
      { trigger: 'Announce a state transition', ownerApi: '`useAnnounce` + `useTranslator`; audit A6', hooks: ['useAnnounce', 'useTranslator'] },
      { trigger: 'Trap/restore focus', ownerApi: '`useFocusTrap`', hooks: ['useFocusTrap'] },
    ]);
    expect(parseOwnerApiTable('no table')).toEqual([]);
  });
});

describe('parseTierSections', () => {
  test('### sections under Tier 1/2 only, with summary, route and hooks', () => {
    const s = parseTierSections(sheetDoc());
    expect(s.map((x) => `${x.tier}:${x.heading}`)).toEqual(['1:Layer protocol suite', '1:Accessibility primitives', '2:Size cascade']);
    expect(s[0]).toMatchObject({
      sectionId: 'wiki:Architecture-Cheat-Sheet#layer-protocol-suite',
      summary: 'Prefer an existing layer family: it already owns portal placement, dismissal, nesting, focus, and lifecycle. `useLayer` is low-level infrastructure.',
      route: '`packages/core/src/Layer/`; [Component Audit Rubric §1](Component-Audit-Rubric).',
      hooks: ['useLayer'],
    });
    expect(s[2].route).toBe('`SizeContext/SizeContext.ts`.');
  });
});

describe('matchCheatSheet', () => {
  test('keywords expand through synonyms; hooks match rows and sections', () => {
    expect(expandKeywords(['Label', 'ab'])).toEqual(['label', 'name', 'aria']);
    const sheet = parseCheatSheet(sheetDoc())!;
    const m = matchCheatSheet(sheet, ['popover'], ['useAnnounce']);
    expect(m.rows.map((r) => [r.item.trigger, r.matchedBy])).toEqual([
      ['Announce a state transition', ['useAnnounce']],
      ['Trap/restore focus', ['layer']],
      ['Open floating/modal UI', ['popover', 'layer']],
    ]);
    expect(m.sections.map((r) => [r.item.heading, r.matchedBy])).toEqual([
      ['Layer protocol suite', ['layer']],
      ['Accessibility primitives', ['useAnnounce']],
    ]);
    expect(matchCheatSheet(sheet, [], []).rows).toEqual([]);
  });
  test('undefined doc gives undefined sheet', () => {
    expect(parseCheatSheet(undefined)).toBeUndefined();
  });
});
