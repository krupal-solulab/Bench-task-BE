export interface BlockingEdge {
  source: string;
  target: string;
}

/**
 * Whether adding a new `proposedSource -> proposedTarget` blocking edge to the existing set of
 * blocking edges would create a cycle - true exactly when `proposedTarget` can already reach
 * `proposedSource` by following existing edges (adding the proposed edge would then close that
 * loop). Pure and side-effect-free (a plain BFS over an adjacency list built from `existingEdges`)
 * so it's exhaustively unit-testable without a database. Only ever called with edges whose
 * LinkTypeDefinition.isBlocking is true - non-blocking types (Relates To, Duplicates, ...) never
 * participate in this check.
 */
export function wouldCreateCycle(
  existingEdges: BlockingEdge[],
  proposedSource: string,
  proposedTarget: string,
): boolean {
  if (proposedSource === proposedTarget) return true;

  const adjacency = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const list = adjacency.get(edge.source);
    if (list) list.push(edge.target);
    else adjacency.set(edge.source, [edge.target]);
  }

  const visited = new Set<string>([proposedTarget]);
  const queue: string[] = [proposedTarget];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === proposedSource) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Returns the actual cycle path (`proposedSource -> ... -> proposedTarget -> proposedSource`) for
 * a clear error message, or null if adding the edge wouldn't create one. A second BFS rather than
 * folding into `wouldCreateCycle` - that function is the hot path (called on every link creation),
 * this one only runs once a cycle is already confirmed, to build a human-readable path.
 */
export function findCyclePath(
  existingEdges: BlockingEdge[],
  proposedSource: string,
  proposedTarget: string,
): string[] | null {
  if (!wouldCreateCycle(existingEdges, proposedSource, proposedTarget)) return null;
  if (proposedSource === proposedTarget) return [proposedSource, proposedTarget];

  const adjacency = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const list = adjacency.get(edge.source);
    if (list) list.push(edge.target);
    else adjacency.set(edge.source, [edge.target]);
  }

  const cameFrom = new Map<string, string>();
  const visited = new Set<string>([proposedTarget]);
  const queue: string[] = [proposedTarget];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === proposedSource) {
      // Reconstruct the existing proposedTarget -> ... -> proposedSource path in forward (actual
      // edge-direction) order by walking predecessors backward from proposedSource, then
      // unshifting each one - NOT pushing, which would produce the path reversed.
      const forward = [proposedSource];
      let node = proposedSource;
      while (node !== proposedTarget) {
        node = cameFrom.get(node)!;
        forward.unshift(node);
      }
      // Full cycle in edge-traversal order: the new proposedSource -> proposedTarget edge, then
      // the existing forward path back to proposedSource (forward already starts at
      // proposedTarget and ends at proposedSource, so prepending proposedSource closes the loop).
      return [proposedSource, ...forward];
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        cameFrom.set(next, current);
        queue.push(next);
      }
    }
  }
  return null;
}
