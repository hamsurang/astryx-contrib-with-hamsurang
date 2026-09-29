import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { componentNames } from '../component.js';
import { fail, json, type ToolContext } from '../context.js';
import { daysBetween, maintainersFromRecords, standingOf, type Standing } from '../people.js';
import { cached, ghErrorMessage } from '../sources/gh.js';
import { componentNamesIn, fetchIssue, fetchIssueComments, fetchLinkedPrs, forkOpenPrs, searchIssues, type Gh, type Issue, type IssueComment, type LinkedPr, type SearchHit } from '../sources/github.js';
import { loadMembers } from '../sources/members.js';

export const assessIssueFitInput = z.object({
  issue: z.number().int().positive().describe('Upstream issue number'),
});

export interface Signal { id: string; fired: boolean; verdict: 'avoid' | 'good' | 'caution' | 'info'; evidence: string[] }

export interface AssessResult {
  issue: Pick<Issue, 'number' | 'title' | 'state' | 'url' | 'labels' | 'assignees' | 'createdAt' | 'updatedAt'> & { ageDays: number; quietDays: number };
  author: { login: string; standing: Standing; reason: string };
  maintainerComments: { author: string; standing: Standing; createdAt: string; url: string; excerpt: string }[];
  lastMaintainerComment?: { author: string; createdAt: string; url: string; excerpt: string; givesDirection: boolean };
  repro: { codeBlocks: number; storybookLinks: string[]; sandboxLinks: string[]; stepsHeading: boolean };
  linkedPrs: LinkedPr[];
  teamInProgress: { login: string; fork?: string; pr: string }[];
  siblings: SearchHit[];
  signals: Signal[];
  instruction: string;
  warnings: string[];
}

const DIRECTION = /\b(should|let'?s|prefer|go with|option [ab12]|the fix is|instead|rather than|we want|please)\b/i;
const HOLD = /until (the )?authority settles|needs?-scoping|needs scoping|not (yet )?ready|hold off|won'?t fix|out of scope/i;

export function reproSignals(body: string): AssessResult['repro'] {
  return {
    codeBlocks: (body.match(/```/g) ?? []).length / 2 | 0,
    storybookLinks: [...new Set(body.match(/https?:\/\/\S*(storybook|\/iframe\.html\?)[^\s)]*/gi) ?? [])],
    sandboxLinks: [...new Set(body.match(/https?:\/\/(codesandbox\.io|stackblitz\.com|codepen\.io)[^\s)]*/gi) ?? [])],
    stepsHeading: /(steps to reproduce|reproduction|repro\b|how to reproduce)/i.test(body),
  };
}

/** `#N`, `owner/repo#N`, or an issues/N link — but not `#N0` or an `&#N;` entity. */
export function mentionsIssue(text: string, upstream: string, number: number): boolean {
  return new RegExp(`(?<![\\w&])#${number}(?!\\d)|[\\w.-]+/[\\w.-]+#${number}(?!\\d)`).test(text)
    || text.includes(`${upstream}/issues/${number}`) || new RegExp(`\\bissues?/${number}(?!\\d)`).test(text);
}

export function buildSignals(a: {
  issue: Issue; author: { standing: Standing }; comments: IssueComment[]; maintainerComments: AssessResult['maintainerComments'];
  lastMaintainerComment?: AssessResult['lastMaintainerComment']; repro: AssessResult['repro']; linkedPrs: LinkedPr[]; teamInProgress: AssessResult['teamInProgress'];
  siblings: SearchHit[]; quietDays: number;
}): Signal[] {
  const openByOthers = a.linkedPrs.filter((p) => p.state === 'open');
  const holdComment = [...a.comments].reverse().find((c) => HOLD.test(c.body));
  const holdLabel = a.issue.labels.find((l) => /needs-scoping|needs scoping|blocked|on hold/i.test(l));
  const hasRepro = a.repro.codeBlocks > 0 || a.repro.storybookLinks.length > 0 || a.repro.sandboxLinks.length > 0 || a.repro.stepsHeading;
  const closedSiblings = a.siblings.filter((s) => s.state === 'closed' && !s.isPullRequest);
  return [
    { id: 'taken', fired: openByOthers.length > 0 || a.issue.assignees.length > 0, verdict: 'avoid',
      evidence: [...openByOthers.map((p) => `open PR ${p.url} by ${p.author}`), ...a.issue.assignees.map((l) => `assigned to ${l}`)] },
    { id: 'team-in-progress', fired: a.teamInProgress.length > 0, verdict: 'avoid', evidence: a.teamInProgress.map((t) => `${t.login} has ${t.pr}`) },
    { id: 'needs-record-not-code', fired: !!holdComment || !!holdLabel, verdict: 'avoid',
      evidence: [...(holdLabel ? [`label ${holdLabel}`] : []), ...(holdComment ? [`${holdComment.author}: ${holdComment.url}`] : [])] },
    { id: 'maintainer-gave-direction', fired: !!a.lastMaintainerComment?.givesDirection, verdict: 'good',
      evidence: a.lastMaintainerComment?.givesDirection ? [`${a.lastMaintainerComment.author}: ${a.lastMaintainerComment.url}`] : [] },
    { id: 'maintainer-filed-bug', fired: a.author.standing === 'maintainer' && a.issue.labels.some((l) => /bug/i.test(l)), verdict: 'good',
      evidence: a.author.standing === 'maintainer' ? [`filed by maintainer ${a.issue.author}`, ...a.issue.labels.filter((l) => /bug/i.test(l)).map((l) => `label ${l}`)] : [] },
    { id: 'unverified-community-report', fired: a.author.standing === 'community' && a.maintainerComments.length === 0 && !hasRepro, verdict: 'caution',
      evidence: a.author.standing === 'community' ? ['author has no merged PRs', ...(a.maintainerComments.length ? [] : ['no maintainer comment']), ...(hasRepro ? [] : ['no repro'])] : [] },
    { id: 'closed-sibling', fired: closedSiblings.length > 0, verdict: 'info', evidence: closedSiblings.map((s) => `${s.url} (${s.title})`) },
    { id: 'stale', fired: a.quietDays >= 30, verdict: 'caution', evidence: a.quietDays >= 30 ? [`no activity for ${a.quietDays} days`] : [] },
  ];
}

export const INSTRUCTION = [
  'Decide in one line: TAKE / SKIP / ASK. Cite the signal ids that drove it.',
  'Any fired "avoid" signal means SKIP unless the evidence shows it no longer holds (e.g. the open PR is abandoned for 30+ days).',
  'If a closed sibling exists, read how it was closed before writing anything; a closure "until authority settles" wants a record, not code.',
  'Then list what to verify first (repro, the maintainer comment to follow, the component to read with explain_component_internals).',
].join('\n');

export function assessIssueFit(ctx: ToolContext, input: z.infer<typeof assessIssueFitInput>): AssessResult | { error: string } {
  const gh: Gh = { run: ctx.gh, upstream: ctx.upstream, cacheDir: ctx.cacheDir, now: ctx.now };
  const warnings = [...ctx.index.warnings];
  const now = ctx.now();
  let issue: Issue;
  try {
    issue = fetchIssue(gh, input.issue);
  } catch (err) {
    return { error: `issue #${input.issue}: ${ghErrorMessage(err)}` };
  }
  if (issue.isPullRequest) return { error: `#${input.issue} is a pull request, not an issue` };

  const maintainers = maintainersFromRecords(ctx.index);
  const author = { login: issue.author, ...standingOf(issue.author, issue.association, maintainers) };

  let comments: IssueComment[] = [];
  try { comments = fetchIssueComments(gh, input.issue); } catch (err) { warnings.push(`comments not loaded: ${ghErrorMessage(err)}`); }
  const maintainerComments = comments
    .map((c) => ({ c, s: standingOf(c.author, c.association, maintainers) }))
    .filter((x) => x.s.standing === 'maintainer' || x.s.standing === 'member')
    .map((x) => ({ author: x.c.author, standing: x.s.standing, createdAt: x.c.createdAt, url: x.c.url, excerpt: x.c.body.replace(/\s+/g, ' ').slice(0, 240) }));
  const last = maintainerComments[maintainerComments.length - 1];
  const lastBody = last ? comments.find((c) => c.url === last.url)!.body : '';
  const lastMaintainerComment = last ? { ...last, givesDirection: DIRECTION.test(lastBody) } : undefined;

  let linkedPrs: LinkedPr[] = [];
  try { linkedPrs = fetchLinkedPrs(gh, input.issue); } catch (err) { warnings.push(`timeline not loaded: ${ghErrorMessage(err)}`); }

  const { members, warning } = loadMembers();
  if (warning) warnings.push(warning);
  const repoName = ctx.upstream.split('/')[1];
  const teamInProgress: AssessResult['teamInProgress'] = [];
  const addInProgress = (entry: AssessResult['teamInProgress'][number]) => { if (!teamInProgress.some((t) => t.pr === entry.pr)) teamInProgress.push(entry); };
  for (const m of members) {
    try {
      const forkPrs = cached({ dir: ctx.cacheDir, bucket: 'forks', key: `${m.login}/${repoName}`, ttlMs: 10 * 60_000, now: ctx.now }, () => forkOpenPrs(gh, m.login, repoName)).value;
      for (const pr of forkPrs) {
        if (mentionsIssue(`${pr.title}\n${pr.body}`, ctx.upstream, input.issue)) addInProgress({ login: m.login, fork: `${m.login}/${repoName}`, pr: pr.url });
      }
    } catch (err) {
      warnings.push(`fork PRs of ${m.login} not loaded: ${ghErrorMessage(err)}`);
    }
    for (const pr of linkedPrs) if (pr.author === m.login && pr.state === 'open') addInProgress({ login: m.login, pr: pr.url });
  }

  let siblings: SearchHit[] = [];
  const names = componentNamesIn(issue.title, componentNames(ctx.repoRoot));
  if (names.length) {
    try {
      siblings = searchIssues(gh, `is:issue ${names.slice(0, 3).join(' ')}`, 10).filter((s) => s.number !== issue.number);
    } catch (err) {
      warnings.push(`sibling search failed: ${ghErrorMessage(err)}`);
    }
  }

  const repro = reproSignals(issue.body);
  const quietDays = daysBetween(issue.updatedAt, now);
  const signals = buildSignals({ issue, author, comments, maintainerComments, lastMaintainerComment, repro, linkedPrs, teamInProgress, siblings, quietDays });

  return {
    issue: {
      number: issue.number, title: issue.title, state: issue.state, url: issue.url, labels: issue.labels, assignees: issue.assignees,
      createdAt: issue.createdAt, updatedAt: issue.updatedAt, ageDays: daysBetween(issue.createdAt, now), quietDays,
    },
    author, maintainerComments, ...(lastMaintainerComment ? { lastMaintainerComment } : {}), repro, linkedPrs, teamInProgress, siblings, signals,
    instruction: INSTRUCTION, warnings,
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'assess_issue_fit',
    {
      description: 'Is this astryx issue worth taking? Collects the evidence a triager checks: who filed it and their standing, maintainer comments and whether the last one gives direction, repro material, linked and open PRs, whether a teammate already has a fork PR for it, closed sibling issues, and staleness. Returns fired signals with evidence plus an instruction block; the verdict line is yours to write.',
      inputSchema: assessIssueFitInput,
    },
    async (input) => {
      const r = assessIssueFit(ctx, input);
      return 'error' in r ? fail(r.error) : json(r);
    },
  );
}
