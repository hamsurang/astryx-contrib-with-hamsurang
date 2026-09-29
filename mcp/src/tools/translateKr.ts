import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { componentNames } from '../component.js';
import { fail, json, type ToolContext } from '../context.js';
import { daysBetween, maintainersFromRecords, standingOf, type Standing } from '../people.js';
import { ghErrorMessage } from '../sources/gh.js';
import {
  componentNamesIn, fetchInlineComments, fetchIssue, fetchIssueComments, fetchPrView, listLabels, searchIssues, userStanding,
  type Gh, type SearchHit,
} from '../sources/github.js';

export const translateKrInput = z.object({
  url: z.string().url().optional().describe('GitHub issue/PR URL, optionally with a #issuecomment-, #pullrequestreview- or #discussion_r anchor'),
  text: z.string().min(1).optional().describe('Raw English text when there is no GitHub URL'),
});

export interface Target { kind: 'issue-body' | 'pr-body' | 'comment' | 'review' | 'inline' | 'text'; author?: string; standing?: Standing; state?: string; timestamp?: string; path?: string; line?: number | null; url?: string; body: string }

export interface TranslateResult {
  target: Target;
  context?: {
    title: string; state: string; url: string; author: { login: string; standing: Standing; reason: string; company?: string | null; bio?: string | null; mergedPrs?: number };
    labels: string[]; unusedLabels: string[]; siblings: SearchHit[];
    thread: { kind: 'comment' | 'review' | 'inline'; author: string; standing: Standing; state?: string; timestamp: string; path?: string; line?: number | null; url: string; body: string }[];
    staleness?: { lastCommit: string; reviewsBeforeLastCommit: string[] };
  };
  instruction: string;
  warnings: string[];
}

export interface ParsedUrl { owner: string; repo: string; kind: 'issues' | 'pull'; number: number; anchor?: { type: 'issuecomment' | 'pullrequestreview' | 'discussion_r'; id: number } }

export function parseGithubUrl(url: string): ParsedUrl | undefined {
  const m = /github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)(?:[^#]*)?(?:#(issuecomment|pullrequestreview|discussion_r)-?(\d+))?/.exec(url);
  if (!m) return undefined;
  return {
    owner: m[1], repo: m[2], kind: m[3] as 'issues' | 'pull', number: Number(m[4]),
    ...(m[5] ? { anchor: { type: m[5] as ParsedUrl['anchor'] extends infer A ? A extends { type: infer T } ? T : never : never, id: Number(m[6]) } } : {}),
  };
}

export const INSTRUCTION = [
  '1. Translate the target line by line, in order. One bullet per sentence: bold the original English, then the Korean. Keep identifiers, prop names, paths and numbers verbatim; keep hedged politeness as a request, not a suggestion. Split compound sentences at the clause boundary.',
  '2. Before the bullets, name the author, their standing, the state and the timestamp.',
  '3. Then 2–3 sentences of what it actually means: the real ask, the criterion in play, what is implied. A nominally open choice usually has a preferred branch (first-listed, endorsed by "correctly"/"already", or set by a sibling); weigh by standing; separate what is settled from what is open.',
  '4. Then the next actions, ordered and concrete: what to change, in which file, how it is checked. Call out options already rejected, whether the reading is stale (a push landed after the review), whether it needs a public API change or a spec owner, and any claim that contradicts the code.',
  'Report and stop: do not post, push or request re-review.',
].join('\n');

export function translateKr(ctx: ToolContext, input: z.infer<typeof translateKrInput>): TranslateResult | { error: string } {
  if (!input.url && !input.text) return { error: 'give url or text' };
  if (!input.url) return { target: { kind: 'text', body: input.text! }, instruction: INSTRUCTION, warnings: [] };

  const parsed = parseGithubUrl(input.url);
  if (!parsed) return { error: `not a GitHub issue/PR URL: ${input.url}` };
  const gh: Gh = { run: ctx.gh, upstream: `${parsed.owner}/${parsed.repo}`, cacheDir: ctx.cacheDir, now: ctx.now };
  const warnings = [...ctx.index.warnings];
  const maintainers = maintainersFromRecords(ctx.index);
  const thread: NonNullable<TranslateResult['context']>['thread'] = [];
  let target: Target | undefined;
  let title: string, state: string, url: string, authorLogin: string, authorAssoc: string, body: string, labels: string[];
  let staleness: NonNullable<TranslateResult['context']>['staleness'];

  try {
    if (parsed.kind === 'pull') {
      const pr = fetchPrView(gh, parsed.number);
      ({ title, state, url, body, labels } = pr);
      authorLogin = pr.author;
      // gh pr view has no authorAssociation; the issues endpoint answers for PR numbers too.
      try { authorAssoc = fetchIssue(gh, parsed.number).association; } catch (err) { authorAssoc = ''; warnings.push(`author association not loaded: ${ghErrorMessage(err)}`); }
      for (const c of pr.comments) thread.push({ kind: 'comment', author: c.author, standing: standingOf(c.author, c.association, maintainers).standing, timestamp: c.createdAt, url: c.url, body: c.body });
      for (const r of pr.reviews) if (r.body || r.state !== 'COMMENTED') thread.push({ kind: 'review', author: r.author, standing: standingOf(r.author, r.association, maintainers).standing, state: r.state, timestamp: r.submittedAt, url: r.url, body: r.body });
      let inline: ReturnType<typeof fetchInlineComments> = [];
      try { inline = fetchInlineComments(gh, parsed.number); } catch (err) { warnings.push(`inline comments not loaded: ${ghErrorMessage(err)}`); }
      for (const c of inline) thread.push({ kind: 'inline', author: c.author, standing: standingOf(c.author, c.association, maintainers).standing, timestamp: c.createdAt, path: c.path, line: c.line, url: c.url, body: c.body });
      if (pr.lastCommit) {
        const before = pr.reviews.filter((r) => r.submittedAt < pr.lastCommit!.committedDate).map((r) => `${r.author} ${r.state} ${r.submittedAt}`);
        staleness = { lastCommit: pr.lastCommit.committedDate, reviewsBeforeLastCommit: before };
      }
      if (parsed.anchor?.type === 'discussion_r') {
        const c = inline.find((x) => x.id === parsed.anchor!.id);
        if (c) target = { kind: 'inline', author: c.author, standing: standingOf(c.author, c.association, maintainers).standing, timestamp: c.createdAt, path: c.path, line: c.line, url: c.url, body: c.body };
      } else if (parsed.anchor?.type === 'pullrequestreview') {
        const r = pr.reviews.find((x) => x.id === parsed.anchor!.id);
        if (r) target = { kind: 'review', author: r.author, standing: standingOf(r.author, r.association, maintainers).standing, state: r.state, timestamp: r.submittedAt, url: r.url, body: r.body };
        else warnings.push(`review ${parsed.anchor.id} not found; translating the body`);
      } else if (parsed.anchor?.type === 'issuecomment') {
        const c = pr.comments.find((x) => x.url.endsWith(`issuecomment-${parsed.anchor!.id}`));
        if (c) target = { kind: 'comment', author: c.author, standing: standingOf(c.author, c.association, maintainers).standing, timestamp: c.createdAt, url: c.url, body: c.body };
      }
      target ??= { kind: 'pr-body', author: pr.author, timestamp: pr.createdAt, state: pr.state, url: pr.url, body: pr.body };
    } else {
      const issue = fetchIssue(gh, parsed.number);
      ({ title, state, url, body, labels } = issue);
      authorLogin = issue.author; authorAssoc = issue.association;
      let comments: ReturnType<typeof fetchIssueComments> = [];
      try { comments = fetchIssueComments(gh, parsed.number); } catch (err) { warnings.push(`comments not loaded: ${ghErrorMessage(err)}`); }
      for (const c of comments) thread.push({ kind: 'comment', author: c.author, standing: standingOf(c.author, c.association, maintainers).standing, timestamp: c.createdAt, url: c.url, body: c.body });
      if (parsed.anchor?.type === 'issuecomment') {
        const c = comments.find((x) => x.url.endsWith(`issuecomment-${parsed.anchor!.id}`));
        if (c) target = { kind: 'comment', author: c.author, standing: standingOf(c.author, c.association, maintainers).standing, timestamp: c.createdAt, url: c.url, body: c.body };
        else warnings.push(`comment ${parsed.anchor.id} not found; translating the body`);
      }
      target ??= { kind: 'issue-body', author: issue.author, standing: standingOf(issue.author, issue.association, maintainers).standing, timestamp: issue.createdAt, state: issue.state, url: issue.url, body: issue.body };
    }
  } catch (err) {
    return { error: `${parsed.kind === 'pull' ? 'PR' : 'issue'} #${parsed.number}: ${ghErrorMessage(err)}` };
  }

  let author: NonNullable<TranslateResult['context']>['author'];
  try {
    const u = userStanding(gh, authorLogin);
    author = { login: authorLogin, ...standingOf(authorLogin, authorAssoc, maintainers, u.mergedPrs), company: u.company, bio: u.bio, mergedPrs: u.mergedPrs };
  } catch (err) {
    warnings.push(`author standing not loaded: ${ghErrorMessage(err)}`);
    author = { login: authorLogin, ...standingOf(authorLogin, authorAssoc, maintainers) };
  }
  if (target.author === authorLogin && !target.standing) target.standing = author.standing;

  let unusedLabels: string[] = [];
  try { unusedLabels = listLabels(gh).filter((l) => !labels.includes(l)); } catch (err) { warnings.push(`label list not loaded: ${ghErrorMessage(err)}`); }

  let siblings: SearchHit[] = [];
  const names = componentNamesIn(title, componentNames(ctx.repoRoot));
  if (names.length) {
    try { siblings = searchIssues(gh, names.slice(0, 3).join(' '), 10).filter((s) => s.number !== parsed.number); }
    catch (err) { warnings.push(`sibling search failed: ${ghErrorMessage(err)}`); }
  }
  thread.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (staleness && target.kind === 'review' && target.timestamp && target.timestamp < staleness.lastCommit) {
    warnings.push(`target review is ${daysBetween(target.timestamp, staleness.lastCommit)} day(s) older than the last push; it may be stale`);
  }
  return { target, context: { title, state, url, author, labels, unusedLabels, siblings, thread, ...(staleness ? { staleness } : {}) }, instruction: INSTRUCTION, warnings };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'translate_kr',
    {
      description: 'Everything needed to translate a GitHub issue, PR, review, or comment into Korean line by line and say what it actually means: the target text, the whole thread (comments, reviews, inline comments), the author\'s standing, labels used vs available, sibling issues, and whether a push landed after the review. Pass text instead of url for prose from elsewhere. Follow the instruction block in the response.',
      inputSchema: translateKrInput,
    },
    async (input) => {
      const r = translateKr(ctx, input);
      return 'error' in r ? fail(r.error) : json(r);
    },
  );
}
