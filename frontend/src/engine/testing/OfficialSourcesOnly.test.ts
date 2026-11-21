/**
 * User rule 2026-11-21: no news-based facts in the app — official sources only. No source file the app ships (frontend/src
 * outside the tests) and no backend module outside the data-freshness updater (which harvests and tiers candidate claims for
 * review) may cite a news outlet. A line marked `retired-news-marker` names an old citation that start-up replaces.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const NEWS = /indianexpress|indian express|hindustantimes|hindustan times|timesofindia|times of india|punemirror|pune mirror|punekarnews|punekar news|themetrorailguy|economictimes|thehindu\.com|as reported by/i;
const ROOT = join(__dirname, '..', '..', '..', '..');

function walk(dir: string, skip: (p: string) => boolean, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (skip(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, skip, out);
    else if (/\.(ts|tsx|json|py)$/.test(n)) out.push(p);
  }
  return out;
}
const hits = (files: string[]) => files.flatMap(f => readFileSync(f, 'utf8').split('\n')
  .map((l, i) => (NEWS.test(l) && !l.includes('retired-news-marker') ? `${relative(ROOT, f)}:${i + 1}: ${l.trim().slice(0, 120)}` : null)).filter((x): x is string => x !== null));

describe('official sources only (no news citations in-app)', () => {
  it('frontend/src (excluding tests) cites no news outlet', () => {
    const files = walk(join(ROOT, 'frontend', 'src'), p => /[\\/](testing|node_modules)$/.test(p) || /\.test\.tsx?$/.test(p));
    expect(files.length).toBeGreaterThan(50);
    expect(hits(files)).toEqual([]);
  });
  it('backend (excluding the updater, tests and data) cites no news outlet', () => {
    const files = walk(join(ROOT, 'backend'), p => /[\\/](updater|tests|data|node_modules|__pycache__|\.venv|venv)$/.test(p));
    expect(files.length).toBeGreaterThan(20);
    expect(hits(files)).toEqual([]);
  });
});
