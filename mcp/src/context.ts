import { KnowledgeIndex } from './index.js';
import { realGh, resolveCacheDir, type GhRunner } from './sources/gh.js';

export const DEFAULT_UPSTREAM = 'facebook/astryx';

export interface ToolContext {
  repoRoot: string;
  wikiDir?: string;
  index: KnowledgeIndex;
  /** `gh` runner; tests inject a replay. */
  gh: GhRunner;
  /** owner/repo the tools read PRs and issues from. */
  upstream: string;
  cacheDir: string;
  /** Clock; tests pin it. */
  now: () => number;
  rebuild(): Promise<void>;
}

export async function createContext(opts: { repoRoot: string; wikiDir?: string; gh?: GhRunner; upstream?: string; cacheDir?: string; now?: () => number }): Promise<ToolContext> {
  const ctx: ToolContext = {
    repoRoot: opts.repoRoot,
    wikiDir: opts.wikiDir,
    index: await KnowledgeIndex.build(opts),
    gh: opts.gh ?? realGh,
    upstream: opts.upstream ?? process.env.ASTRYX_UPSTREAM ?? DEFAULT_UPSTREAM,
    cacheDir: opts.cacheDir ?? resolveCacheDir(),
    now: opts.now ?? Date.now,
    async rebuild() {
      ctx.index = await KnowledgeIndex.build({ repoRoot: ctx.repoRoot, wikiDir: ctx.wikiDir });
    },
  };
  return ctx;
}

/** Keep exactly one `wiki unavailable` line, carrying the most specific reason we know. */
export function setWikiWarning(warnings: string[], reason = 'unknown'): void {
  const line = `wiki unavailable: ${reason}`;
  const i = warnings.findIndex((w) => w.startsWith('wiki unavailable'));
  if (i === -1) warnings.push(line);
  else warnings[i] = line;
}

export function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function fail(message: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text: message }] };
}
