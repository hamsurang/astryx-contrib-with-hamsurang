import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Packages whose src/<Dir>/ holds components, in lookup order. */
export const PACKAGES = ['core', 'lab', 'charts', 'richtext'] as const;
export type Package = (typeof PACKAGES)[number];

export type FileRole =
  | 'impl' | 'stylex' | 'markers-stylex' | 'hook' | 'context' | 'types' | 'utils'
  | 'doc' | 'spec' | 'unit-test' | 'perf-test' | 'public-test'
  | 'a11y-states' | 'a11y-renders' | 'a11y-known-failures' | 'a11y-chromium' | 'a11y-test'
  | 'source-build-test' | 'index' | 'module' | 'other';

export interface ComponentLocation {
  package: Package;
  /** Repo-relative directory, e.g. packages/core/src/Chat */
  dir: string;
  /** Set when the requested name is one component inside a multi-component directory. */
  focus?: string;
}

export interface SyncTarget { path: string; note?: string }
export interface Unit { name: string; impl: string; doc?: string; spec?: string; unitTest?: string; syncTargets: SyncTarget[]; syncHeader: boolean }
export interface Styling { file: string; inline: boolean; styleKeys: string[]; tokenImports: string[] }
export interface ThemeSlot { slot: string; file: string; line: number }
export interface OwnerHook { hook: string; from: string; file: string; line: number }
export interface Site { file: string; line: number; text: string }
export interface A11yBinding { pattern?: string; binding: string; states: number; knownFailures: number; file: string }

export interface ComponentReport {
  package: Package;
  dir: string;
  focus?: string;
  units: Unit[];
  files: { path: string; role: FileRole }[];
  styling: Styling[];
  themeSlots: ThemeSlot[];
  ownerHooks: OwnerHook[];
  a11y: { bindings: A11yBinding[]; ariaSites: Site[] };
  i18n: Site[];
  stories: string[];
  warnings: string[];
}

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

function srcBase(pkg: Package): string {
  return `packages/${pkg}/src`;
}

function isDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}

function componentDirs(root: string, pkg: Package): string[] {
  const base = join(root, srcBase(pkg));
  if (!isDir(base)) return [];
  return readdirSync(base).filter((n) => PASCAL.test(n) && isDir(join(base, n)));
}

export function locateComponent(root: string, name: string): ComponentLocation | undefined {
  const lower = name.toLowerCase();
  for (const pkg of PACKAGES) {
    const dirs = componentDirs(root, pkg);
    const exact = dirs.find((d) => d === name) ?? dirs.find((d) => d.toLowerCase() === lower);
    if (exact) return { package: pkg, dir: `${srcBase(pkg)}/${exact}` };
  }
  for (const pkg of PACKAGES) {
    for (const d of componentDirs(root, pkg)) {
      const files = readdirSync(join(root, srcBase(pkg), d));
      const impl = files.find((f) => f === `${name}.tsx`) ?? files.find((f) => f.toLowerCase() === `${lower}.tsx`);
      if (impl) return { package: pkg, dir: `${srcBase(pkg)}/${d}`, focus: impl.slice(0, -4) };
    }
  }
  return undefined;
}

/** Every component directory and PascalCase impl stem across the packages. Empty when root is not a checkout. */
export function componentNames(root: string): Set<string> {
  const names = new Set<string>();
  for (const pkg of PACKAGES) {
    for (const d of componentDirs(root, pkg)) {
      names.add(d);
      for (const f of readdirSync(join(root, srcBase(pkg), d))) {
        if (/^[A-Z][A-Za-z0-9]*\.tsx$/.test(f)) names.add(f.slice(0, -4));
      }
    }
  }
  return names;
}

export function suggestComponents(root: string, name: string, n = 3): string[] {
  const lower = name.toLowerCase();
  const scored = [...componentNames(root)].map((c) => {
    const l = c.toLowerCase();
    const score = l === lower ? 3 : l.includes(lower) || lower.includes(l) ? 2 : l.slice(0, 3) === lower.slice(0, 3) ? 1 : 0;
    return { c, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.c.length - b.c.length).slice(0, n).map((x) => x.c);
}

/** Role from the path relative to the component dir. Order matters: the more specific suffix first. */
export function classify(rel: string): FileRole {
  const base = basename(rel);
  const inTests = rel.includes('__tests__/');
  if (rel.startsWith('modules/')) return 'module';
  if (/\.a11y\.states\.ts$/.test(base)) return 'a11y-states';
  if (/\.a11y\.renders\.tsx$/.test(base)) return 'a11y-renders';
  if (/\.a11y\.known-failures\.ts$/.test(base)) return 'a11y-known-failures';
  if (/\.a11y\.(chromium|browser)\.spec\.ts$/.test(base)) return 'a11y-chromium';
  if (/\.a11y\..*test\.tsx?$/.test(base) || (inTests && /a11y/i.test(base) && /\.test\.tsx?$/.test(base))) return 'a11y-test';
  if (/\.a11y\./.test(base)) return 'a11y-test';
  if (/\.source-build\.test\.mjs$/.test(base)) return 'source-build-test';
  if (/\.public\.test\.tsx?$/.test(base)) return 'public-test';
  if (/perf\.test\.tsx?$/.test(base) || /\.bench\.ts$/.test(base)) return 'perf-test';
  if (/\.test(-[a-z]+)?\.(tsx?|mjs)$/.test(base) || /\.spec\.ts$/.test(base)) return 'unit-test';
  if (/\.doc\.mjs$/.test(base)) return 'doc';
  if (/\.spec\.md$/.test(base)) return 'spec';
  if (/\.markers\.stylex\.ts$/.test(base)) return 'markers-stylex';
  if (/\.stylex\.ts$/.test(base)) return 'stylex';
  if (base === 'index.ts' || base === 'index.tsx') return 'index';
  if (/^use[A-Z][A-Za-z0-9]*\.tsx?$/.test(base)) return 'hook';
  if (/Context\.tsx?$/.test(base)) return 'context';
  if (base === 'types.ts') return 'types';
  if (/^[A-Z][A-Za-z0-9]*\.tsx$/.test(base)) return 'impl';
  if (/^[a-z][A-Za-z0-9]*\.tsx?$/.test(base)) return 'utils';
  return 'other';
}

/**
 * `SYNC:` header list. Handles both "update these files to stay in sync:" and "update:" forms;
 * each entry is ` * - /path (note)`. Stops at the first line that is not an entry.
 */
export function parseSyncHeader(src: string): { found: boolean; targets: SyncTarget[] } {
  const lines = src.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*\*?\s*SYNC:/.test(l));
  if (at === -1) return { found: false, targets: [] };
  const targets: SyncTarget[] = [];
  for (const line of lines.slice(at + 1)) {
    const m = /^\s*\*\s*-\s*(\S+)(?:\s*\((.*)\))?\s*$/.exec(line);
    if (!m) break;
    targets.push({ path: m[1].replace(/^\//, ''), ...(m[2] ? { note: m[2].trim() } : {}) });
  }
  return { found: true, targets };
}

/** Top-level keys of every `stylex.create({...})` call, plus the token modules imported. */
export function parseStylex(src: string): { styleKeys: string[]; tokenImports: string[] } | undefined {
  const keys: string[] = [];
  const re = /stylex\.create\(\s*\{/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(src))) {
    found = true;
    let depth = 1;
    let level1 = '';
    for (let i = m.index + m[0].length; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
      if (depth === 1) level1 += ch;
    }
    for (const k of level1.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:/g)) keys.push(k[1]);
  }
  if (!found) return undefined;
  const tokens = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/theme\/tokens\.stylex'/g)]
    .flatMap((x) => x[1].split(',').map((s) => s.trim().replace(/^type\s+/, '')).filter(Boolean));
  return { styleKeys: [...new Set(keys)], tokenImports: [...new Set(tokens)] };
}

function eachLine(src: string, fn: (line: string, n: number) => void): void {
  src.split(/\r?\n/).forEach((l, i) => fn(l, i + 1));
}

export function findThemeSlots(src: string, file: string): ThemeSlot[] {
  const out: ThemeSlot[] = [];
  eachLine(src, (l, line) => {
    for (const m of l.matchAll(/themeProps\(\s*'([a-z0-9-]+)'/g)) out.push({ slot: m[1], file, line });
  });
  return out;
}

/** `use*` names imported from a sibling directory (`../hooks`, `../Layer`, …). Local hooks are files, not owners. */
export function findOwnerHooks(src: string, file: string): OwnerHook[] {
  const out: OwnerHook[] = [];
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'(\.\.\/[^']+)'/g;
  for (const m of src.matchAll(re)) {
    const line = src.slice(0, m.index).split('\n').length;
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (/^use[A-Z]/.test(name)) out.push({ hook: name, from: m[2], file, line });
    }
  }
  return out;
}

const ARIA = /aria-[a-z]+|\brole=|\btabIndex\b|useAnnounce\(|<VisuallyHidden|\binert\b|\bautoFocus\b|data-autofocus/;

export function findAriaSites(src: string, file: string): Site[] {
  const out: Site[] = [];
  eachLine(src, (l, line) => {
    if (ARIA.test(l) && !/^\s*(\/\/|\*)/.test(l)) out.push({ file, line, text: l.trim().slice(0, 160) });
  });
  return out;
}

export function findI18n(src: string, file: string): Site[] {
  const out: Site[] = [];
  eachLine(src, (l, line) => {
    if (/useTranslator\(/.test(l)) out.push({ file, line, text: l.trim().slice(0, 160) });
  });
  return out;
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Bindings from a `*.a11y.states.ts` file. Most files list `binding: 'X'` rows; the listbox lane
 * keeps a scenario array instead, so fall back to the file stem with the top-level entry count.
 */
export function parseA11yStates(src: string, file: string): { pattern?: string; bindings: Map<string, number> } {
  const pattern = /import\s+type\s*\{\s*(\w+)StateFacts\s*\}\s*from\s*'@astryxdesign\/a11y-spec'/.exec(src)?.[1];
  let bindings = countBindings(src);
  if (!bindings.size && pattern) {
    const stem = basename(file).split('.')[0];
    bindings = new Map([[stem, (src.match(/^ {2}\{$/gm) ?? []).length]]);
  }
  return { pattern: pattern ? kebab(pattern) : undefined, bindings };
}

export function countBindings(src: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of src.matchAll(/\bbinding:\s*'([A-Za-z0-9]+)'/g)) m.set(x[1], (m.get(x[1]) ?? 0) + 1);
  return m;
}

function walk(root: string, rel: string, out: string[]): void {
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__snapshots__') continue;
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(root, p, out);
    else out.push(p);
  }
}

export function analyzeComponent(root: string, loc: ComponentLocation): ComponentReport {
  const paths: string[] = [];
  walk(root, loc.dir, paths);
  paths.sort();
  const files = paths.map((path) => ({ path, role: classify(path.slice(loc.dir.length + 1)) }));
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  const warnings: string[] = [];

  const units: Unit[] = [];
  const noSync: string[] = [];
  const byName = (suffix: string, name: string) => files.find((f) => f.path === `${loc.dir}/${name}${suffix}`)?.path;
  for (const f of files.filter((x) => x.role === 'impl')) {
    const name = basename(f.path, '.tsx');
    const sync = parseSyncHeader(read(f.path));
    if (!sync.found) noSync.push(f.path);
    units.push({
      name, impl: f.path, doc: byName('.doc.mjs', name), spec: byName('.spec.md', name), unitTest: byName('.test.tsx', name),
      syncTargets: sync.targets, syncHeader: sync.found,
    });
  }
  if (noSync.length > 3) warnings.push(`no SYNC header in ${noSync.length} of ${units.length} impl files`);
  else for (const p of noSync) warnings.push(`no SYNC header: ${p}`);
  if (loc.focus && !units.some((u) => u.name === loc.focus)) warnings.push(`focus ${loc.focus} has no impl file`);

  const styling: Styling[] = [];
  const themeSlots: ThemeSlot[] = [];
  const ownerHooks: OwnerHook[] = [];
  const ariaSites: Site[] = [];
  const i18n: Site[] = [];
  const bindings: A11yBinding[] = [];
  const knownFailures = new Map<string, number>();

  for (const f of files) {
    if (f.role === 'a11y-known-failures') {
      for (const [b, n] of countBindings(read(f.path))) knownFailures.set(b, (knownFailures.get(b) ?? 0) + n);
    }
  }
  for (const f of files) {
    if (['doc', 'spec', 'other'].includes(f.role)) continue;
    const src = read(f.path);
    if (['impl', 'stylex', 'markers-stylex', 'hook', 'utils', 'module', 'context'].includes(f.role)) {
      const sx = parseStylex(src);
      if (sx) styling.push({ file: f.path, inline: f.role !== 'stylex' && f.role !== 'markers-stylex', ...sx });
      themeSlots.push(...findThemeSlots(src, f.path));
      ownerHooks.push(...findOwnerHooks(src, f.path));
      ariaSites.push(...findAriaSites(src, f.path));
      i18n.push(...findI18n(src, f.path));
    }
    if (f.role === 'a11y-states') {
      const { pattern, bindings: counts } = parseA11yStates(src, f.path);
      for (const [binding, states] of counts) {
        bindings.push({ pattern, binding, states, knownFailures: knownFailures.get(binding) ?? 0, file: f.path });
      }
    }
  }
  if (!bindings.length) warnings.push('no a11y binding (no __tests__/*.a11y.states.ts)');

  const storiesDir = join(root, 'apps', 'storybook', 'stories');
  const stems = new Set([basename(loc.dir), ...units.map((u) => u.name)]);
  const stories = isDir(storiesDir)
    ? readdirSync(storiesDir).filter((f) => {
        const m = /^(.+)\.stories\.tsx?$/.exec(f);
        return m && [...stems].some((s) => m[1] === s || (m[1].startsWith(s) && /^[A-Z0-9]/.test(m[1].slice(s.length))));
      }).map((f) => `apps/storybook/stories/${f}`)
    : [];
  if (!stories.length) warnings.push('no stories under apps/storybook/stories');

  return {
    package: loc.package, dir: loc.dir, ...(loc.focus ? { focus: loc.focus } : {}),
    units, files, styling, themeSlots, ownerHooks, a11y: { bindings, ariaSites }, i18n, stories, warnings,
  };
}
