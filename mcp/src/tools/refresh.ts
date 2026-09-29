import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { json, setWikiWarning, type ToolContext } from '../context.js';
import { ensureWiki, pullWiki } from '../sources/wiki.js';

export interface RefreshResult {
  wikiUpdated: boolean;
  docs: number;
  sections: number;
  ms: number;
  warnings: string[];
}

export async function refresh(ctx: ToolContext): Promise<RefreshResult> {
  const t0 = Date.now();
  const warnings: string[] = [];
  let wikiUpdated = false;
  const dir = ctx.wikiDir;
  const wiki = dir ? ensureWiki(dir) : { ok: false, reason: 'no wiki directory' };
  if (wiki.ok && dir) {
    try {
      wikiUpdated = pullWiki(dir);
    } catch (err) {
      warnings.push(`wiki pull failed: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  await ctx.rebuild();
  warnings.push(...ctx.index.warnings);
  if (!wiki.ok) setWikiWarning(warnings, wiki.reason);
  return { wikiUpdated, docs: ctx.index.docs.size, sections: ctx.index.sections.size, ms: Date.now() - t0, warnings };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'refresh',
    { description: 'Clone or pull the latest wiki and rebuild the index from the current checkout. Use after switching branches or when docs changed.', inputSchema: z.object({}) },
    async () => json(await refresh(ctx)),
  );
}
