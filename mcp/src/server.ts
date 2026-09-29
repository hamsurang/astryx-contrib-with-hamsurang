#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createContext, fail, setWikiWarning } from './context.js';
import { isAstryxRepo, resolveRepoRoot } from './sources/repo.js';
import { ensureWiki, resolveWikiDir, wikiStatus } from './sources/wiki.js';
import * as rulesForPaths from './tools/rulesForPaths.js';
import * as search from './tools/search.js';
import * as getDoc from './tools/getDoc.js';
import * as prChecklist from './tools/prChecklist.js';
import * as authoringGuide from './tools/authoringGuide.js';
import * as refresh from './tools/refresh.js';
import * as explainComponentInternals from './tools/explainComponentInternals.js';
import * as estimateChangeScope from './tools/estimateChangeScope.js';
import * as findReferencePr from './tools/findReferencePr.js';
import * as assessIssueFit from './tools/assessIssueFit.js';
import * as translateKr from './tools/translateKr.js';
import * as simulateReview from './tools/simulateReview.js';
import * as validateRepro from './tools/validateRepro.js';
import * as inspectA11yTree from './tools/inspectA11yTree.js';

const NOT_REPO = 'Not an astryx checkout. Set ASTRYX_REPO or run the server from an astryx checkout.';

/** `--check`: build the index once, print what was found, and exit. Used by install.sh. */
const CHECK = process.argv.includes('--check');

async function main(): Promise<void> {
  const server = new McpServer({ name: 'astryx-contrib', version: '0.1.0' });
  const repoRoot = resolveRepoRoot();

  if (CHECK) {
    if (!isAstryxRepo(repoRoot)) {
      console.error(`check: ${NOT_REPO} (looked at ${repoRoot})`);
      process.exit(1);
    }
    const wikiDir = resolveWikiDir();
    const wiki = ensureWiki(wikiDir);
    const ctx = await createContext({ repoRoot, wikiDir });
    console.error(`check: repo ${repoRoot}`);
    console.error(`check: wiki ${wiki.ok ? wikiDir : `unavailable (${wiki.reason})`}`);
    console.error(`check: ${ctx.index.docs.size} docs, ${ctx.index.sections.size} sections`);
    process.exit(0);
  }

  if (!isAstryxRepo(repoRoot)) {
    for (const name of ['rules_for_paths', 'search', 'get_doc', 'pr_checklist', 'authoring_guide', 'refresh', 'explain_component_internals', 'estimate_change_scope', 'find_reference_pr', 'assess_issue_fit', 'translate_kr', 'simulate_review', 'validate_repro', 'inspect_a11y_tree']) {
      server.registerTool(name, { description: NOT_REPO, inputSchema: z.object({}).loose() }, async () => fail(NOT_REPO));
    }
  } else {
    // No network at startup: the client's MCP handshake must not wait on a clone. install.sh
    // pre-clones the wiki and the refresh tool clones or pulls it on demand.
    const wikiDir = resolveWikiDir();
    const wiki = wikiStatus(wikiDir);
    const ctx = await createContext({ repoRoot, wikiDir });
    if (!wiki.ok) setWikiWarning(ctx.index.warnings, `${wiki.reason}; call refresh to clone it`);
    for (const t of [rulesForPaths, search, getDoc, prChecklist, authoringGuide, refresh, explainComponentInternals, estimateChangeScope, findReferencePr, assessIssueFit, translateKr, simulateReview, validateRepro, inspectA11yTree]) t.register(server, ctx);
    console.error(`astryx-contrib: ${ctx.index.docs.size} docs, ${ctx.index.sections.size} sections from ${repoRoot}`);
  }

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
