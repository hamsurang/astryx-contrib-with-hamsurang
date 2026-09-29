import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail, json, type ToolContext } from '../context.js';

export const inspectA11yTreeInput = z.object({
  story: z.string().min(1).describe('Storybook story id, e.g. core-button--primary (see <baseUrl>/index.json)'),
  baseUrl: z.string().url().optional().describe('Storybook origin; default http://localhost:6006 (dev) — a served build is often http://localhost:6127'),
  mode: z.enum(['tree', 'probe']).optional().describe('tree (default): the accessibility tree, aria snapshot and a Tab walk. probe: hit-test and callback log for a control/surface pair'),
  selector: z.string().optional().describe('tree mode: CSS selector to limit the aria snapshot to a subtree'),
  control: z.string().optional().describe('probe mode: CSS of the role-bearing control'),
  surface: z.string().optional().describe('probe mode: CSS of plain content on the same surface'),
  nested: z.string().optional().describe('probe mode: CSS of a nested control, if any'),
  timeoutMs: z.number().int().min(5000).max(300_000).optional().describe('default 90000'),
});

export type Spawn = (cmd: string, args: string[], opts: { timeout: number; cwd?: string }) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'signal' | 'error'>;

export const realSpawn: Spawn = (cmd, args, opts) =>
  spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout, cwd: opts.cwd, env: { ...process.env, LC_ALL: 'C' } });

export const PROBE_SCRIPT = fileURLToPath(new URL('../../scripts/a11y-probe.mjs', import.meta.url));

export function inspectA11yTree(ctx: ToolContext, input: z.infer<typeof inspectA11yTreeInput>, spawn: Spawn = realSpawn): Record<string, unknown> | { error: string } {
  const mode = input.mode ?? 'tree';
  if (mode === 'probe' && (!input.control || !input.surface)) return { error: 'probe mode needs control and surface selectors' };
  const args = { repo: ctx.repoRoot, baseUrl: input.baseUrl ?? 'http://localhost:6006', story: input.story, mode, selector: input.selector, control: input.control, surface: input.surface, nested: input.nested };
  const timeout = input.timeoutMs ?? 90_000;
  const r = spawn(process.execPath, [PROBE_SCRIPT, JSON.stringify(args)], { timeout });
  if (r.error) return { error: `probe process failed: ${r.error.message}` };
  if (r.signal) return { error: `probe timed out after ${timeout} ms (${r.signal}); is Storybook at ${args.baseUrl} serving?` };
  const text = (r.stdout ?? '').trim();
  if (!text) return { error: `probe produced no output (exit ${r.status}): ${(r.stderr ?? '').trim().split('\n').slice(-3).join(' | ')}` };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: `probe output is not JSON: ${text.slice(0, 200)}` };
  }
  if (typeof parsed.error === 'string') return { error: parsed.error };
  return { ...parsed, warnings: [...ctx.index.warnings] };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'inspect_a11y_tree',
    {
      description: 'What the browser\'s accessibility tree says about a Storybook story: every non-ignored node with role, name, where the name comes from, states, and a DOM descriptor for interactive nodes; plus an aria snapshot and a Tab-order walk. Mode probe replays the reviewer\'s callback-contract probe (hit-test, click/Enter/Space/middle-click/aborted-press logs) for a control/surface pair; run it against the head and a main baseline and compare. Needs a running Storybook (pnpm storybook) or a served build; uses the checkout\'s own Playwright.',
      inputSchema: inspectA11yTreeInput,
    },
    async (input) => {
      const r = inspectA11yTree(ctx, input);
      return 'error' in r ? fail(r.error as string) : json(r);
    },
  );
}
