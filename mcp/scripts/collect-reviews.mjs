#!/usr/bin/env node
// Refreshes data/reviews/robohands.jsonl: every review the maintainer's bot left on facebook/astryx,
// one JSON line per review: { pr, at, state, commit, body, files }.
//
//   node scripts/collect-reviews.mjs [--limit 400] [--backfill-files] [--upstream facebook/astryx]
//
// Incremental: PRs already in the file are skipped unless --backfill-files (which only fills
// missing `files`). The bot signed "[Reviewed by Robohands]" until 2026-09; now it reviews as
// astracat-bot[bot], so both are matched.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : def; };
const LIMIT = Number(opt('limit', '400'));
const UPSTREAM = opt('upstream', 'facebook/astryx');
const BACKFILL = args.includes('--backfill-files');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'reviews', 'robohands.jsonl');

const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, LC_ALL: 'C' } });
const ghJson = (a) => JSON.parse(gh(a));
const isBot = (r) => /^astracat-bot/.test(r.user?.login ?? '') || /Reviewed by Robohands/.test(r.body ?? '');

const rows = existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const known = new Set(rows.map((r) => r.pr));
const filesOf = new Map();
const prFiles = (n) => {
  if (!filesOf.has(n)) filesOf.set(n, ghJson(['api', '--paginate', `repos/${UPSTREAM}/pulls/${n}/files?per_page=100`]).map((f) => f.filename));
  return filesOf.get(n);
};

let added = 0;
const prs = ghJson(['pr', 'list', '--repo', UPSTREAM, '--state', 'all', '--limit', String(LIMIT), '--json', 'number']);
for (const { number } of prs) {
  if (known.has(number)) continue;
  let reviews;
  try { reviews = ghJson(['api', '--paginate', `repos/${UPSTREAM}/pulls/${number}/reviews`]); } catch { continue; }
  const bot = reviews.filter(isBot);
  if (!bot.length) continue;
  const files = prFiles(number);
  for (const r of bot) {
    rows.push({ pr: number, at: r.submitted_at, state: r.state, commit: (r.commit_id ?? '').slice(0, 7), body: r.body, files });
    added++;
  }
  process.stderr.write(`pr ${number}: ${bot.length} bot review(s)\n`);
}

let filled = 0;
if (BACKFILL) {
  for (const r of rows) {
    if (r.files) continue;
    try { r.files = prFiles(r.pr); filled++; } catch (e) { process.stderr.write(`files for ${r.pr} failed: ${e.message.split('\n')[0]}\n`); }
  }
}

rows.sort((a, b) => b.at.localeCompare(a.at));
writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const dates = rows.map((r) => r.at.slice(0, 10)).sort();
console.log(`reviews: ${rows.length} (+${added}) | PRs: ${new Set(rows.map((r) => r.pr)).size} | files backfilled: ${filled} | range: ${dates[0]} → ${dates[dates.length - 1]}`);
console.log('Read the new CHANGES_REQUESTED bodies and add rules to data/review-rules.yml with PR numbers.');
