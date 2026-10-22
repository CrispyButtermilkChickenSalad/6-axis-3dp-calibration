export const SAMPLE_ORIENTATIONS = ["flat", "side", "upright"];

const EPSILON = 1e-9;

function point(x, y) {
  return { x, y };
}

/** Intervals of the closed outline along one axis at a fixed coordinate on the other (even-odd rule). */
function scanIntervals(outline, fixedAxis, position) {
  const other = fixedAxis === "x" ? "y" : "x";
  const crossings = [];
  outline.forEach((a, index) => {
    const b = outline[(index + 1) % outline.length];
    if ((a[fixedAxis] <= position) !== (b[fixedAxis] <= position)) {
      const t = (position - a[fixedAxis]) / (b[fixedAxis] - a[fixedAxis]);
      crossings.push(a[other] + t * (b[other] - a[other]));
    }
  });
  crossings.sort((first, second) => first - second);
  const intervals = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    if (crossings[index + 1] - crossings[index] > 1e-6) intervals.push([crossings[index], crossings[index + 1]]);
  }
  return intervals;
}

/**
 * A region made of disjoint axis-aligned rectangles, exposing the same
 * `bounds`, `loops` and `clip` interface as the polygon region.
 */
export function createRectangleRegion(rectangles) {
  const bounds = {
    minX: Math.min(...rectangles.map((r) => r.minX)),
    maxX: Math.max(...rectangles.map((r) => r.maxX)),
    minY: Math.min(...rectangles.map((r) => r.minY)),
    maxY: Math.max(...rectangles.map((r) => r.maxY)),
  };
  const inset = (distance) => rectangles
    .map((r) => ({ minX: r.minX + distance, maxX: r.maxX - distance, minY: r.minY + distance, maxY: r.maxY - distance }))
    .filter((r) => r.maxX - r.minX > EPSILON && r.maxY - r.minY > EPSILON);
  return {
    bounds,
    loops(distance) {
      return inset(distance).map((r) => [
        point(r.minX, r.minY), point(r.maxX, r.minY), point(r.maxX, r.maxY), point(r.minX, r.maxY), point(r.minX, r.minY),
      ]);
    },
    clip(distance, start, end) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const pieces = [];
      for (const r of inset(distance)) {
        let minT = 0;
        let maxT = 1;
        let hit = true;
        for (const [position, delta, low, high] of [[start.x, dx, r.minX, r.maxX], [start.y, dy, r.minY, r.maxY]]) {
          if (Math.abs(delta) <= EPSILON) {
            if (position < low || position > high) hit = false;
            continue;
          }
          const first = (low - position) / delta;
          const second = (high - position) / delta;
          minT = Math.max(minT, Math.min(first, second));
          maxT = Math.min(maxT, Math.max(first, second));
        }
        if (!hit || maxT - minT <= EPSILON) continue;
        pieces.push([minT, maxT]);
      }
      return pieces
        .sort((first, second) => first[0] - second[0])
        .map(([from, to]) => [point(start.x + dx * from, start.y + dy * from), point(start.x + dx * to, start.y + dy * to)]);
    },
  };
}

/**
 * Footprint, build height and slicing rule for a mechanical specimen printed
 * flat (thickness along Z), on its side (width along Z) or upright (length along Z).
 */
export function orientedSpecimen(specimen, orientation) {
  if (!SAMPLE_ORIENTATIONS.includes(orientation)) throw new Error("Choose flat, side or upright sample orientation.");
  const xs = specimen.outline.map((p) => p.x);
  const ys = specimen.outline.map((p) => p.y);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const length = bounds.maxX - bounds.minX;
  const width = bounds.maxY - bounds.minY;
  const thickness = specimen.thickness;
  if (orientation === "flat") {
    return { orientation, width: length, depth: width, height: thickness, minFeature: specimen.minFeature, rectangles: null };
  }
  const side = orientation === "side";
  return {
    orientation,
    width: side ? length : width,
    depth: thickness,
    height: side ? width : length,
    minFeature: Math.min(thickness, specimen.minFeature),
    rectangles(zMid) {
      const intervals = side
        ? scanIntervals(specimen.outline, "y", bounds.minY + zMid)
        : scanIntervals(specimen.outline, "x", bounds.minX + zMid);
      return intervals.map(([from, to]) => ({ minX: from, maxX: to, minY: -thickness / 2, maxY: thickness / 2 }));
    },
  };
}

/**
 * Row-major grid of identical footprints, each row centred on the group.
 * Returns the placements and the group's overall size.
 */
export function arrangeGrid(count, columns, footprintWidth, footprintDepth, spacing) {
  const rows = Math.ceil(count / columns);
  const groupWidth = columns * footprintWidth + (columns - 1) * spacing;
  const groupDepth = rows * footprintDepth + (rows - 1) * spacing;
  const placements = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, count - row * columns);
    const rowWidth = inRow * footprintWidth + (inRow - 1) * spacing;
    const column = index - row * columns;
    placements.push({
      x: -rowWidth / 2 + footprintWidth / 2 + column * (footprintWidth + spacing),
      y: -groupDepth / 2 + footprintDepth / 2 + row * (footprintDepth + spacing),
    });
  }
  return { placements, groupWidth, groupDepth, columns, rows };
}
