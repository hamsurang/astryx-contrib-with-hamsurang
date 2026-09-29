import picomatch from 'picomatch';

export const PATH_WIKI_MAP: { glob: string; pages: string[] }[] = [
  { glob: 'packages/core/src/**', pages: ['Component-Authoring-Guide', 'API-Conventions', 'Design-Conventions', 'Accessibility-Checklist', 'Required-Props-Pattern'] },
  { glob: 'packages/lab/src/**', pages: ['Component-Lifecycle', 'Component-Authoring-Guide'] },
  { glob: 'packages/themes/**', pages: ['Theming-Infrastructure'] },
  { glob: 'packages/charts/**', pages: ['Chart-System-Architecture'] },
  { glob: 'apps/docsite/**', pages: ['Docsite-Architecture'] },
  { glob: 'docs/specs/**', pages: ['Component-Specification-Protocol'] },
  { glob: 'internal/vibe-tests/**', pages: ['Vibe-Tests', 'Designing-Vibe-Tests'] },
  { glob: '.changeset/**', pages: ['Release-Process'] },
];

export const ALWAYS_WIKI = ['wiki:Contributing', 'wiki:Astryx-Philosophy'];

export function wikiPagesForPath(path: string): string[] {
  const out = new Set<string>();
  for (const { glob, pages } of PATH_WIKI_MAP) {
    if (picomatch(glob, { dot: true })(path)) for (const p of pages) out.add(`wiki:${p}`);
  }
  return [...out];
}
