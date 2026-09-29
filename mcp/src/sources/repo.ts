import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeFrontmatter, parseFrontmatter, splitSections, titleOf } from '../markdown.js';
import type { Doc, Source } from '../types.js';

export const DOC_DIRS = [
  'docs/architecture', 'docs/design', 'docs/families', 'docs/specs', 'docs/contributing', 'docs/themes',
];

export const WORKFLOW_FILES: Record<string, string> = {
  'CONTRIBUTING.md': 'workflow:contributing',
  '.github/REVIEW_GATE.md': 'workflow:review-gate',
  'AGENTS.md': 'workflow:agents',
  'CLAUDE.md': 'workflow:claude',
  'docs/README.md': 'workflow:knowledge-map',
};

const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '__fixtures__', 'fixtures', 'test', 'tests', '__tests__',
]);

/**
 * cwd wins when it is an astryx checkout (Claude Code starts the server in the project dir, so a
 * worktree reads its own branch); ASTRYX_REPO is the fallback for sessions started elsewhere.
 */
export function resolveRepoRoot(env = process.env, cwd = process.cwd()): string {
  if (isAstryxRepo(cwd)) return cwd;
  return env.ASTRYX_REPO ?? cwd;
}

export function isAstryxRepo(root: string): boolean {
  return existsSync(join(root, 'packages', 'core')) && existsSync(join(root, 'docs', 'README.md'));
}

async function walk(root: string, rel: string, out: string[]): Promise<void> {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  for (const e of await readdir(abs, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!EXCLUDED_DIRS.has(e.name)) await walk(root, p, out);
    } else if (e.name.endsWith('.md')) {
      out.push(p);
    }
  }
}

export async function collectRepoFiles(root: string): Promise<{ path: string; source: Source }[]> {
  const out: { path: string; source: Source }[] = [];
  for (const dir of DOC_DIRS) {
    const found: string[] = [];
    await walk(root, dir, found);
    for (const p of found) out.push({ path: p, source: 'repo' });
  }
  const specs: string[] = [];
  await walk(root, 'packages', specs);
  for (const p of specs) {
    if (p.endsWith('.spec.md') && !p.endsWith('.generated.spec.md')) out.push({ path: p, source: 'repo' });
  }
  for (const f of Object.keys(WORKFLOW_FILES)) {
    if (existsSync(join(root, f))) out.push({ path: f, source: 'workflow' });
  }
  return out;
}

export async function loadRepoDocs(root: string): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const { path, source } of await collectRepoFiles(root)) {
    const text = await readFile(join(root, path), 'utf8');
    const { frontmatter: raw, body } = parseFrontmatter(text);
    const fm = raw ? normalizeFrontmatter(raw) : undefined;
    if (fm?.authority === 'archived') continue;
    const id = WORKFLOW_FILES[path] ?? fm?.id ?? path;
    docs.push({ id, source, path, title: titleOf(body, path), frontmatter: fm, sections: splitSections(id, body) });
  }
  return docs;
}

export async function loadTemplate(root: string, file: string): Promise<string | undefined> {
  const p = join(root, 'docs', 'templates', 'knowledge', file);
  if (!existsSync(p)) return undefined;
  return readFile(p, 'utf8');
}

export async function loadTemplateVersions(root: string): Promise<Record<string, number> | undefined> {
  const p = join(root, 'docs', 'templates', 'knowledge', 'versions.json');
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Record<string, number>;
  } catch {
    return undefined;
  }
}
