const MAX_GRID_CELLS = 450000;

function loopArea(points) {
  let area = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    area += points[index].x * points[index + 1].y - points[index + 1].x * points[index].y;
  }
  return area / 2;
}

function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = points[first];
    const b = points[last];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const p = points[index];
      const distance = length < 1e-12
        ? Math.hypot(p.x - a.x, p.y - a.y)
        : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function simplifyLoop(points, tolerance) {
  const farthest = points.reduce((best, p, index) => (
    Math.hypot(p.x - points[0].x, p.y - points[0].y) > best.distance
      ? { index, distance: Math.hypot(p.x - points[0].x, p.y - points[0].y) }
      : best
  ), { index: 0, distance: -1 }).index;
  if (farthest === 0) return points;
  const first = simplify(points.slice(0, farthest + 1), tolerance);
  const second = simplify(points.slice(farthest), tolerance);
  return [...first, ...second.slice(1)];
}

function joinSegments(segments) {
  const key = ({ x, y }) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
  const nodes = new Map();
  segments.forEach((segment, index) => {
    for (const point of segment) {
      const nodeKey = key(point);
      if (!nodes.has(nodeKey)) nodes.set(nodeKey, []);
      nodes.get(nodeKey).push(index);
    }
  });
  const used = new Uint8Array(segments.length);
  const loops = [];
  for (let seed = 0; seed < segments.length; seed += 1) {
    if (used[seed]) continue;
    used[seed] = 1;
    const points = [segments[seed][0], segments[seed][1]];
    for (;;) {
      const tail = points[points.length - 1];
      const next = (nodes.get(key(tail)) ?? []).find((index) => !used[index]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segments[next];
      points.push(key(a) === key(tail) ? b : a);
    }
    loops.push(points);
  }
  return loops;
}

/**
 * Builds a region from a closed outline using a sampled signed-distance field
 * (positive inside). Inset and outset contours come from marching squares and
 * infill lines are clipped by sampling the field along each line.
 */
export function createPolygonRegion(outline, margin = 5) {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const bounds = {
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
  };
  const spanX = bounds.maxX - bounds.minX + margin * 2;
  const spanY = bounds.maxY - bounds.minY + margin * 2;
  const step = Math.max(0.05, Math.sqrt(spanX * spanY / MAX_GRID_CELLS));
  const nx = Math.ceil(spanX / step) + 1;
  const ny = Math.ceil(spanY / step) + 1;
  const x0 = bounds.minX - margin;
  const y0 = bounds.minY - margin;
  const edges = outline.map((p, index) => [p, outline[(index + 1) % outline.length]]);
  const field = new Float64Array(nx * ny);

  for (let j = 0; j < ny; j += 1) {
    const y = y0 + j * step;
    for (let i = 0; i < nx; i += 1) {
      const x = x0 + i * step;
      let best = Infinity;
      let inside = false;
      for (const [a, b] of edges) {
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey)));
        const dx = x - (a.x + ex * t);
        const dy = y - (a.y + ey * t);
        const squared = dx * dx + dy * dy;
        if (squared < best) best = squared;
        if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * ex / ey) inside = !inside;
      }
      field[j * nx + i] = inside ? Math.sqrt(best) : -Math.sqrt(best);
    }
  }

  const sample = (x, y) => {
    const fx = Math.max(0, Math.min(nx - 1.000001, (x - x0) / step));
    const fy = Math.max(0, Math.min(ny - 1.000001, (y - y0) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const base = j * nx + i;
    return (field[base] * (1 - tx) + field[base + 1] * tx) * (1 - ty)
      + (field[base + nx] * (1 - tx) + field[base + nx + 1] * tx) * ty;
  };

  const cache = new Map();
  const contour = (level) => {
    const segments = [];
    const crossing = (i, j, horizontal, a, b) => {
      const ratio = (0 - a) / (b - a);
      return horizontal
        ? { x: x0 + (i + ratio) * step, y: y0 + j * step }
        : { x: x0 + i * step, y: y0 + (j + ratio) * step };
    };
    for (let j = 0; j < ny - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        const bl = field[j * nx + i] - level;
        const br = field[j * nx + i + 1] - level;
        const tr = field[(j + 1) * nx + i + 1] - level;
        const tl = field[(j + 1) * nx + i] - level;
        const code = (bl > 0 ? 1 : 0) | (br > 0 ? 2 : 0) | (tr > 0 ? 4 : 0) | (tl > 0 ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const bottom = () => crossing(i, j, true, bl, br);
        const top = () => crossing(i, j + 1, true, tl, tr);
        const left = () => crossing(i, j, false, bl, tl);
        const right = () => crossing(i + 1, j, false, br, tr);
        const centerInside = (bl + br + tr + tl) > 0;
        switch (code) {
          case 1: case 14: segments.push([left(), bottom()]); break;
          case 2: case 13: segments.push([bottom(), right()]); break;
          case 3: case 12: segments.push([left(), right()]); break;
          case 4: case 11: segments.push([right(), top()]); break;
          case 6: case 9: segments.push([bottom(), top()]); break;
          case 7: case 8: segments.push([left(), top()]); break;
          case 5:
            if (centerInside) segments.push([left(), top()], [bottom(), right()]);
            else segments.push([left(), bottom()], [right(), top()]);
            break;
          default:
            if (centerInside) segments.push([left(), bottom()], [right(), top()]);
            else segments.push([left(), top()], [bottom(), right()]);
        }
      }
    }
    return joinSegments(segments)
      .map((points) => {
        const closed = Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < 1e-6;
        const loop = closed ? points : [...points, points[0]];
        const oriented = loopArea(loop) < 0 ? [...loop].reverse() : loop;
        return simplifyLoop(oriented, 0.004);
      })
      .filter((loop) => loop.length > 3);
  };

  return {
    bounds,
    step,
    /** Closed contours at `distance` mm inside (positive) or outside (negative) the outline. */
    loops(distance) {
      const key = Math.round(distance * 10000);
      if (!cache.has(key)) cache.set(key, contour(distance));
      return cache.get(key);
    },
    /** Pieces of the segment start→end that lie at least `distance` mm inside the outline. */
    clip(distance, start, end) {
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length < 1e-9) return [];
      const count = Math.max(1, Math.ceil(length / (step * 0.5)));
      const at = (t) => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
      const value = (t) => { const p = at(t); return sample(p.x, p.y) - distance; };
      const pieces = [];
      let previous = value(0);
      let open = previous > 0 ? 0 : null;
      for (let index = 1; index <= count; index += 1) {
        const t = index / count;
        const current = value(t);
        if ((previous > 0) !== (current > 0)) {
          const crossingT = (index - 1) / count + (previous / (previous - current)) / count;
          if (previous > 0) {
            pieces.push([open, crossingT]);
            open = null;
          } else {
            open = crossingT;
          }
        }
        previous = current;
      }
      if (open !== null) pieces.push([open, 1]);
      return pieces
        .filter(([from, to]) => (to - from) * length > 1e-6)
        .map(([from, to]) => [at(from), at(to)]);
    },
  };
}
