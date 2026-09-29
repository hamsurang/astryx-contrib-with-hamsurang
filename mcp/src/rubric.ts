export const RUBRIC_SECTION_ID = 'wiki:Component-Audit-Rubric#reviewing-a-change';

export interface RubricRow {
  touched: string;
  checks: string;
  firedBy: string[];
  /** Whether any filename heuristic can fire this row at all; false rows need a human read of the diff. */
  detectable: boolean;
}

function cells(line: string): string[] | null {
  const s = line.replace(/^\s*>?\s*/, '').trim();
  if (!s.startsWith('|')) return null;
  return s.split('|').slice(1, -1).map((c) => c.trim());
}

export function parseTriggerTable(sectionBody: string): { touched: string; checks: string }[] {
  const lines = sectionBody.split(/\r?\n/);
  const start = lines.findIndex((l) => cells(l)?.[0]?.startsWith('If the diff touches'));
  if (start === -1) return [];
  const rows: { touched: string; checks: string }[] = [];
  for (const line of lines.slice(start + 1)) {
    const c = cells(line);
    if (!c) break;
    if (c.every((x) => /^-+$/.test(x))) continue;
    if (c.length < 2) continue;
    rows.push({ touched: c[0], checks: c[1] });
  }
  return rows;
}

const HEURISTICS: { test: RegExp; touchedIncludes: string }[] = [
  { test: /\.stylex\.ts$/, touchedIncludes: 'stylex' },
  { test: /\.doc\.mjs$/, touchedIncludes: 'doc.mjs' },
  { test: /\.stories\.tsx?$/, touchedIncludes: 'stories' },
  { test: /^packages\/[^/]+\/src\/index\.tsx?$/, touchedIncludes: 'published export' },
  { test: /^packages\/[^/]+\/package\.json$/, touchedIncludes: 'published export' },
  { test: /^packages\/[^/]+\/src\/(?!.*\.(?:test|spec|stories)\.tsx$).+\.tsx$/, touchedIncludes: 'rendered output' },
];

export function fireRows(rows: { touched: string; checks: string }[], changedPaths: string[]): RubricRow[] {
  return rows.map((row) => {
    const touched = row.touched.toLowerCase();
    const applicable = HEURISTICS.filter((h) => touched.includes(h.touchedIncludes.toLowerCase()));
    const firedBy = changedPaths.filter((p) => applicable.some((h) => h.test.test(p)));
    return { ...row, firedBy, detectable: applicable.length > 0 };
  });
}
