import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, json, type ToolContext } from '../context.js';
import { ghErrorMessage } from '../sources/gh.js';
import { fetchIssue, fetchIssueComments, type Gh } from '../sources/github.js';
import { isAstryxRepo } from '../sources/repo.js';
import { reproSignals } from './assessIssueFit.js';
import { realSpawn, type Spawn } from './inspectA11yTree.js';

export const validateReproInput = z.object({
  issue: z.number().int().positive().optional().describe('Extract mode: pull every code block and repro link from this issue and its comments'),
  code: z.string().min(1).optional().describe('Run mode: a complete vitest test file (React + @testing-library, imports from ../Badge/Badge etc.) or a node script'),
  runner: z.enum(['vitest', 'node']).optional().describe('default vitest: runs under the checkout\'s ui project (jsdom + StyleX)'),
  timeoutMs: z.number().int().min(5000).max(300_000).optional().describe('default 60000'),
});

export interface CodeBlock { source: string; lang: string; code: string }

export function extractCodeBlocks(text: string, source: string): CodeBlock[] {
  const out: CodeBlock[] = [];
  for (const m of text.matchAll(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g)) {
    const code = m[2].replace(/\s+$/, '');
    if (code.trim()) out.push({ source, lang: m[1] || 'text', code });
  }
  return out;
}

export interface ExtractResult {
  issue: { number: number; title: string; url: string };
  blocks: CodeBlock[];
  links: { storybook: string[]; sandbox: string[] };
  instruction: string;
  warnings: string[];
}

export interface RunResult {
  runner: 'vitest' | 'node';
  file: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  instruction: string;
  warnings: string[];
}

export const EXTRACT_INSTRUCTION = 'Pick the block that shows the failing behavior, turn it into a vitest test under the checkout (imports like ../Badge/Badge, render from @testing-library/react) with an assertion for the issue\'s EXPECTED behavior, and call validate_repro again with code. A failing run then means the bug reproduces; a passing run means it does not (or the assertion is wrong).';
export const RUN_INSTRUCTION = 'Compare the output with the issue\'s expected behavior. Exit 0 = the assertion held (bug not reproduced, or wrong assertion); non-zero = reproduced or the file does not compile — read stderr to tell which.';

const REPRO_DIR = 'packages/core/src/__repro__';

function tail(s: string, lines = 200): string {
  const arr = s.split('\n');
  return arr.length > lines ? `… (${arr.length - lines} earlier lines)\n${arr.slice(-lines).join('\n')}` : s;
}

export function validateRepro(ctx: ToolContext, input: z.infer<typeof validateReproInput>, spawn: Spawn = realSpawn): ExtractResult | RunResult | { error: string } {
  const warnings = [...ctx.index.warnings];
  if (input.code) {
    if (!isAstryxRepo(ctx.repoRoot)) return { error: 'run mode needs an astryx checkout (cwd or ASTRYX_REPO)' };
    const runner = input.runner ?? 'vitest';
    const id = createHash('sha1').update(input.code).digest('hex').slice(0, 8);
    const rel = runner === 'vitest' ? `${REPRO_DIR}/repro-${id}.test.tsx` : `.repro-${id}.mjs`;
    const abs = join(ctx.repoRoot, rel);
    if (existsSync(abs)) return { error: `${rel} already exists; a previous run did not clean up. Delete it and retry.` };
    if (runner === 'vitest') mkdirSync(join(ctx.repoRoot, REPRO_DIR), { recursive: true });
    writeFileSync(abs, input.code);
    const timeout = input.timeoutMs ?? 60_000;
    const started = Date.now();
    let r;
    try {
      r = runner === 'vitest'
        ? spawn('pnpm', ['exec', 'vitest', 'run', '--project', 'ui', rel], { timeout, cwd: ctx.repoRoot })
        : spawn(process.execPath, [abs], { timeout, cwd: ctx.repoRoot });
    } finally {
      rmSync(abs, { force: true });
      const dir = join(ctx.repoRoot, REPRO_DIR);
      if (runner === 'vitest' && existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
    }
    if (r.error) return { error: `${runner} failed to start: ${r.error.message}` };
    const timedOut = r.signal != null;
    if (timedOut) warnings.push(`killed after ${timeout} ms`);
    return {
      runner, file: rel, exitCode: r.status, timedOut, durationMs: Date.now() - started,
      stdout: tail(r.stdout ?? ''), stderr: tail(r.stderr ?? ''), instruction: RUN_INSTRUCTION, warnings,
    };
  }
  if (!input.issue) return { error: 'give issue (extract mode) or code (run mode)' };
  const gh: Gh = { run: ctx.gh, upstream: ctx.upstream, cacheDir: ctx.cacheDir, now: ctx.now };
  try {
    const issue = fetchIssue(gh, input.issue);
    const blocks = extractCodeBlocks(issue.body, issue.url);
    let text = issue.body;
    try {
      for (const c of fetchIssueComments(gh, input.issue)) { blocks.push(...extractCodeBlocks(c.body, c.url)); text += `\n${c.body}`; }
    } catch (err) {
      warnings.push(`comments not loaded: ${ghErrorMessage(err)}`);
    }
    const sig = reproSignals(text);
    if (!blocks.length && !sig.storybookLinks.length && !sig.sandboxLinks.length) warnings.push('no code blocks or repro links in the issue; ask the reporter or build the repro from the description');
    return { issue: { number: issue.number, title: issue.title, url: issue.url }, blocks, links: { storybook: sig.storybookLinks, sandbox: sig.sandboxLinks }, instruction: EXTRACT_INSTRUCTION, warnings };
  } catch (err) {
    return { error: `issue #${input.issue}: ${ghErrorMessage(err)}` };
  }
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'validate_repro',
    {
      description: 'Two steps. Extract: given an issue number, every fenced code block (with source URL and language) and every Storybook/sandbox link from the issue and its comments. Run: given a complete vitest test (or node script) as code, writes it into the checkout under packages/core/src/__repro__/, runs it with the repo\'s own vitest ui project (jsdom + StyleX), returns exit code, stdout, stderr and duration, and deletes the file. Whether the bug reproduces is read from the assertion result.',
      inputSchema: validateReproInput,
    },
    async (input) => {
      const r = validateRepro(ctx, input);
      return 'error' in r ? fail(r.error) : json(r);
    },
  );
}
