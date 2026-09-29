import type { KnowledgeIndex } from './index.js';

export type Standing = 'maintainer' | 'member' | 'contributor' | 'community' | 'bot';

/** Known review bots on facebook/astryx; their approvals are automation, not a maintainer decision. */
export const BOTS = new Set(['astracat-bot', 'vercel', 'github-actions', 'dependabot', 'facebook-github-bot']);

/**
 * Logins named as `owners` or `approved_by` on any spec record. Meta employees show up as plain
 * CONTRIBUTOR in author_association, so the records are the reliable maintainer list.
 */
export function maintainersFromRecords(index: KnowledgeIndex): Set<string> {
  const out = new Set<string>();
  for (const doc of index.docs.values()) {
    for (const l of [...(doc.frontmatter?.owners ?? []), ...(doc.frontmatter?.approved_by ?? [])]) out.add(l);
  }
  return out;
}

export function standingOf(login: string, association: string | null | undefined, maintainers: Set<string>, mergedPrs?: number): { standing: Standing; reason: string } {
  if (BOTS.has(login) || login.endsWith('[bot]')) return { standing: 'bot', reason: 'automation account' };
  if (maintainers.has(login)) return { standing: 'maintainer', reason: 'named as owner/approved_by on a spec record' };
  if (association === 'OWNER' || association === 'MEMBER') return { standing: 'maintainer', reason: `author_association ${association}` };
  if (association === 'COLLABORATOR') return { standing: 'member', reason: 'author_association COLLABORATOR' };
  if (mergedPrs !== undefined && mergedPrs >= 50) return { standing: 'maintainer', reason: `${mergedPrs} merged PRs` };
  if (association === 'CONTRIBUTOR' || (mergedPrs ?? 0) > 0) return { standing: 'contributor', reason: mergedPrs !== undefined ? `${mergedPrs} merged PRs` : 'author_association CONTRIBUTOR' };
  return { standing: 'community', reason: association ? `author_association ${association}` : 'no merged PRs' };
}

export function daysBetween(a: string, b: string | number): number {
  const t = typeof b === 'number' ? b : Date.parse(b);
  return Math.floor(Math.abs(t - Date.parse(a)) / 86_400_000);
}
