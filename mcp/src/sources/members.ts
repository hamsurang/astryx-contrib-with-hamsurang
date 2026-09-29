import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export interface Member { login: string; name?: string }

/** `members.yml` at the workspace root (shared with the sync package); `ASTRYX_MEMBERS` overrides the path. */
export function resolveMembersPath(): string {
  return process.env.ASTRYX_MEMBERS ?? fileURLToPath(new URL('../../../members.yml', import.meta.url));
}

export function loadMembers(path = resolveMembersPath()): { members: Member[]; warning?: string } {
  if (!existsSync(path)) return { members: [], warning: `members.yml not found at ${path}; team-in-progress detection is off` };
  const raw = parse(readFileSync(path, 'utf8')) as { members?: { login?: string; name?: string }[] } | null;
  const members = (raw?.members ?? []).filter((m): m is Member => typeof m?.login === 'string').map((m) => ({ login: m.login, ...(m.name ? { name: m.name } : {}) }));
  return { members };
}
