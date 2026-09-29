import { cached, DAY_MS, ghJson, type GhRunner } from './gh.js';

/** GitHub reads shared by the issue/PR tools. Every function takes the runner so tests can replay. */

export interface Gh { run: GhRunner; upstream: string; cacheDir: string; now?: () => number }

export interface IssueComment { author: string; association: string; createdAt: string; body: string; url: string }

export interface Issue {
  number: number; title: string; body: string; state: string; url: string; author: string; association: string;
  labels: string[]; assignees: string[]; createdAt: string; updatedAt: string; closedAt: string | null; isPullRequest: boolean;
}

interface RestIssue {
  number: number; title: string; body: string | null; state: string; html_url: string; user: { login: string } | null; author_association: string;
  labels: { name: string }[]; assignees: { login: string }[]; created_at: string; updated_at: string; closed_at: string | null; pull_request?: unknown;
}

function toIssue(r: RestIssue): Issue {
  return {
    number: r.number, title: r.title, body: r.body ?? '', state: r.state, url: r.html_url, author: r.user?.login ?? 'ghost', association: r.author_association,
    labels: r.labels.map((l) => l.name), assignees: r.assignees.map((a) => a.login), createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at,
    isPullRequest: r.pull_request != null,
  };
}

export function fetchIssue(gh: Gh, number: number): Issue {
  return toIssue(ghJson<RestIssue>(gh.run, ['api', `repos/${gh.upstream}/issues/${number}`]));
}

interface RestComment { user: { login: string } | null; author_association: string; created_at: string; body: string; html_url: string }

export function fetchIssueComments(gh: Gh, number: number): IssueComment[] {
  return ghJson<RestComment[]>(gh.run, ['api', `repos/${gh.upstream}/issues/${number}/comments?per_page=100`]).map((c) => ({
    author: c.user?.login ?? 'ghost', association: c.author_association, createdAt: c.created_at, body: c.body, url: c.html_url,
  }));
}

export interface LinkedPr { number: number; title: string; state: 'open' | 'merged' | 'closed'; author: string; url: string }

interface TimelineEvent {
  event: string;
  source?: { issue?: { number: number; title: string; state: string; html_url: string; user: { login: string } | null; pull_request?: { merged_at: string | null } } };
}

/** PRs that mention the issue (timeline `cross-referenced` events whose source is a pull request). */
export function fetchLinkedPrs(gh: Gh, number: number): LinkedPr[] {
  const events = ghJson<TimelineEvent[]>(gh.run, ['api', `repos/${gh.upstream}/issues/${number}/timeline?per_page=100`]);
  const out: LinkedPr[] = [];
  for (const e of events) {
    const s = e.source?.issue;
    if (e.event !== 'cross-referenced' || !s?.pull_request || out.some((p) => p.number === s.number)) continue;
    out.push({
      number: s.number, title: s.title, author: s.user?.login ?? 'ghost', url: s.html_url,
      state: s.pull_request.merged_at ? 'merged' : s.state === 'open' ? 'open' : 'closed',
    });
  }
  return out;
}

export interface SearchHit { number: number; title: string; state: string; url: string; closedAt: string | null; isPullRequest: boolean }

export function searchIssues(gh: Gh, query: string, limit = 10): SearchHit[] {
  const q = `repo:${gh.upstream} ${query}`;
  const res = ghJson<{ items: RestIssue[] }>(gh.run, ['api', `search/issues?q=${encodeURIComponent(q)}&per_page=${limit}`]);
  return res.items.map((i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, closedAt: i.closed_at, isPullRequest: i.pull_request != null }));
}

export function mergedPrCount(gh: Gh, login: string): number {
  const q = `repo:${gh.upstream} is:pr is:merged author:${login}`;
  return ghJson<{ total_count: number }>(gh.run, ['api', `search/issues?q=${encodeURIComponent(q)}&per_page=1`]).total_count;
}

export interface UserStanding { login: string; name: string | null; company: string | null; bio: string | null; mergedPrs: number }

/** Profile plus merged-PR count, cached a day per login. */
export function userStanding(gh: Gh, login: string): UserStanding {
  return cached({ dir: gh.cacheDir, bucket: 'users', key: `${gh.upstream}:${login}`, ttlMs: DAY_MS, now: gh.now }, () => {
    const u = ghJson<{ login: string; name: string | null; company: string | null; bio: string | null }>(gh.run, ['api', `users/${login}`]);
    return { login: u.login, name: u.name, company: u.company, bio: u.bio, mergedPrs: mergedPrCount(gh, login) };
  }).value;
}

export function listLabels(gh: Gh): string[] {
  return cached({ dir: gh.cacheDir, bucket: 'labels', key: gh.upstream, ttlMs: DAY_MS, now: gh.now }, () =>
    ghJson<{ name: string }[]>(gh.run, ['label', 'list', '--repo', gh.upstream, '--limit', '200', '--json', 'name']).map((l) => l.name),
  ).value;
}

export interface ForkPr { number: number; title: string; body: string; url: string; headRef: string }

/** Open PRs on <login>/<repoName> (the member's fork). A missing fork is an empty list. */
export function forkOpenPrs(gh: Gh, login: string, repoName: string): ForkPr[] {
  try {
    return ghJson<{ number: number; title: string; body: string | null; html_url: string; head: { ref: string } }[]>(gh.run, [
      'api', `repos/${login}/${repoName}/pulls?state=open&per_page=50`,
    ]).map((p) => ({ number: p.number, title: p.title, body: p.body ?? '', url: p.html_url, headRef: p.head.ref }));
  } catch {
    return [];
  }
}

export interface PrReviewFull { id: number; author: string; association: string; state: string; submittedAt: string; body: string; url: string }
export interface PrCommentFull { author: string; association: string; createdAt: string; body: string; url: string }
export interface InlineComment {
  id: number; author: string; association: string; createdAt: string; body: string; url: string; path: string; line: number | null; inReplyTo: number | null; reviewId: number | null;
}

export interface PrView {
  number: number; title: string; body: string; state: string; url: string; author: string; headRefName: string; baseRefName: string;
  createdAt: string; mergedAt: string | null; labels: string[]; reviews: PrReviewFull[]; comments: PrCommentFull[];
  lastCommit: { oid: string; committedDate: string } | null;
}

interface RestReview { id: number; user: { login: string } | null; author_association: string; state: string; submitted_at: string; body: string | null; html_url: string }

interface GhPrView {
  number: number; title: string; body: string; state: string; url: string; author: { login: string }; headRefName: string; baseRefName: string;
  createdAt: string; mergedAt: string | null; labels: { name: string }[];
  comments: { author: { login: string } | null; authorAssociation: string; createdAt: string; body: string; url: string }[];
  commits: { oid: string; committedDate: string }[];
}

export function fetchPrView(gh: Gh, number: number): PrView {
  const p = ghJson<GhPrView>(gh.run, [
    'pr', 'view', String(number), '--repo', gh.upstream, '--json',
    'number,title,body,state,url,author,headRefName,baseRefName,createdAt,mergedAt,labels,comments,commits',
  ]);
  // `gh pr view --json reviews` has neither id nor url, so reviews come from REST.
  const reviews = ghJson<RestReview[]>(gh.run, ['api', `repos/${gh.upstream}/pulls/${number}/reviews?per_page=100`]);
  return {
    number: p.number, title: p.title, body: p.body ?? '', state: p.state, url: p.url, author: p.author.login, headRefName: p.headRefName, baseRefName: p.baseRefName,
    createdAt: p.createdAt, mergedAt: p.mergedAt, labels: p.labels.map((l) => l.name),
    reviews: reviews.map((r) => ({ id: r.id, author: r.user?.login ?? 'ghost', association: r.author_association, state: r.state, submittedAt: r.submitted_at, body: r.body ?? '', url: r.html_url })),
    comments: p.comments.map((c) => ({ author: c.author?.login ?? 'ghost', association: c.authorAssociation, createdAt: c.createdAt, body: c.body, url: c.url })),
    lastCommit: p.commits.length ? { oid: p.commits[p.commits.length - 1].oid, committedDate: p.commits[p.commits.length - 1].committedDate } : null,
  };
}

interface RestInline {
  id: number; user: { login: string } | null; author_association: string; created_at: string; body: string; html_url: string; path: string;
  line: number | null; original_line: number | null; in_reply_to_id?: number; pull_request_review_id: number | null;
}

export function fetchInlineComments(gh: Gh, number: number): InlineComment[] {
  return ghJson<RestInline[]>(gh.run, ['api', `repos/${gh.upstream}/pulls/${number}/comments?per_page=100`]).map((c) => ({
    id: c.id, author: c.user?.login ?? 'ghost', association: c.author_association, createdAt: c.created_at, body: c.body, url: c.html_url, path: c.path,
    line: c.line ?? c.original_line, inReplyTo: c.in_reply_to_id ?? null, reviewId: c.pull_request_review_id,
  }));
}

export function fetchPrDiff(gh: Gh, number: number): string {
  return gh.run(['pr', 'diff', String(number), '--repo', gh.upstream]);
}

export function searchMergedPrNumbers(gh: Gh, query: string, limit = 30): number[] {
  return ghJson<{ number: number }[]>(gh.run, ['search', 'prs', '--repo', gh.upstream, '--merged', query, '--limit', String(limit), '--json', 'number']).map((p) => p.number);
}

/** PascalCase identifiers that name a component: multi-part names always, single words only when `known` lists them. */
export function componentNamesIn(text: string, known: Set<string> = new Set()): string[] {
  const out = new Set<string>();
  for (const w of text.match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? []) {
    if (known.has(w) || /^[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+$/.test(w)) out.add(w);
  }
  return [...out];
}
