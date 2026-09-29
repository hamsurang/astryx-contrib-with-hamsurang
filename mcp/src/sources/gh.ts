import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Runs `gh <args>` and returns stdout. Injected so tests can replay recorded responses. */
export type GhRunner = (args: string[]) => string;

export const realGh: GhRunner = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });

export function ghJson<T>(run: GhRunner, args: string[]): T {
  const out = run(args);
  try {
    return JSON.parse(out) as T;
  } catch {
    throw new Error(`gh ${args.slice(0, 3).join(' ')}: response is not JSON: ${out.slice(0, 120)}`);
  }
}

export function ghErrorMessage(err: unknown): string {
  const e = err as { stderr?: string | Buffer; message?: string };
  const stderr = e.stderr?.toString().trim();
  return (stderr || e.message || String(err)).split('\n')[0];
}

export function resolveCacheDir(): string {
  return process.env.ASTRYX_CACHE_DIR ?? join(homedir(), '.cache', 'astryx-contrib');
}

export const DAY_MS = 24 * 60 * 60 * 1000;

interface Entry<T> { fetchedAt: number; value: T }

/** File cache under <cacheDir>/<bucket>/<sha1(key)>.json with a TTL. `now` is injectable for tests. */
export function cached<T>(opts: { dir: string; bucket: string; key: string; ttlMs: number; now?: () => number }, compute: () => T): { value: T; fromCache: boolean } {
  const now = opts.now ?? Date.now;
  const dir = join(opts.dir, opts.bucket);
  const file = join(dir, `${createHash('sha1').update(opts.key).digest('hex')}.json`);
  if (existsSync(file)) {
    try {
      const entry = JSON.parse(readFileSync(file, 'utf8')) as Entry<T>;
      if (now() - entry.fetchedAt < opts.ttlMs) return { value: entry.value, fromCache: true };
    } catch {
      /* corrupt cache entry: recompute */
    }
  }
  const value = compute();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ fetchedAt: now(), value } satisfies Entry<T>));
  return { value, fromCache: false };
}
