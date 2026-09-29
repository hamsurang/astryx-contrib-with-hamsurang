import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { fail, json, type ToolContext } from '../context.js';

export const getDocInput = z.object({
  id: z.string().describe('Doc id such as component:Button, architecture:public-component-api, wiki:API-Conventions, workflow:contributing'),
  section: z.string().optional().describe('Heading slug, e.g. before-you-push'),
});

const FULL_BODY_LIMIT = 8 * 1024;

export type GetDocResult =
  | { ok: true; id: string; title: string; path: string; source: string; authority?: string; sectionId?: string; body?: string; toc?: { sectionId: string; heading: string; level: number; bytes: number }[]; warnings: string[] }
  | { ok: false; error: string; suggestions: string[] };

export function getDoc(ctx: ToolContext, input: z.infer<typeof getDocInput>): GetDocResult {
  const idx = ctx.index;
  const doc = idx.get(input.id);
  if (!doc) return { ok: false, error: `unknown doc id: ${input.id}`, suggestions: idx.suggest(input.id) };
  const base = { ok: true as const, id: doc.id, title: doc.title, path: doc.path, source: doc.source, authority: doc.frontmatter?.authority, warnings: [...idx.warnings] };

  if (input.section) {
    const sectionId = `${doc.id}#${input.section}`;
    const sec = idx.getSection(sectionId);
    if (!sec) return { ok: false, error: `unknown section: ${sectionId}`, suggestions: doc.sections.map((s) => s.id) };
    return { ...base, sectionId, body: sec.body };
  }

  const full = doc.sections.map((s) => (s.heading ? `${'#'.repeat(s.level)} ${s.heading}\n\n${s.body}` : s.body)).join('\n\n');
  if (Buffer.byteLength(full) <= FULL_BODY_LIMIT) return { ...base, body: full };
  return { ...base, toc: doc.sections.map((s) => ({ sectionId: s.id, heading: s.heading, level: s.level, bytes: Buffer.byteLength(s.body) })) };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'get_doc',
    { description: 'Read a knowledge record, workflow doc, or wiki page by id. Large docs return a table of contents; pass section to read one part.', inputSchema: getDocInput },
    async (input) => {
      const r = getDoc(ctx, input);
      return r.ok ? json(r) : fail(`${r.error}\nsuggestions: ${r.suggestions.join(', ')}`);
    },
  );
}
