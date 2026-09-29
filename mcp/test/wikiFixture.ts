import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The wiki fixture as checked in: real pages, but no .git, so the index treats it as unavailable. */
export const FIXTURE_WIKI = fileURLToPath(new URL('./fixtures/wiki/', import.meta.url));

const createdDirs: string[] = [];

/** A throwaway copy of the fixture that is a git clone, which is what the index loads from. */
export function gitWikiFixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'astryx-wiki-')), 'wiki');
  cpSync(FIXTURE_WIKI, dir, { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  createdDirs.push(dir);
  return dir;
}

/** Removes every temp dir created by gitWikiFixture() so far. Call from an afterAll. */
export function cleanupWikiFixtures(): void {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
