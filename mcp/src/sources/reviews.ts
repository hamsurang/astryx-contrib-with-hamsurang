import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';
import { parse } from 'yaml';
import { diffRole, targetDir, type DiffRole } from '../tools/findReferencePr.js';

/** `mcp/data/` — rules and the review corpus; `ASTRYX_REVIEW_DATA` overrides. */
export function resolveDataDir(): string {
  return process.env.ASTRYX_REVIEW_DATA ?? fileURLToPath(new URL('../../data/', import.meta.url));
}

export interface Rule {
  id: string;
  axis: string;
  trigger: { always?: boolean; paths?: string[]; roles?: DiffRole[]; keywords?: string[]; missing?: 'changeset' | 'test' };
  sentence: string;
  check: string;
  examples: number[];
}

export function loadRules(dir = resolveDataDir()): Rule[] {
  const file = join(dir, 'review-rules.yml');
  if (!existsSync(file)) throw new Error(`review rules not found: ${file}`);
  const raw = parse(readFileSync(file, 'utf8')) as { rules?: Rule[] };
  return (raw.rules ?? []).map((r) => ({ ...r, examples: (r.examples ?? []).map(Number) }));
}

export interface ReviewRecord { pr: number; at: string; state: string; commit: string; body: string; files?: string[] }

export function loadCorpus(dir = resolveDataDir()): ReviewRecord[] {
  const file = join(dir, 'reviews', 'robohands.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as ReviewRecord);
}

export interface FiredRule { id: string; axis: string; firedBy: string[]; sentence: string; check: string; examples: number[] }

export interface DiffFacts {
  files: string[];
  /** lower-cased text: added lines plus the claim */
  text: string;
  touchesPackages: boolean;
}

export function fireRules(rules: Rule[], facts: DiffFacts): FiredRule[] {
  const roles = new Map(facts.files.map((f) => [f, diffRole(f)] as const));
  const has = (role: DiffRole) => [...roles.values()].includes(role);
  const out: FiredRule[] = [];
  for (const r of rules) {
    const by: string[] = [];
    const t = r.trigger;
    if (t.always) by.push('always');
    for (const g of t.paths ?? []) {
      const m = picomatch(g, { dot: true });
      for (const f of facts.files) if (m(f)) by.push(f);
    }
    for (const role of t.roles ?? []) for (const [f, fr] of roles) if (fr === role) by.push(f);
    for (const k of t.keywords ?? []) if (facts.text.includes(k.toLowerCase())) by.push(`"${k}"`);
    const missing = t.missing === 'test' ? !has('test') && !has('a11y') : t.missing === 'changeset' ? !has('changeset') : false;
    if (t.missing && facts.touchesPackages && missing) by.push(`no ${t.missing} in diff`);
    if (by.length) out.push({ id: r.id, axis: r.axis, firedBy: [...new Set(by)], sentence: r.sentence, check: r.check, examples: r.examples });
  }
  return out;
}

export interface PastReview { pr: number; state: string; at: string; overlap: string[]; excerpt: string }

/** Corpus reviews on PRs that touched the same component directories, most overlap then newest first. */
export function relatedReviews(corpus: ReviewRecord[], files: string[], limit = 5): PastReview[] {
  const dirs = new Set(files.map(targetDir));
  const scored: PastReview[] = [];
  for (const r of corpus) {
    if (!r.files?.length) continue;
    const overlap = [...new Set(r.files.map(targetDir))].filter((d) => dirs.has(d));
    if (!overlap.length) continue;
    scored.push({ pr: r.pr, state: r.state, at: r.at, overlap, excerpt: r.body.replace(/\s+/g, ' ').trim().slice(0, 400) });
  }
  return scored.sort((a, b) => b.overlap.length - a.overlap.length || b.at.localeCompare(a.at)).slice(0, limit);
}
