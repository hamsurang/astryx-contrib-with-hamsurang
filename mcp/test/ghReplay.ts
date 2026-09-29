import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GhRunner } from '../src/sources/gh.js';

const DIR = fileURLToPath(new URL('./fixtures/gh/', import.meta.url));

export function fixture(name: string): string {
  return readFileSync(`${DIR}${name}`, 'utf8');
}

function ghError(stderr: string): never {
  const err = new Error('gh failed') as Error & { stderr: string };
  err.stderr = stderr;
  throw err;
}

/** Route table: the first matcher that returns a fixture name wins. */
const ROUTES: ((args: string[]) => string | undefined)[] = [
  ([c, s]) => (c === 'api' && s.includes('/commits?path=') ? 'commits-chat.json' : undefined),
  ([c, s]) => (c === 'api' && s === 'graphql' ? 'graphql-chat.json' : undefined),
  ([c, s, n]) => (c === 'issue' && s === 'view' ? `issue-${n}.json` : undefined),
  ([c, s]) => { const m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments/.exec(s ?? ''); return c === 'api' && m ? `issue-${m[1]}-comments.json` : undefined; },
  ([c, s]) => { const m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/timeline/.exec(s ?? ''); return c === 'api' && m ? `issue-${m[1]}-timeline.json` : undefined; },
  ([c, s]) => { const m = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(s ?? ''); return c === 'api' && m ? `issue-${m[1]}.json` : undefined; },
  ([c, s]) => { const m = /^repos\/([^/]+)\/astryx\/pulls\?state=open/.exec(s ?? ''); return c === 'api' && m ? `fork-${m[1]}-pulls.json` : undefined; },
  ([c, s]) => { const m = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/reviews/.exec(s ?? ''); return c === 'api' && m ? `pr-reviews-${m[1]}.json` : undefined; },
  ([c, s]) => { const m = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/comments/.exec(s ?? ''); return c === 'api' && m ? `pr-inline-${m[1]}.json` : undefined; },
  ([c, s]) => { const m = /^users\/([^/]+)$/.exec(s ?? ''); return c === 'api' && m ? `user-${m[1]}.json` : undefined; },
  ([c, s]) => {
    if (c !== 'api' || !s?.startsWith('search/issues?q=')) return undefined;
    const q = decodeURIComponent(s.slice('search/issues?q='.length).split('&')[0]);
    const author = /author:(\S+)/.exec(q)?.[1];
    return author ? `search-merged-${author}.json` : 'search-issues-selector.json';
  },
  ([c, s]) => (c === 'label' && s === 'list' ? 'labels.json' : undefined),
  ([c, s, n]) => (c === 'pr' && s === 'view' ? `pr-view-${n}.json` : undefined),
  ([c, s, n]) => (c === 'pr' && s === 'diff' ? `pr-diff-${n}.txt` : undefined),
  ([c, s]) => (c === 'search' && s === 'prs' ? 'search-prs.json' : undefined),
];

/** A gh runner that answers from recorded fixtures and logs every call. Unknown numbers raise a gh-shaped error. */
export function replayGh(): GhRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const run = ((args: string[]) => {
    calls.push(args);
    for (const route of ROUTES) {
      const name = route(args);
      if (!name) continue;
      try {
        return fixture(name);
      } catch {
        return ghError(`gh: Not Found (HTTP 404) [${name}]`);
      }
    }
    throw new Error(`replayGh: no route for gh ${args.join(' ')}`);
  }) as GhRunner & { calls: string[][] };
  run.calls = calls;
  return run;
}
