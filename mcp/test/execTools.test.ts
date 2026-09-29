import { beforeAll, describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, type ToolContext } from '../src/context.js';
import { inspectA11yTree, PROBE_SCRIPT, type Spawn } from '../src/tools/inspectA11yTree.js';
import { extractCodeBlocks, validateRepro, type ExtractResult, type RunResult } from '../src/tools/validateRepro.js';
import { replayGh } from './ghReplay.js';

const REPO = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));

let ctx: ToolContext;
beforeAll(async () => {
  ctx = await createContext({ repoRoot: REPO, gh: replayGh(), upstream: 'facebook/astryx', cacheDir: mkdtempSync(join(tmpdir(), 'c-')) });
});
const WIKI_WARN = 'wiki unavailable: no wiki directory';

type Call = { cmd: string; args: string[]; opts: { timeout: number; cwd?: string }; fileAtCall?: string };

function fakeSpawn(result: Partial<ReturnType<Spawn>>, capture?: (c: Call) => void): Spawn & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = ((cmd: string, args: string[], opts: { timeout: number; cwd?: string }) => {
    const c: Call = { cmd, args, opts };
    capture?.(c);
    calls.push(c);
    return { status: 0, stdout: '', stderr: '', signal: null, error: undefined, ...result };
  }) as Spawn & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

describe('validate_repro', () => {
  test('extractCodeBlocks keeps language and source, drops empty blocks', () => {
    expect(extractCodeBlocks('a\n```tsx title=x\n<Badge />\n```\n```\n\n```\n```sh\nnpm i\n```', 'u')).toEqual([
      { source: 'u', lang: 'tsx', code: '<Badge />' }, { source: 'u', lang: 'sh', code: 'npm i' },
    ]);
  });
  test('extract mode pulls blocks and links from the issue and comments', () => {
    const r = validateRepro(ctx, { issue: 456 }) as ExtractResult;
    expect(r.issue).toEqual({ number: 456, title: 'Selector bottom sheet listbox has no accessible name (ChatComposer)', url: 'https://github.com/facebook/astryx/issues/456' });
    expect(r.blocks).toEqual([{ source: 'https://github.com/facebook/astryx/issues/456', lang: 'tsx', code: '<Selector presentation="bottom-sheet" />' }]);
    expect(r.links).toEqual({ storybook: ['https://astryx-storybook.example/iframe.html?id=selector--sheet'], sandbox: [] });
    expect(r.warnings).toEqual([WIKI_WARN]);
    expect(validateRepro(ctx, {})).toEqual({ error: 'give issue (extract mode) or code (run mode)' });
    expect(validateRepro(ctx, { issue: 1 })).toEqual({ error: 'issue #1: gh: Not Found (HTTP 404) [issue-1.json]' });
  });
  test('run mode writes the file under __repro__, runs vitest --project ui, and deletes it', () => {
    const spawn = fakeSpawn({ status: 1, stdout: 'Tests 1 failed', stderr: 'AssertionError' }, (c) => {
      const rel = c.args[c.args.length - 1];
      c.fileAtCall = readFileSync(join(REPO, rel), 'utf8');
    });
    const r = validateRepro(ctx, { code: 'test("x", () => {})' }, spawn) as RunResult;
    expect(spawn.calls).toHaveLength(1);
    const [c] = spawn.calls;
    expect(c.cmd).toBe('pnpm');
    expect(c.args.slice(0, 5)).toEqual(['exec', 'vitest', 'run', '--project', 'ui']);
    expect(c.args[5]).toMatch(/^packages\/core\/src\/__repro__\/repro-[0-9a-f]{8}\.test\.tsx$/);
    expect(c.opts).toEqual({ timeout: 60_000, cwd: REPO });
    expect(c.fileAtCall).toBe('test("x", () => {})');
    expect(existsSync(join(REPO, c.args[5]))).toBe(false);
    expect(existsSync(join(REPO, 'packages/core/src/__repro__'))).toBe(false);
    expect(r).toMatchObject({ runner: 'vitest', file: c.args[5], exitCode: 1, timedOut: false, stdout: 'Tests 1 failed', stderr: 'AssertionError', warnings: [WIKI_WARN] });
  });
  test('node runner at the repo root; timeout is reported', () => {
    const spawn = fakeSpawn({ status: null, signal: 'SIGTERM' });
    const r = validateRepro(ctx, { code: 'console.log(1)', runner: 'node', timeoutMs: 5000 }, spawn) as RunResult;
    expect(spawn.calls[0].cmd).toBe(process.execPath);
    expect(spawn.calls[0].args[0]).toMatch(/\.repro-[0-9a-f]{8}\.mjs$/);
    expect(r).toMatchObject({ runner: 'node', exitCode: null, timedOut: true, warnings: [WIKI_WARN, 'killed after 5000 ms'] });
    expect(existsSync(spawn.calls[0].args[0])).toBe(false);
  });
  test('run mode refuses a non-checkout', async () => {
    const other = await createContext({ repoRoot: mkdtempSync(join(tmpdir(), 'nocheckout-')), gh: replayGh(), cacheDir: mkdtempSync(join(tmpdir(), 'c-')) });
    expect(validateRepro(other, { code: 'x' })).toEqual({ error: 'run mode needs an astryx checkout (cwd or ASTRYX_REPO)' });
  });
});

describe('inspect_a11y_tree', () => {
  test('spawns the probe script with JSON args and returns its JSON', () => {
    const spawn = fakeSpawn({ stdout: JSON.stringify({ story: 's', interactive: ['button "Go"'], tree: [] }) });
    const r = inspectA11yTree(ctx, { story: 'core-button--primary', selector: '#x' }, spawn);
    expect(spawn.calls[0].cmd).toBe(process.execPath);
    expect(spawn.calls[0].args[0]).toBe(PROBE_SCRIPT);
    expect(JSON.parse(spawn.calls[0].args[1])).toEqual({ repo: REPO, baseUrl: 'http://localhost:6006', story: 'core-button--primary', mode: 'tree', selector: '#x' });
    expect(spawn.calls[0].opts.timeout).toBe(90_000);
    expect(r).toEqual({ story: 's', interactive: ['button "Go"'], tree: [], warnings: ['wiki unavailable: no wiki directory'] });
  });
  test('error paths: probe error, timeout, empty output, bad JSON, probe args', () => {
    expect(inspectA11yTree(ctx, { story: 's' }, fakeSpawn({ stdout: JSON.stringify({ error: 'no story' }) }))).toEqual({ error: 'no story' });
    expect(inspectA11yTree(ctx, { story: 's', timeoutMs: 5000, baseUrl: 'http://localhost:1' }, fakeSpawn({ signal: 'SIGTERM', status: null })))
      .toEqual({ error: 'probe timed out after 5000 ms (SIGTERM); is Storybook at http://localhost:1 serving?' });
    expect(inspectA11yTree(ctx, { story: 's' }, fakeSpawn({ stdout: '', stderr: 'boom\nlast', status: 2 }))).toEqual({ error: 'probe produced no output (exit 2): boom | last' });
    expect(inspectA11yTree(ctx, { story: 's' }, fakeSpawn({ stdout: 'nope' }))).toEqual({ error: 'probe output is not JSON: nope' });
    expect(inspectA11yTree(ctx, { story: 's', mode: 'probe' }, fakeSpawn({}))).toEqual({ error: 'probe mode needs control and surface selectors' });
    expect(inspectA11yTree(ctx, { story: 's' }, fakeSpawn({ error: new Error('ENOENT') }))).toEqual({ error: 'probe process failed: ENOENT' });
  });
});
