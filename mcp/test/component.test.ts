import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  analyzeComponent, classify, findAriaSites, findOwnerHooks, findThemeSlots, locateComponent, parseA11yStates, parseStylex, parseSyncHeader, suggestComponents,
} from '../src/component.js';

const REPO = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));

describe('classify', () => {
  test.each([
    ['ChatComposer.tsx', 'impl'],
    ['chatLayout.stylex.ts', 'stylex'],
    ['indicator.markers.stylex.ts', 'markers-stylex'],
    ['useComposerDraft.ts', 'hook'],
    ['ChatContext.ts', 'context'],
    ['types.ts', 'types'],
    ['utils.ts', 'utils'],
    ['ChatComposer.doc.mjs', 'doc'],
    ['ChatComposer.spec.md', 'spec'],
    ['ChatComposer.test.tsx', 'unit-test'],
    ['ChatComposer.test-violations.tsx', 'unit-test'],
    ['Selector.source-build.test.mjs', 'source-build-test'],
    ['button.public.test.ts', 'public-test'],
    ['ChatMessageList.perf.test.tsx', 'perf-test'],
    ['__tests__/ChatComposer.a11y.states.ts', 'a11y-states'],
    ['__tests__/Button.a11y.renders.tsx', 'a11y-renders'],
    ['__tests__/Button.a11y.known-failures.ts', 'a11y-known-failures'],
    ['__tests__/Listbox.a11y.chromium.spec.ts', 'a11y-chromium'],
    ['__tests__/Button.a11y.browser.spec.ts', 'a11y-chromium'],
    ['__tests__/Selector.listbox.a11y.test.tsx', 'a11y-test'],
    ['__tests__/Listbox.a11y.dom.ts', 'a11y-test'],
    ['__tests__/Button.a11y.harnesses.tsx', 'a11y-test'],
    ['index.ts', 'index'],
    ['modules/Foo.tsx', 'module'],
    ['THIRD_PARTY_LICENSES.md', 'other'],
  ])('%s → %s', (path, role) => {
    expect(classify(path)).toBe(role);
  });
});

describe('parseSyncHeader', () => {
  test('reads both header wordings and strips the leading slash and notes', () => {
    const a = parseSyncHeader(` * SYNC: When modified, update these files to stay in sync:\n * - /packages/x/A.doc.mjs (props table)\n * - /apps/storybook/stories/A.stories.tsx\n */\nimport x`);
    expect(a).toEqual({ found: true, targets: [{ path: 'packages/x/A.doc.mjs', note: 'props table' }, { path: 'apps/storybook/stories/A.stories.tsx' }] });
    const b = parseSyncHeader(` * SYNC: When modified, update:\n * - /a/b.ts\n *\n * - /not/part.ts`);
    expect(b.targets.map((t) => t.path)).toEqual(['a/b.ts']);
    expect(parseSyncHeader('no header')).toEqual({ found: false, targets: [] });
  });
});

describe('parseStylex', () => {
  test('collects top-level keys across create calls and token imports', () => {
    const src = `import {colorVars, spacingVars} from '../theme/tokens.stylex';
const styles = stylex.create({ root: { color: 'red', ':hover': { opacity: 1 } }, label: {} });
const more = stylex.create({ icon: { size: fn({ nested: 1 }) } });`;
    expect(parseStylex(src)).toEqual({ styleKeys: ['root', 'label', 'icon'], tokenImports: ['colorVars', 'spacingVars'] });
    expect(parseStylex('nothing here')).toBeUndefined();
  });
});

describe('line finders', () => {
  const src = `import {useAnnounce} from '../hooks/useAnnounce';\nimport {useFocusTrap, useMergedRefs, type Foo} from '../hooks';\nimport {useLocal} from './useLocal';\nconst a = themeProps('chat-composer');\nconst b = themeProps('chat-composer-input', {open});\n<div role="group" aria-label={label} />\n// aria-hidden in a comment\n`;
  test('owner hooks come only from sibling directories', () => {
    expect(findOwnerHooks(src, 'f.tsx')).toEqual([
      { hook: 'useAnnounce', from: '../hooks/useAnnounce', file: 'f.tsx', line: 1 },
      { hook: 'useFocusTrap', from: '../hooks', file: 'f.tsx', line: 2 },
      { hook: 'useMergedRefs', from: '../hooks', file: 'f.tsx', line: 2 },
    ]);
  });
  test('theme slots with line numbers', () => {
    expect(findThemeSlots(src, 'f.tsx')).toEqual([{ slot: 'chat-composer', file: 'f.tsx', line: 4 }, { slot: 'chat-composer-input', file: 'f.tsx', line: 5 }]);
  });
  test('aria sites skip comments', () => {
    expect(findAriaSites(src, 'f.tsx')).toEqual([{ file: 'f.tsx', line: 6, text: '<div role="group" aria-label={label} />' }]);
  });
});

describe('parseA11yStates', () => {
  test('binding rows with pattern from the StateFacts import', () => {
    const r = parseA11yStates(`import type {ModalDialogStateFacts} from '@astryxdesign/a11y-spec';\n  {\n    binding: 'Dialog',\n  },\n  {\n    binding: 'Dialog',\n  },\n  {\n    binding: 'AlertDialog',\n  },`, 'x/__tests__/Dialog.a11y.states.ts');
    expect(r.pattern).toBe('modal-dialog');
    expect([...r.bindings]).toEqual([['Dialog', 2], ['AlertDialog', 1]]);
  });
  test('scenario arrays fall back to the file stem and entry count', () => {
    const r = parseA11yStates(`import type {ListboxStateFacts} from '@astryxdesign/a11y-spec';\nexport const S = [\n  {\n    id: 1,\n  },\n  {\n    id: 2,\n  },\n];`, 'x/__tests__/Listbox.a11y.states.ts');
    expect(r.pattern).toBe('listbox');
    expect([...r.bindings]).toEqual([['Listbox', 2]]);
  });
});

describe('locateComponent / suggestComponents', () => {
  test('directory name, sub-component focus, case-insensitive, lab, and misses', () => {
    expect(locateComponent(REPO, 'Chat')).toEqual({ package: 'core', dir: 'packages/core/src/Chat' });
    expect(locateComponent(REPO, 'ChatComposer')).toEqual({ package: 'core', dir: 'packages/core/src/Chat', focus: 'ChatComposer' });
    expect(locateComponent(REPO, 'chatmessage')).toEqual({ package: 'core', dir: 'packages/core/src/Chat', focus: 'ChatMessage' });
    expect(locateComponent(REPO, 'Stat')).toEqual({ package: 'lab', dir: 'packages/lab/src/Stat' });
    expect(locateComponent(REPO, 'Nope')).toBeUndefined();
    expect(suggestComponents(REPO, 'Composer')).toEqual(['ChatComposer']);
    expect(suggestComponents(REPO, 'Cha')).toContain('Chat');
  });
});

describe('analyzeComponent', () => {
  test('Chat: units, roles, styling, slots, hooks, a11y, i18n, stories, warnings', () => {
    const r = analyzeComponent(REPO, { package: 'core', dir: 'packages/core/src/Chat', focus: 'ChatComposer' });
    expect(r.focus).toBe('ChatComposer');
    expect(r.units.map((u) => u.name)).toEqual(['ChatComposer', 'ChatMessage']);
    const composer = r.units[0];
    expect(composer).toMatchObject({
      impl: 'packages/core/src/Chat/ChatComposer.tsx', doc: 'packages/core/src/Chat/ChatComposer.doc.mjs',
      spec: 'packages/core/src/Chat/ChatComposer.spec.md', unitTest: 'packages/core/src/Chat/ChatComposer.test.tsx', syncHeader: true,
    });
    expect(composer.syncTargets.map((t) => t.path)).toEqual([
      'packages/core/src/Chat/ChatComposer.doc.mjs', 'packages/core/src/Chat/ChatComposer.test.tsx', 'apps/storybook/stories/ChatComposer.stories.tsx',
    ]);
    expect(r.units[1].syncHeader).toBe(false);
    const roles = Object.fromEntries(r.files.map((f) => [f.path.replace('packages/core/src/Chat/', ''), f.role]));
    expect(roles).toEqual({
      'ChatComposer.doc.mjs': 'doc', 'ChatComposer.spec.md': 'spec', 'ChatComposer.test-violations.tsx': 'unit-test', 'ChatComposer.test.tsx': 'unit-test',
      'ChatComposer.tsx': 'impl', 'ChatContext.ts': 'context', 'ChatMessage.tsx': 'impl', '__tests__/ChatComposer.a11y.chromium.spec.ts': 'a11y-chromium',
      '__tests__/ChatComposer.a11y.dom.ts': 'a11y-test', '__tests__/ChatComposer.a11y.known-failures.ts': 'a11y-known-failures',
      '__tests__/ChatComposer.a11y.states.ts': 'a11y-states', '__tests__/Listbox.a11y.states.ts': 'a11y-states', 'chatLayout.stylex.ts': 'stylex',
      'index.ts': 'index', 'useComposerDraft.ts': 'hook',
    });
    expect(r.styling).toEqual([
      { file: 'packages/core/src/Chat/ChatComposer.tsx', inline: true, styleKeys: ['root', 'textarea'], tokenImports: ['colorVars', 'spacingVars'] },
      { file: 'packages/core/src/Chat/ChatMessage.tsx', inline: true, styleKeys: ['bubble'], tokenImports: [] },
      { file: 'packages/core/src/Chat/chatLayout.stylex.ts', inline: false, styleKeys: ['column', 'row'], tokenImports: ['spacingVars'] },
    ]);
    expect(r.themeSlots.map((s) => s.slot)).toEqual(['chat-composer', 'chat-composer-input']);
    expect(r.ownerHooks.map((h) => h.hook)).toEqual(['useAnnounce', 'useFocusTrap', 'useMergedRefs', 'useLayer', 'useTranslator']);
    expect(r.a11y.bindings).toEqual([
      { pattern: 'text-input', binding: 'ChatComposer', states: 2, knownFailures: 1, file: 'packages/core/src/Chat/__tests__/ChatComposer.a11y.states.ts' },
      { pattern: 'text-input', binding: 'ChatSendButton', states: 1, knownFailures: 0, file: 'packages/core/src/Chat/__tests__/ChatComposer.a11y.states.ts' },
      { pattern: 'listbox', binding: 'Listbox', states: 2, knownFailures: 0, file: 'packages/core/src/Chat/__tests__/Listbox.a11y.states.ts' },
    ]);
    expect(r.a11y.ariaSites.map((s) => s.line)).toEqual([47, 53, 54, 56]);
    expect(r.i18n).toEqual([{ file: 'packages/core/src/Chat/ChatComposer.tsx', line: 46, text: 'const t = useTranslator();' }]);
    expect(r.stories).toEqual([
      'apps/storybook/stories/Chat.stories.tsx', 'apps/storybook/stories/ChatComposer.stories.tsx',
      'apps/storybook/stories/ChatComposerA11y.stories.tsx', 'apps/storybook/stories/ChatMessage.stories.tsx',
    ]);
    expect(r.warnings).toEqual(['no SYNC header: packages/core/src/Chat/ChatMessage.tsx']);
  });

  test('lab component without header, binding or stories warns once each', () => {
    const r = analyzeComponent(REPO, { package: 'lab', dir: 'packages/lab/src/Stat' });
    expect(r.units.map((u) => u.name)).toEqual(['Stat']);
    expect(r.warnings).toEqual([
      'no SYNC header: packages/lab/src/Stat/Stat.tsx', 'no a11y binding (no __tests__/*.a11y.states.ts)', 'no stories under apps/storybook/stories',
    ]);
  });
});
