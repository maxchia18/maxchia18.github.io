// solver.js — Zip puzzle solver (Hamiltonian path through ordered waypoints).
//
// A path must start at "1", visit every numbered cell in ascending order,
// fill every cell exactly once, and never cross a wall.
//
// Exposes `solveZip(rows, cols, numbers, walls)`:
//   numbers: Map<number, [r, c]>  (1-indexed waypoint -> cell)
//   walls:   Set<string>          (canonical "r1,c1|r2,c2" edge keys)
//   returns: Array<[r, c]> path, or null if unsolvable.

// Canonical key for an undirected edge between two adjacent cells.
function edgeKey(r1, c1, r2, c2) {
  if (r1 > r2 || (r1 === r2 && c1 > c2)) {
    [r1, c1, r2, c2] = [r2, c2, r1, c1];
  }
  return `${r1},${c1}|${r2},${c2}`;
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function solveZip(rows, cols, numbers, walls) {
  const total = rows * cols;
  const maxNum = Math.max(...numbers.keys());

  // Ordered waypoint positions, index 0 = "1".
  const waypoints = [];
  for (let i = 1; i <= maxNum; i++) {
    const pos = numbers.get(i);
    if (!pos) return null; // missing a waypoint in the sequence
    waypoints.push(pos);
  }

  // Reverse lookup: "r,c" -> waypoint index.
  const posToWaypoint = new Map();
  waypoints.forEach(([r, c], idx) => posToWaypoint.set(`${r},${c}`, idx));

  const inBounds = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const visited = new Uint8Array(total);
  const idx = (r, c) => r * cols + c;

  // Connectivity prune: every unvisited cell must stay reachable from `pos`.
  function reachableCoversAll(sr, sc, remaining) {
    if (remaining === 0) return true;
    const seen = new Uint8Array(total);
    const stack = [[sr, sc]];
    seen[idx(sr, sc)] = 1;
    let count = 0;
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const ni = idx(nr, nc);
        if (visited[ni] || seen[ni]) continue;
        if (walls.has(edgeKey(r, c, nr, nc))) continue;
        seen[ni] = 1;
        count++;
        stack.push([nr, nc]);
      }
    }
    return count >= remaining;
  }

  const start = waypoints[0];
  const path = [start];
  visited[idx(start[0], start[1])] = 1;

  function dfs(r, c, nextWp) {
    if (path.length === total) return true;

    const remaining = total - path.length;
    if (!reachableCoversAll(r, c, remaining)) return false;

    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const ni = idx(nr, nc);
      if (visited[ni]) continue;
      if (walls.has(edgeKey(r, c, nr, nc))) continue;

      const wp = posToWaypoint.get(`${nr},${nc}`);
      if (wp !== undefined && wp !== nextWp) continue; // wrong waypoint order

      visited[ni] = 1;
      path.push([nr, nc]);
      const advanced = wp === nextWp ? nextWp + 1 : nextWp;
      if (dfs(nr, nc, advanced)) return true;
      path.pop();
      visited[ni] = 0;
    }
    return false;
  }

  return dfs(start[0], start[1], 1) ? path : null;
}

// Export for both browser (window) and module contexts.
if (typeof window !== 'undefined') {
  window.solveZip = solveZip;
  window.edgeKey = edgeKey;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { solveZip, edgeKey };
}
