import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseFrontmatter, splitSections, titleOf } from '../markdown.js';
import type { Doc } from '../types.js';

export const WIKI_URL = 'https://github.com/facebook/astryx.wiki.git';

export interface ComponentScore {
  component: string;
  package: string;
  status: string;
  score?: number;
  grade?: string;
}

export function resolveWikiDir(): string {
  return process.env.ASTRYX_WIKI_DIR ?? join(homedir(), '.cache', 'astryx-contrib', 'wiki');
}

/** git prints localized messages; the clone/pull results are parsed, so pin the locale. */
const GIT_ENV = { ...process.env, LC_ALL: 'C' };

const notAClone = (dir: string) => `wiki dir exists but is not a git clone; rm -rf ${dir} and restart`;

function gitReason(err: unknown): string {
  return [(err as { stderr?: Buffer }).stderr?.toString(), (err as Error).message].filter(Boolean).join(' ').split('\n')[0];
}

/** Whether the wiki can be read from disk right now, without touching the network. */
export function wikiStatus(dir: string | undefined): { ok: true; dir: string } | { ok: false; reason: string } {
  if (!dir) return { ok: false, reason: 'no wiki directory' };
  if (existsSync(join(dir, '.git'))) return { ok: true, dir };
  return { ok: false, reason: existsSync(dir) ? notAClone(dir) : `no clone at ${dir}` };
}

export function ensureWiki(dir: string, url = WIKI_URL): { ok: boolean; reason?: string } {
  if (existsSync(join(dir, '.git'))) return { ok: true };
  if (existsSync(dir)) return { ok: false, reason: notAClone(dir) };
  try {
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync('git', ['clone', '--quiet', '--depth', '1', url, dir], { stdio: 'pipe', env: GIT_ENV });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: gitReason(err) };
  }
}

export function pullWiki(dir: string): boolean {
  const out = execFileSync('git', ['pull', '--ff-only'], { cwd: dir, stdio: 'pipe', env: GIT_ENV }).toString();
  return !/already up to date/i.test(out);
}

const SKIP = /^(Night-Watch-|_)/;

export async function loadWikiDocs(dir: string): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const name of (await readdir(dir)).sort()) {
    if (!name.endsWith('.md') || SKIP.test(name)) continue;
    const stem = name.slice(0, -3);
    const id = `wiki:${stem}`;
    const { body } = parseFrontmatter(await readFile(join(dir, name), 'utf8'));
    docs.push({ id, source: 'wiki', path: name, title: titleOf(body, stem.replace(/-/g, ' ')), sections: splitSections(id, body) });
  }
  return docs;
}

export interface ScoresMeta {
  updated?: string;
  rubricVersion?: string;
}

/** Ledger-level caveats: when the audit ran and against which rubric version. */
export async function loadScoresMeta(dir: string): Promise<ScoresMeta | undefined> {
  const file = join(dir, 'component-scores.json');
  if (!existsSync(file)) return undefined;
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as ScoresMeta;
    if (data.updated === undefined && data.rubricVersion === undefined) return undefined;
    return { updated: data.updated, rubricVersion: data.rubricVersion };
  } catch {
    return undefined;
  }
}

export async function loadScores(dir: string): Promise<Map<string, ComponentScore>> {
  const map = new Map<string, ComponentScore>();
  const file = join(dir, 'component-scores.json');
  if (!existsSync(file)) return map;
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as { components?: ComponentScore[] };
    for (const c of data.components ?? []) {
      map.set(c.component, { component: c.component, package: c.package, status: c.status, score: c.score, grade: c.grade });
    }
  } catch (err) {
    console.error(`component-scores.json parse failed: ${(err as Error).message}`);
  }
  return map;
}
