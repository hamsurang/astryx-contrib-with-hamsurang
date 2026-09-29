import { cached, DAY_MS, ghJson, type GhRunner } from './gh.js';

export interface PrReview { state: string; author: string; submittedAt: string }

export interface PrSummary {
  number: number;
  title: string;
  body: string;
  mergedAt: string;
  author: string;
  authorAssociation: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: string[];
  reviews: PrReview[];
  labels: string[];
  closesIssues: number[];
}

/**
 * PR numbers whose squash-merge commit touched `dir`, newest first. GitHub search has no path
 * qualifier for PRs, but the commit list by path does, and every squash commit ends in `(#N)`.
 */
export function prNumbersTouching(run: GhRunner, upstream: string, dir: string, limit = 30): number[] {
  const commits = ghJson<{ commit: { message: string } }[]>(run, [
    'api', `repos/${upstream}/commits?path=${encodeURIComponent(dir)}&per_page=${Math.min(limit, 100)}`,
  ]);
  const out: number[] = [];
  for (const c of commits) {
    const m = /\(#(\d+)\)\s*$/.exec(c.commit.message.split('\n')[0]);
    if (m && !out.includes(Number(m[1]))) out.push(Number(m[1]));
  }
  return out;
}

interface GqlPr {
  number: number; title: string; body: string; mergedAt: string | null; additions: number; deletions: number; changedFiles: number;
  authorAssociation: string; author: { login: string } | null; labels: { nodes: { name: string }[] };
  reviews: { nodes: { state: string; author: { login: string } | null; submittedAt: string }[] };
  files: { nodes: { path: string }[] }; closingIssuesReferences: { nodes: { number: number }[] };
}

const PR_FIELDS = `number title body mergedAt additions deletions changedFiles authorAssociation author { login }
  labels(first: 20) { nodes { name } }
  reviews(first: 50) { nodes { state author { login } submittedAt } }
  files(first: 100) { nodes { path } }
  closingIssuesReferences(first: 10) { nodes { number } }`;

/** One GraphQL call per 20 PRs, aliased p<N>. Unmerged PRs are dropped. */
export function fetchPrs(run: GhRunner, upstream: string, numbers: number[]): PrSummary[] {
  const [owner, name] = upstream.split('/');
  const out: PrSummary[] = [];
  for (let i = 0; i < numbers.length; i += 20) {
    const chunk = numbers.slice(i, i + 20);
    const fields = chunk.map((n) => `p${n}: pullRequest(number: ${n}) { ${PR_FIELDS} }`).join('\n');
    const query = `query { repository(owner: "${owner}", name: "${name}") { ${fields} } }`;
    const res = ghJson<{ data: { repository: Record<string, GqlPr | null> } }>(run, ['api', 'graphql', '-f', `query=${query}`]);
    for (const pr of Object.values(res.data.repository)) {
      if (!pr?.mergedAt) continue;
      out.push({
        number: pr.number, title: pr.title, body: pr.body ?? '', mergedAt: pr.mergedAt, author: pr.author?.login ?? 'ghost',
        authorAssociation: pr.authorAssociation, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles,
        files: pr.files.nodes.map((f) => f.path),
        reviews: pr.reviews.nodes.map((r) => ({ state: r.state, author: r.author?.login ?? 'ghost', submittedAt: r.submittedAt })),
        labels: pr.labels.nodes.map((l) => l.name), closesIssues: pr.closingIssuesReferences.nodes.map((n) => n.number),
      });
    }
  }
  return out.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
}

export interface PrSource { run: GhRunner; upstream: string; cacheDir: string; now?: () => number }

/** Merged PRs that touched `dir`, cached for a day per directory. */
export function prsTouching(src: PrSource, dir: string, limit = 30): { prs: PrSummary[]; fromCache: boolean } {
  const { value, fromCache } = cached(
    { dir: src.cacheDir, bucket: 'prs', key: `${src.upstream}:${dir}:${limit}`, ttlMs: DAY_MS, now: src.now },
    () => fetchPrs(src.run, src.upstream, prNumbersTouching(src.run, src.upstream, dir, limit)),
  );
  return { prs: value, fromCache };
}

export function reviewRounds(pr: PrSummary): number {
  return pr.reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface PrStats { prs: number; medianFiles: number; medianLines: number; medianReviewRounds: number }

export function prStats(prs: PrSummary[]): PrStats | undefined {
  if (!prs.length) return undefined;
  return {
    prs: prs.length,
    medianFiles: median(prs.map((p) => p.changedFiles)),
    medianLines: median(prs.map((p) => p.additions + p.deletions)),
    medianReviewRounds: median(prs.map(reviewRounds)),
  };
}
