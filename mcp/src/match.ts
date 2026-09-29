import picomatch from 'picomatch';

export function normalizePath(p: string, repoRoot: string): string {
  let s = p.replace(/\\/g, '/');
  const root = repoRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (s.startsWith(`${root}/`)) s = s.slice(root.length + 1);
  return s.replace(/^\.\//, '');
}

const GLOB_CHARS = /[*?[\]{}]/;

export function dirContains(dir: string, path: string): boolean {
  const d = dir.endsWith('/') ? dir : `${dir}/`;
  return path.startsWith(d);
}

export function matchesAppliesTo(pattern: string, path: string): boolean {
  const pat = pattern.replace(/^\.\//, '');
  if (GLOB_CHARS.test(pat)) return picomatch(pat, { dot: true })(path);
  return path === pat || dirContains(pat, path);
}
