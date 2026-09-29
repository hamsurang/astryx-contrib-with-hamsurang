import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GhRunner } from '../src/sources/gh.js';

const DIR = fileURLToPath(new URL('./fixtures/gh/', import.meta.url));

export function fixture(name: string): string {
  return readFileSync(`${DIR}${name}`, 'utf8');
}

/**
 * A gh runner that answers from recorded fixtures and logs every call.
 * Routes: commits-by-path → commits-chat.json, graphql → graphql-chat.json, issue view N → issue-N.json.
 */
export function replayGh(): GhRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const run = ((args: string[]) => {
    calls.push(args);
    const [cmd, sub] = args;
    if (cmd === 'api' && sub.startsWith('repos/') && sub.includes('/commits?path=')) return fixture('commits-chat.json');
    if (cmd === 'api' && sub === 'graphql') return fixture('graphql-chat.json');
    if (cmd === 'issue' && sub === 'view') {
      try {
        return fixture(`issue-${args[2]}.json`);
      } catch {
        const err = new Error('gh failed') as Error & { stderr: string };
        err.stderr = `GraphQL: Could not resolve to an issue with the number of ${args[2]}. (repository.issue)`;
        throw err;
      }
    }
    throw new Error(`replayGh: no fixture for gh ${args.join(' ')}`);
  }) as GhRunner & { calls: string[][] };
  run.calls = calls;
  return run;
}
