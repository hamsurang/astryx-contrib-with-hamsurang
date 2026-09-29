import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Runs `git <args>` in `cwd` with a pinned locale; injected so tests can replay. */
export type GitRunner = (args: string[], cwd: string) => string;

export const realGit: GitRunner = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });

export interface Hunk { file: string; added: number; removed: number; snippet: string; addedText: string }

/** Parses unified diff output into per-file hunks; `snippet` keeps the first `keep` changed lines. */
export function parseUnifiedDiff(diff: string, keep = 40): Hunk[] {
  const out: Hunk[] = [];
  const chunks = diff.split(/^diff --git a\/(\S+) b\/\S+\n/m);
  for (let i = 1; i < chunks.length; i += 2) {
    const lines = (chunks[i + 1] ?? '').split('\n');
    const changed = lines.filter((l) => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---')));
    const added = changed.filter((l) => l.startsWith('+'));
    out.push({
      file: chunks[i], added: added.length, removed: changed.length - added.length,
      snippet: changed.slice(0, keep).join('\n') + (changed.length > keep ? `\n… (${changed.length - keep} more changed lines)` : ''),
      addedText: added.map((l) => l.slice(1)).join('\n'),
    });
  }
  return out;
}

export function changedFiles(git: GitRunner, cwd: string, base: string, head: string): string[] {
  return git(['diff', '--name-only', `${base}...${head}`], cwd).split('\n').filter(Boolean);
}

export function diffHunks(git: GitRunner, cwd: string, base: string, head: string): Hunk[] {
  return parseUnifiedDiff(git(['diff', '-U0', `${base}...${head}`], cwd));
}

export function mergeBase(git: GitRunner, cwd: string, base: string, head: string): string {
  return git(['merge-base', base, head], cwd).trim();
}

/** Files in `files` that `base` changed since the merge-base: main moved under your feet. */
export function movedOnBase(git: GitRunner, cwd: string, base: string, head: string, files: string[]): string[] {
  if (!files.length) return [];
  const mb = mergeBase(git, cwd, base, head);
  return git(['diff', '--name-only', mb, base, '--', ...files], cwd).split('\n').filter(Boolean);
}

export function headSha(git: GitRunner, cwd: string, head: string): string {
  return git(['rev-parse', '--short', head], cwd).trim();
}

export function commitMessage(git: GitRunner, cwd: string, base: string, head: string): string {
  return git(['log', '--format=%B', '-1', `${base}..${head}`], cwd).trim();
}

export function hasRef(git: GitRunner, cwd: string, ref: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', ref], cwd);
    return true;
  } catch {
    return false;
  }
}

/** `pnpm exec prettier --check <files>` from the checkout; undefined when prettier is not installed there. */
export function prettierCheck(cwd: string, files: string[], run = execFileSync): { unformatted: string[] } | undefined {
  if (!files.length) return { unformatted: [] };
  if (!existsSync(join(cwd, 'node_modules', '.bin', 'prettier'))) return undefined;
  try {
    run(join(cwd, 'node_modules', '.bin', 'prettier'), ['--check', ...files], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    return { unformatted: [] };
  } catch (err) {
    const out = `${(err as { stdout?: string }).stdout ?? ''}\n${(err as { stderr?: string }).stderr ?? ''}`;
    const unformatted = out.split('\n').map((l) => l.replace(/^\[warn\]\s*/, '').trim()).filter((l) => files.includes(l));
    return { unformatted: unformatted.length ? unformatted : files.filter((f) => out.includes(f)) };
  }
}
