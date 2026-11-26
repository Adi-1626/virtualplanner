/** Strongly connected components of a directed node graph (p16; moved out of AreaDemand.ts to avoid an import cycle). */

/**
 * The nodes of the largest strongly connected component of a directed graph (every node reaches every other), or null
 * when that component holds under half of the nodes (e.g. a one-way corridor), where "the main network" is not defined.
 * p16: a building whose nearest node sits on a small fragment (a one-way loop, a mapped piece of an internal lane that
 * meets the rest only through unmapped ways) is reached in reality over unmapped access; its trips load onto the main
 * network instead of being left out as "no drivable way".
 */
export function mainComponent(adj: ReadonlyMap<string, string[]>): Set<string> | null {
  const comp = strongComponents(adj);
  const size = new Map<number, number>();
  comp.forEach(c => size.set(c, (size.get(c) ?? 0) + 1));
  let best = -1, bn = 0;
  size.forEach((n, c) => { if (n > bn) { bn = n; best = c; } });
  if (best < 0 || bn * 2 < comp.size) return null;
  const out = new Set<string>();
  comp.forEach((c, id) => { if (c === best) out.add(id); });
  return out;
}

/**
 * p16 fix 3: which nodes the main network reaches (`fromMain`) and which reach it (`toMain`). A trip leaves its origin
 * node only if that node reaches the main network, and arrives only if the main network reaches it; a node joined one way
 * (e.g. a one-way street cut by the area's edge) still serves the trips of that direction at its own position.
 * Null when there is no main network.
 */
export function mainReach(adj: ReadonlyMap<string, string[]>, main: ReadonlySet<string> | null): { fromMain: Set<string>; toMain: Set<string> } | null {
  if (!main) return null;
  const rev = new Map<string, string[]>();
  adj.forEach((to, from) => { for (const t of to) (rev.get(t) ?? rev.set(t, []).get(t)!).push(from); });
  const flood = (g: ReadonlyMap<string, string[]>) => {
    const seen = new Set<string>(main), q = [...main];
    while (q.length) { const v = q.pop()!; for (const w of g.get(v) ?? []) if (!seen.has(w)) { seen.add(w); q.push(w); } }
    return seen;
  };
  return { fromMain: flood(adj), toMain: flood(rev) };
}

/** Tarjan's strongly connected components (iterative): node -> component id. */
export function strongComponents(adj: ReadonlyMap<string, string[]>): Map<string, number> {
  const index = new Map<string, number>(), low = new Map<string, number>(), comp = new Map<string, number>();
  const onStack = new Set<string>(), stack: string[] = [];
  let next = 0, comps = 0;
  const nodes = new Set<string>([...adj.keys(), ...[...adj.values()].flat()]);
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: { v: string; i: number }[] = [{ v: root, i: 0 }];
    index.set(root, next); low.set(root, next); next++; stack.push(root); onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1];
      const out = adj.get(top.v) ?? [];
      if (top.i < out.length) {
        const w = out[top.i++];
        if (!index.has(w)) { index.set(w, next); low.set(w, next); next++; stack.push(w); onStack.add(w); work.push({ v: w, i: 0 }); }
        else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) { const p = work[work.length - 1].v; low.set(p, Math.min(low.get(p)!, low.get(top.v)!)); }
      if (low.get(top.v) === index.get(top.v)) {
        let w: string;
        do { w = stack.pop()!; onStack.delete(w); comp.set(w, comps); } while (w !== top.v);
        comps++;
      }
    }
  }
  return comp;
}
