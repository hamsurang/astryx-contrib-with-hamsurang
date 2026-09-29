import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { json, type ToolContext } from '../context.js';
import type { SearchHit } from '../index.js';

export const searchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  source: z.enum(['repo', 'wiki', 'workflow']).optional().describe('repo = docs/ and *.spec.md, wiki = GitHub wiki, workflow = CONTRIBUTING/REVIEW_GATE/AGENTS'),
});

export function searchTool(ctx: ToolContext, input: z.infer<typeof searchInput>): { hits: SearchHit[]; warnings: string[] } {
  return { hits: ctx.index.search(input.query, { limit: input.limit, source: input.source }), warnings: [...ctx.index.warnings] };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'search',
    { description: 'Keyword search over astryx knowledge records, contributor workflow docs, and the wiki. Returns section-level hits; follow up with get_doc.', inputSchema: searchInput },
    async (input) => json(searchTool(ctx, input)),
  );
}
