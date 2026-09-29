import MiniSearch from 'minisearch';
import { dirname } from 'node:path';
import { dirContains, matchesAppliesTo } from './match.js';
import { loadRepoDocs } from './sources/repo.js';
import { loadScores, loadScoresMeta, loadWikiDocs, wikiStatus, type ComponentScore, type ScoresMeta } from './sources/wiki.js';
import type { Doc, Section, Source } from './types.js';

export interface SearchHit {
  sectionId: string;
  docId: string;
  title: string;
  heading: string;
  snippet: string;
  score: number;
  authority?: string;
}

export type MatchVia = 'applies_to' | 'spec-dir' | 'members' | 'families' | 'components';

export interface PathMatch {
  doc: Doc;
  matchedBy: string[];
  via: MatchVia;
}

export interface PathMatches {
  matches: PathMatch[];
  /** Ids of draft records that matched but were left out because includeDraft was false. */
  suppressedDrafts: string[];
}

interface Row {
  id: string;
  docId: string;
  source: Source;
  title: string;
  heading: string;
  body: string;
}

export class KnowledgeIndex {
  readonly docs = new Map<string, Doc>();
  readonly sections = new Map<string, { docId: string; section: Section }>();
  readonly scores: Map<string, ComponentScore>;
  readonly scoresMeta?: ScoresMeta;
  readonly warnings: string[];
  private readonly mini: MiniSearch<Row>;

  private constructor(docs: Doc[], scores: Map<string, ComponentScore>, scoresMeta: ScoresMeta | undefined, warnings: string[]) {
    this.scores = scores;
    this.scoresMeta = scoresMeta;
    this.warnings = warnings;
    this.mini = new MiniSearch<Row>({
      fields: ['title', 'heading', 'body'],
      storeFields: ['docId', 'source', 'title', 'heading'],
      searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2, heading: 1.5 } },
    });
    const rows: Row[] = [];
    for (const doc of docs) {
      this.docs.set(doc.id, doc);
      for (const s of doc.sections) {
        this.sections.set(s.id, { docId: doc.id, section: s });
        rows.push({ id: s.id, docId: doc.id, source: doc.source, title: doc.title, heading: s.heading, body: s.body });
      }
    }
    this.mini.addAll(rows);
  }

  static async build(opts: { repoRoot: string; wikiDir?: string }): Promise<KnowledgeIndex> {
    const warnings: string[] = [];
    const docs = await loadRepoDocs(opts.repoRoot);
    let scores = new Map<string, ComponentScore>();
    let scoresMeta: ScoresMeta | undefined;
    const wiki = wikiStatus(opts.wikiDir);
    if (wiki.ok) {
      docs.push(...(await loadWikiDocs(wiki.dir)));
      scores = await loadScores(wiki.dir);
      scoresMeta = await loadScoresMeta(wiki.dir);
    } else {
      warnings.push(`wiki unavailable: ${wiki.reason}`);
    }
    return new KnowledgeIndex(docs, scores, scoresMeta, warnings);
  }

  get(id: string): Doc | undefined {
    return this.docs.get(id);
  }

  getSection(sectionId: string): Section | undefined {
    return this.sections.get(sectionId)?.section;
  }

  search(query: string, { limit = 10, source }: { limit?: number; source?: Source } = {}): SearchHit[] {
    const results = this.mini.search(query, source ? { filter: (r) => r.source === source } : {});
    return results.slice(0, limit).map((r) => {
      const sec = this.sections.get(r.id)!.section;
      return {
        sectionId: r.id,
        docId: r.docId as string,
        title: r.title as string,
        heading: r.heading as string,
        snippet: snippet(sec.body, query),
        score: Math.round(r.score * 100) / 100,
        authority: this.docs.get(r.docId as string)?.frontmatter?.authority,
      };
    });
  }

  recordsForPaths(paths: string[], { includeDraft = false }: { includeDraft?: boolean } = {}): PathMatches {
    const out = new Map<string, PathMatch>();
    const suppressedDrafts = new Set<string>();
    const add = (doc: Doc, matchedBy: string[], via: MatchVia) => {
      if (!matchedBy.length || out.has(doc.id)) return;
      if (doc.frontmatter?.authority === 'draft' && !includeDraft) {
        suppressedDrafts.add(doc.id);
        return;
      }
      out.set(doc.id, { doc, matchedBy, via });
    };

    for (const doc of this.docs.values()) {
      const fm = doc.frontmatter;
      if (!fm || doc.source !== 'repo') continue;
      if (fm.applies_to.length) {
        add(doc, paths.filter((p) => fm.applies_to.some((pat) => matchesAppliesTo(pat, p))), 'applies_to');
      }
      if (fm.kind === 'component' || fm.kind === 'module') {
        const dir = dirname(doc.path);
        add(doc, paths.filter((p) => dirContains(dir, p)), 'spec-dir');
      }
    }

    const matchedIds = () => new Set(out.keys());
    for (const doc of this.docs.values()) {
      const fm = doc.frontmatter;
      if (fm?.kind !== 'family') continue;
      const hit = fm.members.filter((m) => matchedIds().has(m));
      add(doc, hit.flatMap((m) => out.get(m)!.matchedBy), 'members');
    }
    for (const doc of this.docs.values()) {
      const fm = doc.frontmatter;
      if (fm?.kind !== 'design') continue;
      const viaFam = fm.families.filter((f) => matchedIds().has(f));
      if (viaFam.length) {
        add(doc, viaFam.flatMap((f) => out.get(f)!.matchedBy), 'families');
        continue;
      }
      const viaComp = fm.components.filter((c) => matchedIds().has(c));
      add(doc, viaComp.flatMap((c) => out.get(c)!.matchedBy), 'components');
    }

    return {
      matches: [...out.values()].map((m) => ({ ...m, matchedBy: [...new Set(m.matchedBy)] })),
      suppressedDrafts: [...suppressedDrafts],
    };
  }

  suggest(id: string, n = 3): string[] {
    const tokens = id.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    return [...this.docs.keys()]
      .map((k) => ({ k, hits: tokens.filter((t) => k.toLowerCase().includes(t)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.k.length - b.k.length)
      .slice(0, n)
      .map((x) => x.k);
  }
}

export function snippet(body: string, query: string, width = 240): string {
  const lower = body.toLowerCase();
  const term = query.toLowerCase().split(/\s+/).find((t) => t && lower.includes(t));
  const at = term ? lower.indexOf(term) : 0;
  const start = Math.max(0, at - Math.floor(width / 2));
  const s = body.slice(start, start + width).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + s + (start + width < body.length ? '…' : '');
}

export function summaryOf(doc: Doc, max = 400): string {
  const sec = doc.sections.find((s) => s.body.trim());
  if (!sec) return '';
  const para = sec.body.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  return para.length > max ? `${para.slice(0, max)}…` : para;
}
