const EPSILON = 1e-8;
const MAX_LAYERS = 2000;

import { createPolygonRegion } from "./region.mjs";
import { mechanicalSpecimen } from "./mechanical.mjs";
import { arrangeGrid, createRectangleRegion, orientedSpecimen } from "./orientation.mjs";

export function minimumLayerHeight(tipDiameter, angleDegrees) {
  const tip = finite(tipDiameter, "Nozzle tip diameter");
  const angle = finite(angleDegrees, "Nozzle tilt angle");
  if (tip <= 0 || Math.abs(angle) >= 90) throw new Error("Nozzle tip must be positive and tilt must be between -90° and +90°.");
  return tip * 0.5 * Math.sin(Math.abs(angle) * Math.PI / 180);
}

function finite(value, name) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
    throw new Error(`${name} must be a finite number.`);
  }
  return Number(value);
}

function pathSpacing(width, height) {
  return width - height * (1 - Math.PI / 4);
}

function ranged(value, name, min, max) {
  const number = finite(value, name);
  if (number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return number;
}

function format(value, digits = 3) {
  return Number(value.toFixed(digits)).toString();
}

function point(x, y) {
  return { x, y };
}

function closePath(points) {
  return [...points, point(points[0].x, points[0].y)];
}

function circlePath(radius, segments = 64) {
  const points = Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments;
    return point(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
  return closePath(points);
}

function rectanglePath(width, depth, inset) {
  const halfX = width / 2 - inset;
  const halfY = depth / 2 - inset;
  if (halfX <= 0 || halfY <= 0) return [];
  return closePath([point(-halfX, -halfY), point(halfX, -halfY), point(halfX, halfY), point(-halfX, halfY)]);
}

function connectScanlines(paths) {
  if (paths.length < 2) return paths;
  const points = [];
  for (let index = 0; index < paths.length; index += 1) {
    const [start, end] = index % 2 === 0 ? paths[index] : [...paths[index]].reverse();
    if (!points.length) points.push(start);
    else if (Math.hypot(points.at(-1).x - start.x, points.at(-1).y - start.y) > EPSILON) points.push(start);
    points.push(end);
  }
  return [points];
}

function rectangleInfill(width, depth, inset, angleDegrees, spacing, snake = false, phase = 0) {
  const halfX = width / 2 - inset;
  const halfY = depth / 2 - inset;
  if (halfX <= 0 || halfY <= 0) return [];
  const angle = angleDegrees * Math.PI / 180;
  const direction = point(Math.cos(angle), Math.sin(angle));
  const normal = point(-direction.y, direction.x);
  const corners = [point(-halfX, -halfY), point(halfX, -halfY), point(halfX, halfY), point(-halfX, halfY)];
  const projections = corners.map((corner) => corner.x * normal.x + corner.y * normal.y);
  const min = Math.min(...projections);
  const max = Math.max(...projections);
  const paths = [];

  const firstOffset = min + spacing / 2 + phase;
  for (let offset = firstOffset; offset < max; offset += spacing) {
    const intersections = [];
    for (let index = 0; index < corners.length; index += 1) {
      const start = corners[index];
      const end = corners[(index + 1) % corners.length];
      const startDistance = start.x * normal.x + start.y * normal.y - offset;
      const endDistance = end.x * normal.x + end.y * normal.y - offset;
      if (Math.abs(startDistance) <= EPSILON) intersections.push(start);
      if ((startDistance < -EPSILON && endDistance > EPSILON) || (startDistance > EPSILON && endDistance < -EPSILON)) {
        const ratio = startDistance / (startDistance - endDistance);
        intersections.push(point(start.x + (end.x - start.x) * ratio, start.y + (end.y - start.y) * ratio));
      }
    }
    if (intersections.length >= 2) {
      const first = intersections[0];
      const last = intersections[intersections.length - 1];
      if (Math.hypot(last.x - first.x, last.y - first.y) > EPSILON) paths.push([first, last]);
    }
  }
  return snake ? connectScanlines(paths) : paths;
}

function cylinderInfill(radius, inset, angleDegrees, spacing, snake = false, phase = 0) {
  const innerRadius = radius - inset;
  if (innerRadius <= 0) return [];
  const angle = angleDegrees * Math.PI / 180;
  const direction = point(Math.cos(angle), Math.sin(angle));
  const normal = point(-direction.y, direction.x);
  const paths = [];
  const firstOffset = -innerRadius + spacing / 2 + phase;
  for (let offset = firstOffset; offset < innerRadius; offset += spacing) {
    const halfChord = Math.sqrt(Math.max(0, innerRadius ** 2 - offset ** 2));
    const center = point(normal.x * offset, normal.y * offset);
    const start = point(center.x - direction.x * halfChord, center.y - direction.y * halfChord);
    const end = point(center.x + direction.x * halfChord, center.y + direction.y * halfChord);
    if (Math.hypot(end.x - start.x, end.y - start.y) > EPSILON) paths.push([start, end]);
  }
  return snake ? connectScanlines(paths) : paths;
}

function regionScan(region, inset, angleDegrees, spacing, snake = false, phase = 0) {
  const angle = angleDegrees * Math.PI / 180;
  const direction = point(Math.cos(angle), Math.sin(angle));
  const normal = point(-direction.y, direction.x);
  const { minX, maxX, minY, maxY } = region.bounds;
  const corners = [point(minX, minY), point(maxX, minY), point(maxX, maxY), point(minX, maxY)];
  const across = corners.map((corner) => corner.x * normal.x + corner.y * normal.y);
  const along = corners.map((corner) => corner.x * direction.x + corner.y * direction.y);
  const lineStart = Math.min(...along) - 1;
  const lineEnd = Math.max(...along) + 1;
  const lines = [];
  for (let offset = Math.min(...across) + spacing / 2 + phase; offset < Math.max(...across); offset += spacing) {
    const from = point(normal.x * offset + direction.x * lineStart, normal.y * offset + direction.y * lineStart);
    const to = point(normal.x * offset + direction.x * lineEnd, normal.y * offset + direction.y * lineEnd);
    lines.push(...region.clip(inset, from, to));
  }
  if (!snake) return lines;
  const paths = [];
  let current = null;
  const reach = spacing * 5;
  for (const [first, second] of lines) {
    if (current) {
      const tail = current[current.length - 1];
      const [entry, exit] = Math.hypot(tail.x - first.x, tail.y - first.y) <= Math.hypot(tail.x - second.x, tail.y - second.y)
        ? [first, second]
        : [second, first];
      if (Math.hypot(tail.x - entry.x, tail.y - entry.y) <= reach) {
        current.push(entry, exit);
        continue;
      }
      paths.push(current);
    }
    current = [first, second];
  }
  if (current) paths.push(current);
  return paths;
}

function concentricInfill(config, inset) {
  const paths = [];
  if (config.region) {
    for (let offset = inset + config.lineWidth / 2; paths.length < 400; offset += config.lineWidth) {
      const loops = config.region.loops(offset).filter((loop) => loop.length > 3);
      if (!loops.length) break;
      paths.push(...loops);
    }
    return paths;
  }
  for (let offset = inset + config.lineWidth / 2; ; offset += config.lineWidth) {
    if (config.shape === "cylinder" && config.width / 2 - offset <= 0) break;
    const outline = config.shape === "cylinder"
      ? circlePath(config.width / 2 - offset)
      : rectanglePath(config.width, config.depth, offset);
    if (outline.length < 2) break;
    paths.push(outline);
  }
  return paths;
}

function clipInfillSegment(config, inset, start, end) {
  let minT = 0;
  let maxT = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (config.shape === "cylinder") {
    const radius = config.width / 2 - inset;
    if (radius <= 0) return null;
    const a = dx * dx + dy * dy;
    const b = 2 * (start.x * dx + start.y * dy);
    const c = start.x * start.x + start.y * start.y - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    minT = Math.max(minT, (-b - root) / (2 * a));
    maxT = Math.min(maxT, (-b + root) / (2 * a));
  } else {
    const halfX = config.width / 2 - inset;
    const halfY = config.depth / 2 - inset;
    if (halfX <= 0 || halfY <= 0) return null;
    for (const [position, delta, halfSize] of [[start.x, dx, halfX], [start.y, dy, halfY]]) {
      if (Math.abs(delta) <= EPSILON) {
        if (position < -halfSize || position > halfSize) return null;
        continue;
      }
      const first = (-halfSize - position) / delta;
      const second = (halfSize - position) / delta;
      minT = Math.max(minT, Math.min(first, second));
      maxT = Math.min(maxT, Math.max(first, second));
    }
  }
  if (minT > maxT || maxT - minT <= EPSILON) return null;
  return [
    point(start.x + dx * minT, start.y + dy * minT),
    point(start.x + dx * maxT, start.y + dy * maxT),
  ];
}

function clipInfillSegments(config, inset, start, end) {
  if (config.region) return config.region.clip(inset, start, end);
  const clipped = clipInfillSegment(config, inset, start, end);
  return clipped ? [clipped] : [];
}

function connectLineSegments(segments) {
  const key = ({ x, y }) => `${Math.round(x * 100000)},${Math.round(y * 100000)}`;
  const nodes = new Map();
  segments.forEach(([start, end], index) => {
    for (const [at, other] of [[start, end], [end, start]]) {
      const nodeKey = key(at);
      if (!nodes.has(nodeKey)) nodes.set(nodeKey, { point: at, edges: [] });
      nodes.get(nodeKey).edges.push({ index, other });
    }
  });
  const used = new Uint8Array(segments.length);
  const paths = [];
  const trace = (start, firstEdge) => {
    const points = [start];
    let nodeKey = key(start);
    let edge = firstEdge;
    while (edge && !used[edge.index]) {
      used[edge.index] = 1;
      points.push(edge.other);
      nodeKey = key(edge.other);
      edge = nodes.get(nodeKey)?.edges.find(({ index }) => !used[index]);
    }
    if (points.length > 1) paths.push(points);
  };
  nodes.forEach(({ point: start, edges }) => {
    edges.forEach((edge) => {
      if (!used[edge.index]) trace(start, edge);
    });
  });
  segments.forEach(([start], index) => {
    if (!used[index]) trace(start, { index, other: segments[index][1] });
  });
  return paths;
}

function honeycombInfill(config, inset, density, angleDegrees) {
  const radius = config.lineWidth * 2 / (Math.sqrt(3) * density / 100);
  const xStep = radius * Math.sqrt(3);
  const yStep = radius * 1.5;
  const maxX = config.width / 2 - inset;
  const maxY = config.depth / 2 - inset;
  const rotation = angleDegrees * Math.PI / 180;
  const rotate = (x, y) => point(
    x * Math.cos(rotation) - y * Math.sin(rotation),
    x * Math.sin(rotation) + y * Math.cos(rotation),
  );
  const segments = [];
  const seenEdges = new Set();
  let row = 0;
  for (let y = -maxY - radius; y <= maxY + radius; y += yStep, row += 1) {
    const shift = row % 2 ? xStep / 2 : 0;
    for (let x = -maxX - radius + shift; x <= maxX + radius; x += xStep) {
      const vertices = Array.from({ length: 6 }, (_, index) => {
        const angle = (index * 60 + 30) * Math.PI / 180;
        return rotate(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      });
      for (let index = 0; index < vertices.length; index += 1) {
        const start = vertices[index];
        const end = vertices[(index + 1) % vertices.length];
        const startKey = `${Math.round(start.x * 100000)},${Math.round(start.y * 100000)}`;
        const endKey = `${Math.round(end.x * 100000)},${Math.round(end.y * 100000)}`;
        const edgeKey = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        segments.push(...clipInfillSegments(config, inset, start, end));
      }
    }
  }
  return connectLineSegments(segments).map((points) => ({ type: "sparse-infill", points }));
}

function gyroidInfill(config, inset, angleDegrees, density, workBudget, z) {
  const period = config.lineWidth * 3 / Math.sqrt(density / 100);
  const sampleStep = Math.max(0.08, Math.min(config.lineWidth / 2, period / 12));
  const extentX = config.width / 2 + period;
  const extentY = config.depth / 2 + period;
  const angle = angleDegrees * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const layerZ = z * 2 * Math.PI / period;
  const sinZ = Math.sin(layerZ);
  const cosZ = Math.cos(layerZ);
  const sampleAxis = (min, max) => {
    const values = [];
    for (let value = min; value < max; value += sampleStep) values.push(value);
    values.push(max);
    return values;
  };
  const xs = sampleAxis(-extentX, extentX);
  const ys = sampleAxis(-extentY, extentY);
  workBudget.cells += (xs.length - 1) * (ys.length - 1);
  if (workBudget.cells > 5000000) {
    throw new Error("Gyroid generation exceeds its 5,000,000-cell safety limit. Reduce the model size or infill density.");
  }
  const xSamples = xs.map((x) => {
    const rotatedX = (x * cos) * 2 * Math.PI / period;
    const rotatedY = (-x * sin) * 2 * Math.PI / period;
    return {
      sinX: Math.sin(rotatedX), cosX: Math.cos(rotatedX),
      sinY: Math.sin(rotatedY), cosY: Math.cos(rotatedY),
    };
  });
  const ySamples = ys.map((y) => {
    const rotatedX = (y * sin) * 2 * Math.PI / period;
    const rotatedY = (y * cos) * 2 * Math.PI / period;
    return {
      sinX: Math.sin(rotatedX), cosX: Math.cos(rotatedX),
      sinY: Math.sin(rotatedY), cosY: Math.cos(rotatedY),
    };
  });
  const samples = Array.from({ length: ys.length }, (_, yIndex) => {
    const y = ySamples[yIndex];
    return xSamples.map((x) => {
      const sinX = x.sinX * y.cosX + x.cosX * y.sinX;
      const cosX = x.cosX * y.cosX - x.sinX * y.sinX;
      const sinY = x.sinY * y.cosY + x.cosY * y.sinY;
      const cosY = x.cosY * y.cosY - x.sinY * y.sinY;
      return sinX * cosY + sinY * cosZ + sinZ * cosX;
    });
  });
  const segments = [];
  const crossing = (first, second, firstValue, secondValue) => {
    const ratio = firstValue / (firstValue - secondValue);
    return point(first.x + (second.x - first.x) * ratio, first.y + (second.y - first.y) * ratio);
  };
  const corners = [];
  for (let row = 0; row < ys.length - 1; row += 1) {
    for (let column = 0; column < xs.length - 1; column += 1) {
      const values = [
        samples[row][column], samples[row][column + 1],
        samples[row + 1][column + 1], samples[row + 1][column],
      ];
      let min = Infinity;
      let max = -Infinity;
      for (const value of values) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      if (min > 0 || max < 0) continue;
      corners[0] = point(xs[column], ys[row]);
      corners[1] = point(xs[column + 1], ys[row]);
      corners[2] = point(xs[column + 1], ys[row + 1]);
      corners[3] = point(xs[column], ys[row + 1]);
      const crossings = [];
      for (let edge = 0; edge < 4; edge += 1) {
        const next = (edge + 1) % 4;
        if ((values[edge] < 0) !== (values[next] < 0)) {
          crossings.push({ edge, point: crossing(corners[edge], corners[next], values[edge], values[next]) });
        }
      }
      const pairs = [];
      if (crossings.length === 2) {
        pairs.push([crossings[0], crossings[1]]);
      } else if (crossings.length === 4) {
        const centerInside = values.reduce((sum, value) => sum + value, 0) < 0;
        const firstCornerInside = values[0] < 0;
        const edgePairs = centerInside === firstCornerInside
          ? [[0, 1], [2, 3]]
          : [[3, 0], [1, 2]];
        edgePairs.forEach(([firstEdge, secondEdge]) => {
          pairs.push([
            crossings.find(({ edge }) => edge === firstEdge),
            crossings.find(({ edge }) => edge === secondEdge),
          ]);
        });
      }
      for (const [first, second] of pairs) {
        segments.push(...clipInfillSegments(config, inset, first.point, second.point));
      }
    }
  }
  return connectLineSegments(segments).map((points) => ({ type: "sparse-infill", points }));
}

function sparseInfill(config, inset, angleDegrees, spacing, layerIndex, workBudget, z) {
  const rectangular = (angle, lineSpacing = spacing) => (config.region
    ? regionScan(config.region, inset, angle, lineSpacing, false)
    : rectangleInfill(config.width, config.depth, inset, angle, lineSpacing, false)
  ).map((points) => ({ type: "sparse-infill", points }));
  const circular = (angle, lineSpacing = spacing) => cylinderInfill(
    config.width / 2, inset, angle, lineSpacing, false,
  ).map((points) => ({ type: "sparse-infill", points }));
  const phasedScans = (angle, shift, lineSpacing = spacing) => (config.region
    ? regionScan(config.region, inset, angle, lineSpacing, false, shift)
    : config.shape === "cylinder"
      ? cylinderInfill(config.width / 2, inset, angle, lineSpacing, false, shift)
      : rectangleInfill(config.width, config.depth, inset, angle, lineSpacing, false, shift))
    .map((points) => ({ type: "sparse-infill", points }));
  const scans = config.shape === "cylinder" ? circular : rectangular;

  if (config.sparsePattern === "honeycomb") {
    return honeycombInfill(config, inset, config.infillPercent, angleDegrees);
  }
  if (config.sparsePattern === "gyroid") {
    return gyroidInfill(config, inset, angleDegrees, config.infillPercent, workBudget, z);
  }
  if (config.sparsePattern === "grid") {
    return [...scans(angleDegrees), ...scans(angleDegrees + 90)];
  }
  if (config.sparsePattern === "triangles") {
    return [0, 60, 120].flatMap((rotation) => scans(angleDegrees + rotation));
  }
  if (config.sparsePattern === "cubic") {
    const shift = ((z / Math.SQRT2) % spacing + spacing) % spacing;
    return [0, 120, 240].flatMap((rotation) => (
      phasedScans(angleDegrees + rotation, shift)
    ));
  }
  return scans(angleDegrees + (layerIndex % 2) * 90);
}

function orientationOffset(orientation) {
  const offsets = {
    trailing: 180,
    leading: 0,
    adjacent: 90,
    "hybrid-trailing": 135,
    "hybrid-leading": 45,
  };
  if (!Object.hasOwn(offsets, orientation)) throw new Error("Choose a supported nozzle orientation.");
  return offsets[orientation];
}

function axisValues(config, heading) {
  const angle = config.tiltAngle;
  if (config.angleMode === "absolute") {
    if (Math.abs(angle) <= EPSILON || config.axisCount < 4) return {};
    return { [config.tiltAxis]: angle };
  }
  const azimuth = (heading + config.orientationOffset) * Math.PI / 180;
  const values = {
    A: angle * Math.sin(azimuth),
    B: -angle * Math.cos(azimuth),
  };
  if (config.axisCount >= 6) {
    const direction = config.rotaryCMode === "bed" ? -1 : 1;
    const cAngle = ((heading + config.orientationOffset + 180) % 360 + 360) % 360 - 180;
    values.C = direction * cAngle;
  }
  return values;
}

function checkAxisLimits(config, values) {
  const limits = { A: [config.aMin, config.aMax], B: [config.bMin, config.bMax], C: [config.cMin, config.cMax] };
  for (const [axis, value] of Object.entries(values)) {
    if (axis === "C" && config.rotaryCMode === "bed") continue;
    const [min, max] = limits[axis];
    if (value < min - EPSILON || value > max + EPSILON) {
      throw new Error(`${axis}-axis move ${format(value, 1)}° is outside configured limits (${format(min, 1)}° to ${format(max, 1)}°).`);
    }
  }
}

function axisWords(config, start, end, rotaryState) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const heading = Math.atan2(dy, dx) * 180 / Math.PI;
  const values = axisValues(config, heading);
  if (Object.hasOwn(values, "C") && config.rotaryCMode === "tool") {
    const requested = values.C;
    const firstTurn = Math.ceil((config.cMin - requested - EPSILON) / 360);
    const lastTurn = Math.floor((config.cMax - requested + EPSILON) / 360);
    if (firstTurn > lastTurn) {
      throw new Error(`Tool C-axis heading ${format(requested, 1)}° has no equivalent within configured limits (${format(config.cMin, 1)}° to ${format(config.cMax, 1)}°). Increase the physical travel range or change the orientation.`);
    }
    const closestTurn = Math.round(((rotaryState.C ?? 0) - requested) / 360);
    const selectedTurn = Math.min(lastTurn, Math.max(firstTurn, closestTurn));
    const selected = requested + selectedTurn * 360;
    values.C = selected;
    rotaryState.C = selected;
  } else if (Object.hasOwn(values, "C")) {
    rotaryState.C = values.C;
  }
  checkAxisLimits(config, values);
  return Object.entries(values).map(([axis, value]) => `${axis}${format(value, 3)}`).join(" ");
}

function resolveCustomGcode(source, config, name) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(source)) throw new Error(`${name} cannot contain control characters.`);
  return source
    .replaceAll("[BED_TEMP]", format(config.bedTemp, 0))
    .replaceAll("[HOTEND_TEMP]", format(config.hotendTemp, 0))
    .replaceAll("[TOOL_INDEX]", String(config.toolIndex));
}

function validate(config) {
  const sampleType = config.sampleType === "mechanical" ? "mechanical" : "primitive";
  const specimen = sampleType === "mechanical"
    ? mechanicalSpecimen(String(config.mechanicalSample), String(config.mechanicalStandard ?? "astm"))
    : null;
  const shape = specimen ? specimen.key : String(config.shape);
  if (!specimen && !["cube", "cuboid", "cylinder"].includes(shape)) throw new Error("Choose cube, cuboid, or cylinder.");
  const sampleOrientation = specimen ? String(config.mechanicalOrientation ?? "flat") : "flat";
  const oriented = specimen ? orientedSpecimen(specimen, sampleOrientation) : null;
  const sampleCount = specimen ? ranged(config.sampleCount ?? 1, "Sample count", 1, 10) : 1;
  if (!Number.isInteger(sampleCount)) throw new Error("Sample count must be a whole number.");
  const sampleSpacing = specimen ? ranged(config.sampleSpacing ?? 4, "Sample spacing", 0, 100) : 0;
  const width = oriented ? oriented.width : ranged(shape === "cylinder" ? config.diameter : config.width, shape === "cylinder" ? "Diameter" : "Width", 2, 200);
  const depth = oriented ? oriented.depth : shape === "cube" ? width : ranged(shape === "cylinder" ? config.diameter : config.depth, shape === "cylinder" ? "Diameter" : "Depth", 2, 200);
  const height = oriented ? oriented.height : ranged(config.height, "Height", 0.2, 200);
  const wallCount = ranged(config.wallCount, "Wall count", 0, 10);
  if (!Number.isInteger(wallCount)) throw new Error("Wall count must be a whole number.");
  const lineWidth = ranged(config.lineWidth, "Line width", 0.1, 3);
  const infillPercent = ranged(config.infillPercent, "Infill density", 0, 100);
  const infillAngle = ranged(config.infillAngle, "Infill rotation", 0, 180);
  const infillOverlap = ranged(config.infillOverlap ?? 15, "Infill wall overlap", 0, 50);
  const solidPattern = String(config.solidPattern ?? "monotonic");
  const sparsePattern = String(config.sparsePattern ?? "rectilinear");
  if (!["monotonic", "concentric"].includes(solidPattern)) throw new Error("Choose monotonic or concentric solid infill.");
  if (!["rectilinear", "grid", "triangles", "honeycomb", "cubic", "gyroid"].includes(sparsePattern)) {
    throw new Error("Choose a supported sparse infill pattern.");
  }
  const bottomLayers = ranged(config.bottomLayers ?? 3, "Bottom layers", 0, 50);
  const topLayers = ranged(config.topLayers ?? 3, "Top layers", 0, 50);
  if (!Number.isInteger(bottomLayers) || !Number.isInteger(topLayers)) {
    throw new Error("Top and bottom layer counts must be whole numbers.");
  }
  const axisCount = ranged(config.axisCount, "Machine axis count", 3, 6);
  if (!Number.isInteger(axisCount)) throw new Error("Machine axis count must be a whole number from 3 to 6.");
  const hasRotaryAxes = axisCount >= 4;
  const tiltAngle = hasRotaryAxes ? ranged(config.tiltAngle, "Tilt angle", -89, 89) : 0;
  const tipDiameter = ranged(config.tipDiameter, "Nozzle tip diameter", 0.05, 10);
  const holeDiameter = ranged(config.holeDiameter, "Nozzle hole diameter", 0.05, 5);
  const layerHeight = ranged(config.layerHeight, "Layer height", 0.01, Math.min(2, holeDiameter * 1.5));
  const firstLayerHeight = ranged(config.firstLayerHeight, "First layer height", 0.01, Math.min(2, holeDiameter * 1.5));
  if (firstLayerHeight > height) throw new Error("First layer height cannot exceed the model height.");
  if (pathSpacing(lineWidth, layerHeight) <= 0 || pathSpacing(lineWidth, firstLayerHeight) <= 0) {
    throw new Error("Line width must exceed the layer-height overlap compensation for both regular and first layers.");
  }
  const clearance = minimumLayerHeight(tipDiameter, tiltAngle);
  if (firstLayerHeight + EPSILON < clearance || layerHeight + EPSILON < clearance) {
    throw new Error(`Layer height must be at least ${format(clearance, 3)} mm for a ${format(tiltAngle, 1)}° tilt and ${format(tipDiameter, 2)} mm nozzle tip.`);
  }
  const extrusionMultiplier = ranged(config.extrusionMultiplier, "Extrusion multiplier", 1, 300) / 100;
  const filamentDiameter = ranged(config.filamentDiameter, "Filament diameter", 1, 4);
  const tiltAxis = hasRotaryAxes ? String(config.tiltAxis).toUpperCase() : "A";
  if (hasRotaryAxes && !["A", "B"].includes(tiltAxis)) throw new Error("Choose A or B as the tilt axis.");
  const angleMode = hasRotaryAxes ? String(config.angleMode) : "absolute";
  if (!["absolute", "adaptive"].includes(angleMode)) throw new Error("Choose absolute or adaptive angle mode.");
  if (angleMode === "adaptive" && axisCount < 5) throw new Error("Adaptive angle requires at least a 5-axis machine.");
  if (!["klipper", "marlin", "reprap", "generic"].includes(config.firmware)) throw new Error("Choose a supported firmware dialect.");
  const orientationOffsetValue = orientationOffset(String(config.orientation ?? "trailing"));
  const bedShape = String(config.bedShape ?? "rectangular");
  if (!["rectangular", "circular"].includes(bedShape)) throw new Error("Choose a rectangular or circular bed.");
  const bedWidth = ranged(config.bedWidth, bedShape === "circular" ? "Bed diameter" : "Bed width X", 50, 2000);
  const bedDepth = bedShape === "circular" ? bedWidth : ranged(config.bedDepth, "Bed depth Y", 50, 2000);
  const originAtCenter = config.originAtCenter === true || config.originAtCenter === "on";
  const bedMinX = originAtCenter ? -bedWidth / 2 : 0;
  const bedMaxX = originAtCenter ? bedWidth / 2 : bedWidth;
  const bedMinY = originAtCenter ? -bedDepth / 2 : 0;
  const bedMaxY = originAtCenter ? bedDepth / 2 : bedDepth;
  const centerX = ranged(config.centerX, "Print center X", bedMinX, bedMaxX);
  const centerY = ranged(config.centerY, "Print center Y", bedMinY, bedMaxY);
  const skirtEnabled = config.skirtEnabled === undefined
    ? Number(config.skirtLoops ?? 0) > 0
    : config.skirtEnabled === true || config.skirtEnabled === "on";
  const skirtLoops = skirtEnabled ? ranged(config.skirtLoops, "Skirt loops", 0, 10) : 0;
  const skirtDistance = ranged(config.skirtDistance, "Skirt distance", 0, 20);
  if (!Number.isInteger(skirtLoops)) throw new Error("Skirt loops must be a whole number.");
  const purgeLine = config.purgeLine === true || config.purgeLine === "true" || config.purgeLine === "on";
  const minimumPurgeLength = ranged(config.minimumPurgeLength ?? 30, "Minimum purge line length", 1, 1000);
  const purgeMultiplier = ranged(config.purgeMultiplier ?? 200, "Priming extrusion multiplier", 100, 300) / 100;
  const axisLimits = {};
  for (const axis of ["a", "b", "c"]) {
    const min = hasRotaryAxes ? finite(config[`${axis}Min`], `${axis.toUpperCase()}-axis minimum`) : -180;
    const max = hasRotaryAxes ? finite(config[`${axis}Max`], `${axis.toUpperCase()}-axis maximum`) : 180;
    if (min >= max) throw new Error(`${axis.toUpperCase()}-axis minimum must be lower than its maximum.`);
    axisLimits[`${axis}Min`] = min;
    axisLimits[`${axis}Max`] = max;
  }
  const values = {
    width, depth, height, shape, wallCount, lineWidth, infillPercent, infillAngle,
    infillOverlap, solidPattern, sparsePattern, bottomLayers, topLayers,
    tiltAngle, tipDiameter, holeDiameter, layerHeight, firstLayerHeight, extrusionMultiplier,
    filamentDiameter, axisCount, tiltAxis, angleMode, orientationOffset: orientationOffsetValue,
    orientation: String(config.orientation), firmware: String(config.firmware),
    bedWidth, bedDepth, centerX, centerY, skirtLoops, skirtDistance, purgeLine,
    minimumPurgeLength, purgeMultiplier,
    rotaryCMode: String(config.rotaryCMode) === "bed" ? "bed" : "tool",
    bedShape, bedMinX, bedMaxX, bedMinY, bedMaxY, originAtCenter,
    firstLayerFan: ranged(config.firstLayerFan, "First layer fan", 0, 100),
    unretractSpeed: ranged(config.unretractSpeed, "Unretraction speed", 1, 100),
    extraRestart: ranged(config.extraRestart ?? 0, "Extra restart", -5, 5),
    firmwareRetraction: config.firmwareRetraction === true || config.firmwareRetraction === "on",
    usePressureAdvance: config.usePressureAdvance === true || config.usePressureAdvance === "on",
    homeAxes: config.homeAxes === true || config.homeAxes === "on",
    heatBed: config.heatBed === true || config.heatBed === "on",
    heatHotend: config.heatHotend === true || config.heatHotend === "on",
    ...axisLimits,
    printSpeed: ranged(config.printSpeed, "Print speed", 1, 500),
    firstLayerSpeed: ranged(config.firstLayerSpeed, "First layer speed", 1, 200),
    hotendTemp: ranged(config.hotendTemp, "Hotend temperature", 0, 350),
    bedTemp: ranged(config.bedTemp, "Bed temperature", 0, 150),
    fanSpeed: ranged(config.fanSpeed, "Fan speed", 0, 100),
    acceleration: ranged(config.acceleration, "Acceleration", 0, 50000),
    retractDistance: ranged(config.retractDistance, "Retraction distance", 0, 20),
    retractThreshold: ranged(config.retractThreshold, "Retraction minimum travel", 0, 50),
    retractSpeed: ranged(config.retractSpeed, "Retraction speed", 1, 100),
    zHop: ranged(config.zHop, "Z-hop", 0, 20),
    pressureAdvance: ranged(config.pressureAdvance, "Pressure advance", 0, 10),
    toolIndex: ranged(config.toolIndex, "Tool index", 0, 15),
    extruderName: String(config.extruderName ?? "").trim(),
    startGcode: String(config.startGcode ?? ""),
    endGcode: String(config.endGcode ?? ""),
  };
  if (!Number.isInteger(values.toolIndex)) throw new Error("Tool index must be a whole number.");
  if (values.extruderName && !/^[A-Za-z0-9_.-]{1,64}$/.test(values.extruderName)) {
    throw new Error("Klipper extruder name can contain only letters, numbers, dots, underscores and hyphens.");
  }
  if (values.firmware === "klipper" && values.toolIndex > 0 && !values.extruderName) {
    throw new Error("For a non-default Klipper tool, enter its extruder name.");
  }
  if (values.angleMode === "absolute") {
    const valuesAtRest = axisValues(values, 0);
    checkAxisLimits(values, valuesAtRest);
  }
  const skirtSpacing = pathSpacing(lineWidth, firstLayerHeight);
  const skirtMargin = skirtLoops > 0 ? skirtDistance + (skirtLoops - 1) * skirtSpacing + lineWidth / 2 : 0;
  const purgeSpacing = pathSpacing(lineWidth, firstLayerHeight);
  const fitsBed = (groupWidth, groupDepth) => {
    const radiusX = groupWidth / 2 + skirtMargin;
    const radiusY = groupDepth / 2 + skirtMargin;
    const purgeLength = Math.max(minimumPurgeLength, groupWidth);
    const purgeStartY = -groupDepth / 2 - lineWidth - 2;
    const purgeMinX = purgeLine ? -groupWidth / 2 - lineWidth / 2 : 0;
    const purgeMaxX = purgeLine ? -groupWidth / 2 + purgeLength + lineWidth / 2 : 0;
    const purgeMinY = purgeLine ? purgeStartY - lineWidth / 2 : 0;
    const offsetMinX = Math.min(-radiusX, purgeMinX);
    const offsetMaxX = Math.max(radiusX, purgeMaxX);
    const offsetMinY = Math.min(-radiusY, purgeMinY);
    const offsetMaxY = radiusY;
    if (bedShape === "rectangular") {
      return centerX + offsetMinX >= bedMinX - EPSILON && centerX + offsetMaxX <= bedMaxX + EPSILON
        && centerY + offsetMinY >= bedMinY - EPSILON && centerY + offsetMaxY <= bedMaxY + EPSILON;
    }
    const bedCenterX = originAtCenter ? 0 : bedWidth / 2;
    const bedCenterY = originAtCenter ? 0 : bedDepth / 2;
    return [
      [centerX + offsetMinX, centerY + offsetMinY],
      [centerX + offsetMinX, centerY + offsetMaxY],
      [centerX + offsetMaxX, centerY + offsetMinY],
      [centerX + offsetMaxX, centerY + offsetMaxY],
    ].every(([x, y]) => Math.hypot(x - bedCenterX, y - bedCenterY) <= bedWidth / 2 + EPSILON);
  };
  const bestArrangement = (count) => {
    let best = null;
    for (let columns = 1; columns <= count; columns += 1) {
      const candidate = arrangeGrid(count, columns, width, depth, sampleSpacing);
      if (!fitsBed(candidate.groupWidth, candidate.groupDepth)) continue;
      if (!best || candidate.groupWidth * candidate.groupDepth < best.groupWidth * best.groupDepth - EPSILON) best = candidate;
    }
    return best;
  };
  const arrangement = bestArrangement(sampleCount);
  if (!arrangement) {
    let maxFit = 0;
    for (let count = 1; count < sampleCount; count += 1) if (bestArrangement(count)) maxFit = count;
    throw new Error(sampleCount === 1 || maxFit === 0
      ? "Specimen, skirt or purge line falls outside the configured bed. Adjust the print center or bed dimensions."
      : `${sampleCount} samples with ${format(sampleSpacing)} mm spacing, skirt and purge line do not fit on the bed. At most ${maxFit} fit; reduce the count or spacing.`);
  }
  const widestWallSpacing = Math.max(
    pathSpacing(lineWidth, layerHeight),
    pathSpacing(lineWidth, firstLayerHeight),
  );
  const innermostWallInset = wallCount > 0
    ? lineWidth / 2 + (wallCount - 1) * widestWallSpacing
    : 0;
  if (wallCount > 0 && innermostWallInset * 2 >= (oriented ? oriented.minFeature : Math.min(width, depth))) {
    throw new Error("The selected wall count and line width are too large for this specimen.");
  }
  values.sampleType = sampleType;
  values.specimen = specimen;
  values.region = specimen && sampleOrientation === "flat" ? createPolygonRegion(specimen.outline, skirtMargin + lineWidth + 2) : null;
  values.oriented = oriented;
  values.sampleOrientation = sampleOrientation;
  values.sampleCount = sampleCount;
  values.sampleSpacing = sampleSpacing;
  values.placements = arrangement.placements;
  values.groupWidth = arrangement.groupWidth;
  values.groupDepth = arrangement.groupDepth;
  return values;
}

function translatePaths(paths, dx, dy) {
  if (dx === 0 && dy === 0) return paths;
  return paths.map((path) => ({ ...path, points: path.points.map((p) => point(p.x + dx, p.y + dy)) }));
}

function makeSamplePaths(config, layerIndex, totalLayers, layerHeight, workBudget, z) {
  const paths = [];
  const isCylinder = config.shape === "cylinder";
  const outerRadius = config.width / 2;
  const wallSpacing = pathSpacing(config.lineWidth, layerHeight);
  const infillAngle = config.infillAngle + (layerIndex % 2) * 90;
  const isSolid = layerIndex < config.bottomLayers || layerIndex >= totalLayers - config.topLayers
    || config.infillPercent >= 100;

  for (let wall = 0; wall < config.wallCount; wall += 1) {
    const inset = config.lineWidth / 2 + wall * wallSpacing;
    if (config.region) {
      for (const points of config.region.loops(inset)) paths.push({ type: "wall", points });
      continue;
    }
    const outline = isCylinder
      ? circlePath(outerRadius - inset)
      : rectanglePath(config.width, config.depth, inset);
    if (outline.length) paths.push({ type: "wall", points: outline });
  }

  const innermostWallInset = config.wallCount > 0
    ? config.lineWidth / 2 + (config.wallCount - 1) * wallSpacing
    : 0;
  const inset = Math.max(
    config.lineWidth / 2,
    innermostWallInset + config.lineWidth * (1 - config.infillOverlap / 100) - config.lineWidth / 2,
  );
  if (isSolid) {
    const infill = config.solidPattern === "concentric"
      ? concentricInfill(config, inset)
      : config.region
        ? regionScan(config.region, inset, infillAngle, config.lineWidth, true)
        : isCylinder
        ? cylinderInfill(outerRadius, inset, infillAngle, config.lineWidth, true)
        : rectangleInfill(config.width, config.depth, inset, infillAngle, config.lineWidth, true);
    for (const points of infill) paths.push({ type: "solid-infill", points });
  } else if (config.infillPercent > 0) {
    const spacing = config.lineWidth * 100 / config.infillPercent;
    paths.push(...sparseInfill(config, inset, config.infillAngle, spacing, layerIndex, workBudget, z));
  }
  return paths;
}

function makeLayerPaths(config, layerIndex, z, totalLayers, workBudget) {
  const paths = [];
  const isCylinder = config.shape === "cylinder";
  const outerRadius = config.width / 2;
  const layerHeight = layerIndex === 0
    ? config.firstLayerHeight
    : Math.min(config.layerHeight, config.height - config.firstLayerHeight - (layerIndex - 1) * config.layerHeight);
  const wallSpacing = pathSpacing(config.lineWidth, layerHeight);
  const groupedSkirt = config.sampleCount > 1 || (config.oriented && config.oriented.orientation !== "flat");

  if (layerIndex === 0 && config.purgeLine) {
    const x = -config.groupWidth / 2;
    const y = -config.groupDepth / 2 - config.lineWidth - 2;
    const secondY = y + pathSpacing(config.lineWidth, layerHeight);
    const purgeLength = Math.max(config.minimumPurgeLength, config.groupWidth);
    const passes = [
      [point(x, y), point(x + purgeLength, y)],
      [point(x, secondY), point(x + purgeLength, secondY)],
    ];
    paths.push({ type: "purge", points: connectScanlines(passes)[0] });
  }
  if (layerIndex === 0) {
    for (let loop = config.skirtLoops - 1; loop >= 0; loop -= 1) {
      const inset = -(config.skirtDistance + loop * wallSpacing);
      if (!groupedSkirt && config.region) {
        for (const points of config.region.loops(inset)) paths.push({ type: "skirt", points });
        continue;
      }
      const outline = isCylinder && !groupedSkirt
        ? circlePath(outerRadius - inset)
        : rectanglePath(config.groupWidth - inset * 2, config.groupDepth - inset * 2, 0);
      if (outline.length) paths.push({ type: "skirt", points: outline });
    }
  }

  let sampleConfig = config;
  if (config.oriented && config.oriented.rectangles) {
    const zMid = Math.max(0, z - layerHeight / 2);
    sampleConfig = {
      ...config,
      width: config.oriented.width,
      depth: config.oriented.depth,
      region: createRectangleRegion(config.oriented.rectangles(zMid)),
    };
  }
  const samplePaths = makeSamplePaths(sampleConfig, layerIndex, totalLayers, layerHeight, workBudget, z);
  for (const placement of config.placements) paths.push(...translatePaths(samplePaths, placement.x, placement.y));
  return paths.map((path) => ({ ...path, z }));
}

function extrusionArea(height, width) {
  return (width - height) * height + Math.PI * (height / 2) ** 2;
}

export function generateGcode(input) {
  const config = validate(input);
  const layerHeights = [config.firstLayerHeight];
  while (layerHeights.reduce((sum, value) => sum + value, 0) < config.height - EPSILON) {
    if (layerHeights.length >= MAX_LAYERS) throw new Error(`Model exceeds the ${MAX_LAYERS}-layer safety limit.`);
    const printed = layerHeights.reduce((sum, value) => sum + value, 0);
    layerHeights.push(Math.min(config.layerHeight, config.height - printed));
  }
  const filamentArea = Math.PI * (config.filamentDiameter / 2) ** 2;
  const layerPaths = [];
  const workBudget = { cells: 0 };
  let cumulativeZ = 0;
  let segmentCount = 0;
  let pathCount = 0;
  for (let index = 0; index < layerHeights.length; index += 1) {
    cumulativeZ += layerHeights[index];
    const pathsForLayer = makeLayerPaths(config, index, cumulativeZ, layerHeights.length, workBudget);
    pathCount += pathsForLayer.length;
    segmentCount += pathsForLayer.reduce((sum, path) => sum + path.points.length - 1, 0);
    if (pathCount > 50000 || segmentCount > 500000) {
      throw new Error("Generated toolpath exceeds the safety limit of 50,000 paths or 500,000 moves. Reduce the model size or layer count.");
    }
    layerPaths.push(pathsForLayer);
  }
  const paths = layerPaths.flat();
  const lines = [
    "; Primitive tilting-nozzle test specimen",
    `; Shape: ${config.specimen ? config.specimen.label : config.shape}; dimensions: ${format(config.width)} x ${format(config.depth)} x ${format(config.height)} mm`,
    `; Walls: ${config.wallCount}; sparse infill: ${config.sparsePattern} at ${format(config.infillPercent, 0)}%; solid infill: ${config.solidPattern}; top/bottom layers: ${config.topLayers}/${config.bottomLayers}; infill-to-wall overlap: ${format(config.infillOverlap, 0)}%`,
    `; Priming: purge lines ${config.purgeLine ? "on" : "off"} (${format(config.minimumPurgeLength, 0)} mm minimum each); skirt loops ${config.skirtLoops}; extrusion multiplier ${format(config.purgeMultiplier * 100, 0)}%`,
    `; Infill base angle: ${format(config.infillAngle, 1)} degrees`,
    `; Tilt: ${format(config.tiltAngle, 1)} degrees; orientation: ${config.orientation}; angle mode: ${config.angleMode}`,
    `; Nozzle tip: ${format(config.tipDiameter, 2)} mm; hole: ${format(config.holeDiameter, 2)} mm; layer height: ${format(config.layerHeight, 3)} mm; extrusion multiplier: ${format(config.extrusionMultiplier * 100, 1)}%`,
    `; Machine: ${config.axisCount}-axis${config.axisCount >= 4 ? `; tilt axis ${config.tiltAxis}; rotary C: ${config.rotaryCMode}` : "; no rotary axes (A/B/C moves not generated)"}; firmware dialect: ${config.firmware}`,
    ...(config.specimen ? [`; Samples: ${config.sampleCount} x ${config.specimen.label}, ${config.sampleOrientation} orientation, ${format(config.sampleSpacing)} mm spacing; group footprint ${format(config.groupWidth)} x ${format(config.groupDepth)} mm with a single shared skirt`] : []),
    `; Bed: ${config.bedShape}; origin at center: ${config.originAtCenter}; print center X${format(config.centerX)} Y${format(config.centerY)}`,
    "; Verify kinematics, axis signs, limits, bed fit and firmware-specific start/end commands before printing.",
  ];
  if (config.startGcode.trim()) {
    lines.push("; Custom start G-code", resolveCustomGcode(config.startGcode.trim(), config, "Start G-code"));
  } else {
    lines.push("G90 ; absolute positioning", "M82 ; absolute extrusion");
    if (config.homeAxes) lines.push("G28 ; home axes");
    if (config.heatBed) lines.push(`M140 S${format(config.bedTemp, 0)}`, `M190 S${format(config.bedTemp, 0)}`);
    if (config.heatHotend) lines.push(`M104 S${format(config.hotendTemp, 0)}`, `M109 S${format(config.hotendTemp, 0)}`);
  }
  if (config.toolIndex > 0) lines.push(`T${format(config.toolIndex, 0)}`);
  if (config.acceleration > 0) lines.push(`M204 S${format(config.acceleration, 0)}`);
  if (config.usePressureAdvance) {
    if (config.firmware === "klipper") {
      const extruder = config.extruderName ? ` EXTRUDER=${config.extruderName}` : "";
      lines.push(`SET_PRESSURE_ADVANCE${extruder} ADVANCE=${format(config.pressureAdvance, 3)}`);
    }
    else if (config.firmware === "marlin") lines.push(`M900 K${format(config.pressureAdvance, 3)}`);
    else if (config.firmware === "reprap") lines.push(`M572 D${format(config.toolIndex, 0)} S${format(config.pressureAdvance, 3)}`);
    else lines.push(`; Pressure advance ${format(config.pressureAdvance, 3)} (set with your firmware-specific command)`);
  }
  lines.push("G92 E0");

  let extrusion = 0;
  let currentZ = 0;
  let hasPrintedPath = false;
  let lastPoint = null;
  let filamentLength = 0;
  const rotaryState = {};
  for (let layerIndex = 0; layerIndex < layerHeights.length; layerIndex += 1) {
    const currentLayerPaths = layerPaths[layerIndex];
    lines.push(`; Layer ${layerIndex + 1}/${layerHeights.length} · Z ${format(currentLayerPaths[0]?.z ?? currentZ, 3)}`);
    lines.push(`M106 S${Math.round((layerIndex === 0 ? config.firstLayerFan : config.fanSpeed) * 2.55)}`);
    for (const path of currentLayerPaths) {
      const points = path.points;
      if (points.length < 2) continue;
      const first = points[0];
      const firstAxisWords = axisWords(config, first, points[1], rotaryState);
      const travelLength = lastPoint ? Math.hypot(first.x - lastPoint.x, first.y - lastPoint.y) : 0;
      const shouldRetract = hasPrintedPath && travelLength >= config.retractThreshold && config.retractDistance > 0;
      if (shouldRetract) {
        if (config.firmwareRetraction) lines.push("G10 ; firmware retract");
        else {
          extrusion -= config.retractDistance;
          lines.push(`G1 E${format(extrusion)} F${format(config.retractSpeed * 60, 0)} ; retract`);
        }
      }
      const travelZ = path.z + (shouldRetract ? config.zHop : 0);
      lines.push(`G0 X${format(config.centerX + first.x)} Y${format(config.centerY + first.y)} Z${format(travelZ)}${firstAxisWords ? ` ${firstAxisWords}` : ""} F6000`);
      if (shouldRetract && config.zHop > 0) lines.push(`G0 Z${format(path.z)} F6000 ; lower Z-hop`);
      if (shouldRetract) {
        if (config.firmwareRetraction) lines.push("G11 ; firmware unretract");
        else {
          extrusion += config.retractDistance + config.extraRestart;
          lines.push(`G1 E${format(extrusion)} F${format(config.unretractSpeed * 60, 0)} ; unretract`);
        }
      }
      for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        const previous = points[pointIndex - 1];
        const next = points[pointIndex];
        const length = Math.hypot(next.x - previous.x, next.y - previous.y);
        if (length <= EPSILON) continue;
        const multiplier = path.type === "purge" || path.type === "skirt"
          ? config.purgeMultiplier
          : config.extrusionMultiplier;
        const deltaE = extrusionArea(layerHeights[layerIndex], config.lineWidth) * multiplier / filamentArea * length;
        extrusion += deltaE;
        filamentLength += deltaE;
        const speed = layerIndex === 0 ? config.firstLayerSpeed : config.printSpeed;
        const rotary = axisWords(config, previous, next, rotaryState);
        const pathLabel = path.type === "solid-infill" ? "solid infill" : path.type === "sparse-infill" ? "sparse infill" : path.type;
        lines.push(`G1 X${format(config.centerX + next.x)} Y${format(config.centerY + next.y)} Z${format(path.z)} E${format(extrusion)}${rotary ? ` ${rotary}` : ""} F${format(speed * 60, 0)} ; ${pathLabel}`);
      }
      hasPrintedPath = true;
      currentZ = path.z;
      lastPoint = points.at(-1);
    }
  }
  if (config.endGcode.trim()) {
    lines.push("; Custom end G-code", resolveCustomGcode(config.endGcode.trim(), config, "End G-code"));
  } else {
    if (config.retractDistance > 0) {
      if (config.firmwareRetraction) lines.push("G10 ; final firmware retract");
      else {
        extrusion -= config.retractDistance;
        lines.push(`G1 E${format(extrusion)} F${format(config.retractSpeed * 60, 0)} ; final retract`);
      }
    }
    lines.push(`G0 Z${format(currentZ + 10)} F6000`, "M104 S0", "M140 S0", "M107 ; turn off part cooling fan", "M84");
  }
  const previewIndices = [0, Math.floor((layerHeights.length - 1) / 2), layerHeights.length - 1];
  const previewNames = ["FIRST LAYER", "MIDDLE LAYER", "LAST LAYER"];
  const layerZs = [];
  let previewZ = 0;
  for (const layerHeight of layerHeights) {
    previewZ += layerHeight;
    layerZs.push(previewZ);
  }
  const toPreviewLayer = (layerIndex, name = `LAYER ${layerIndex + 1}`) => {
    const z = layerZs[layerIndex];
    const pathsForLayer = layerPaths[layerIndex]
      .map((path) => ({
        type: path.type,
        z: path.z,
        points: path.points.map(({ x, y }) => ({ x: config.centerX + x, y: config.centerY + y })),
      }));
    return { name, number: layerIndex + 1, z, paths: pathsForLayer };
  };
  const allPreviewLayers = layerHeights.map((_, layerIndex) => toPreviewLayer(layerIndex));
  const previewLayers = previewIndices.map((layerIndex, index) => toPreviewLayer(layerIndex, previewNames[index]));
  return {
    text: `${lines.join("\n")}\n`,
    metrics: { layers: layerHeights.length, pathCount: paths.length, filamentLength, filamentVolume: filamentLength * filamentArea },
    preview: {
      shape: config.shape,
      sampleType: config.sampleType,
      sampleLabel: config.specimen?.label ?? null,
      outline: config.specimen && config.sampleOrientation === "flat" ? config.specimen.outline : null,
      width: config.groupWidth,
      depth: config.groupDepth,
      sampleWidth: config.width,
      sampleDepth: config.depth,
      sampleCount: config.sampleCount,
      sampleOrientation: config.sampleOrientation,
      axisCount: config.axisCount,
      bodies: config.placements,
      height: config.height,
      centerX: config.centerX,
      centerY: config.centerY,
      bedWidth: config.bedWidth,
      bedDepth: config.bedDepth,
      bedMinX: config.bedMinX,
      bedMaxX: config.bedMaxX,
      bedMinY: config.bedMinY,
      bedMaxY: config.bedMaxY,
      bedShape: config.bedShape,
      layerCount: layerHeights.length,
      layerHeight: config.layerHeight,
      firstLayerHeight: config.firstLayerHeight,
      lineWidth: config.lineWidth,
      tiltAngle: config.tiltAngle,
      tipDiameter: config.tipDiameter,
      tiltAxis: config.tiltAxis,
      angleMode: config.angleMode,
      orientation: config.orientation,
      cMin: config.cMin,
      cMax: config.cMax,
      rotaryCMode: config.rotaryCMode,
      paths: previewLayers[2].paths,
      layers: previewLayers,
      allLayers: allPreviewLayers,
    },
  };
}
