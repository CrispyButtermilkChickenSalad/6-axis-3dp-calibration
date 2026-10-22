import test from "node:test";
import assert from "node:assert/strict";
import { generateGcode, minimumLayerHeight } from "../src/gcode.mjs";
import { mechanicalSpecimen } from "../src/mechanical.mjs";

const baseConfig = {
  shape: "cuboid",
  width: 24,
  depth: 24,
  diameter: 24,
  height: 2,
  wallCount: 2,
  lineWidth: 0.45,
  infillPercent: 15,
  infillAngle: 45,
  infillOverlap: 15,
  solidPattern: "monotonic",
  sparsePattern: "rectilinear",
  bottomLayers: 3,
  topLayers: 3,
  tiltAngle: 25,
  orientation: "trailing",
  tipDiameter: 0.8,
  holeDiameter: 0.4,
  layerHeight: 0.2,
  firstLayerHeight: 0.24,
  extrusionMultiplier: 100,
  filamentDiameter: 1.75,
  axisCount: 4,
  tiltAxis: "A",
  angleMode: "absolute",
  rotaryCMode: "tool",
  firmware: "generic",
  bedShape: "rectangular",
  bedWidth: 220,
  bedDepth: 220,
  centerX: 110,
  centerY: 110,
  originAtCenter: false,
  aMin: -90,
  aMax: 90,
  bMin: -90,
  bMax: 90,
  cMin: -180,
  cMax: 180,
  skirtLoops: 1,
  skirtDistance: 4,
  purgeLine: false,
  firstLayerFan: 0,
  printSpeed: 35,
  firstLayerSpeed: 20,
  hotendTemp: 210,
  bedTemp: 60,
  fanSpeed: 100,
  acceleration: 1500,
  retractDistance: 0.8,
  retractThreshold: 1.5,
  retractSpeed: 35,
  unretractSpeed: 35,
  extraRestart: 0,
  zHop: 0.2,
  firmwareRetraction: false,
  usePressureAdvance: true,
  pressureAdvance: 0.04,
  toolIndex: 0,
  extruderName: "",
  homeAxes: true,
  heatBed: true,
  heatHotend: true,
  startGcode: "",
  endGcode: "",
};

test("computes the physical-tip layer-height clearance", () => {
  assert.ok(Math.abs(minimumLayerHeight(0.8, 30) - 0.2) < 1e-10);
  assert.equal(minimumLayerHeight(0.8, 0), 0);
});

test("generates a cube with walls, solid skins, sparse infill and a preview model", () => {
  const result = generateGcode({ ...baseConfig, shape: "cube", width: 20, depth: 99 });
  assert.match(result.text, /Shape: cube; dimensions: 20 x 20 x 2 mm/);
  assert.match(result.text, /; wall/);
  assert.match(result.text, /; solid infill/);
  assert.match(result.text, /; sparse infill/);
  assert.equal(result.preview.shape, "cube");
  assert.equal(result.metrics.layers, 10);
  assert.ok(result.metrics.pathCount > result.metrics.layers);
});

test("generates a cylinder with circumferential walls and clipped chord infill", () => {
  const result = generateGcode({ ...baseConfig, shape: "cylinder", diameter: 18, width: 90, depth: 90 });
  assert.match(result.text, /Shape: cylinder; dimensions: 18 x 18 x 2 mm/);
  assert.equal(result.preview.shape, "cylinder");
  assert.ok(result.preview.paths.some((path) => path.type === "wall" && path.points.length > 30));
  assert.ok(result.preview.paths.some((path) => path.type === "solid-infill"));
});

test("zero sparse infill and zero skins keep walls without infill paths", () => {
  const solid = generateGcode(baseConfig);
  const wallsOnly = generateGcode({
    ...baseConfig,
    infillPercent: 0,
    topLayers: 0,
    bottomLayers: 0,
  });
  assert.ok(wallsOnly.metrics.pathCount < solid.metrics.pathCount);
  assert.match(wallsOnly.text, /; wall/);
  assert.doesNotMatch(wallsOnly.text, /^G1 .*; (?:solid|sparse) infill$/m);
});

test("100% sparse infill uses the solid infill pattern", () => {
  const result = generateGcode({
    ...baseConfig,
    shape: "cube",
    width: 24,
    height: 1,
    wallCount: 0,
    topLayers: 0,
    bottomLayers: 0,
    infillPercent: 100,
    sparsePattern: "gyroid",
  });
  const types = new Set(result.preview.allLayers.flatMap((layer) => layer.paths.map((path) => path.type)));
  assert.ok(types.has("solid-infill"));
  assert.ok(!types.has("sparse-infill"));
});

test("mechanical samples follow ASTM and ISO dimensions", () => {
  const expected = {
    "tensile astm": [165, 19, 3.2],
    "tensile iso": [170, 20, 4],
    "flexural astm": [127, 12.7, 3.2],
    "flexural iso": [80, 10, 4],
    "impact astm": [63.5, 12.7, 3.2],
    "impact iso": [80, 10, 4],
  };
  for (const [key, [length, width, thickness]] of Object.entries(expected)) {
    const [sample, standard] = key.split(" ");
    const specimen = mechanicalSpecimen(sample, standard);
    assert.equal(specimen.length, length);
    assert.equal(specimen.width, width);
    assert.equal(specimen.thickness, thickness);
    const xs = specimen.outline.map((p) => p.x);
    const ys = specimen.outline.map((p) => p.y);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - length) < 0.01);
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - width) < 0.01);
  }
});

test("mechanical samples generate walls and solid infill at 100% density", () => {
  for (const mechanicalSample of ["tensile", "flexural", "impact"]) {
    const result = generateGcode({
      ...baseConfig,
      sampleType: "mechanical",
      mechanicalSample,
      mechanicalStandard: "astm",
      infillPercent: 100,
    });
    const types = new Set(result.preview.allLayers.flatMap((layer) => layer.paths.map((path) => path.type)));
    assert.ok(types.has("wall"));
    assert.ok(types.has("solid-infill"));
    assert.ok(!types.has("sparse-infill"));
    assert.equal(result.preview.sampleType, "mechanical");
  }
});

test("supports all sparse infill patterns and a wall-free sparse specimen", () => {
  for (const sparsePattern of ["rectilinear", "grid", "triangles", "honeycomb", "cubic", "gyroid"]) {
    const result = generateGcode({
      ...baseConfig,
      shape: "cube",
      width: 24,
      height: 0.2,
      firstLayerHeight: 0.2,
      wallCount: 0,
      topLayers: 0,
      bottomLayers: 0,
      skirtLoops: 0,
      sparsePattern,
    });
    assert.match(result.text, new RegExp(`sparse infill: ${sparsePattern}`));
    assert.ok(result.preview.paths.length > 0, `${sparsePattern} should create infill paths`);
    assert.ok(result.preview.paths.every((path) => path.type === "sparse-infill"));
    assert.equal(result.metrics.pathCount, result.preview.paths.length);
  }
});

test("rectilinear alternates perpendicular layers while grid and triangles keep fixed layer directions", () => {
  const createLayers = (sparsePattern) => generateGcode({
    ...baseConfig,
    height: 1.04,
    wallCount: 0,
    topLayers: 0,
    bottomLayers: 0,
    skirtLoops: 0,
    sparsePattern,
  }).preview.allLayers;
  const directions = (layer) => layer.paths.map(({ points }) => {
    const first = points[0];
    const last = points.at(-1);
    const angle = (Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI + 180) % 180;
    return Math.round(angle * 1e6) / 1e6;
  });
  const matches = (actual, expected) => Math.abs(((actual - expected + 90) % 180 + 180) % 180 - 90) < 1e-6;

  const rectilinear = createLayers("rectilinear");
  assert.ok(directions(rectilinear[0]).every((angle) => matches(angle, 45)));
  assert.ok(directions(rectilinear[1]).every((angle) => matches(angle, 135)));

  const grid = createLayers("grid");
  assert.ok(directions(grid[0]).some((angle) => matches(angle, 45)));
  assert.ok(directions(grid[0]).some((angle) => matches(angle, 135)));
  assert.deepEqual(directions(grid[0]).sort(), directions(grid[1]).sort());

  const triangles = createLayers("triangles");
  const expectedTriangleAngles = [45, 105, 165];
  for (const layer of triangles.slice(0, 2)) {
    for (const expected of expectedTriangleAngles) {
      assert.ok(directions(layer).some((angle) => matches(angle, expected)));
    }
  }
  assert.deepEqual(directions(triangles[0]).sort(), directions(triangles[1]).sort());
});

test("honeycomb shares clipped hexagon edges and preserves the wall overlap inset", () => {
  const result = generateGcode({
    ...baseConfig,
    height: 0.44,
    wallCount: 2,
    topLayers: 0,
    bottomLayers: 0,
    skirtLoops: 0,
    sparsePattern: "honeycomb",
  });
  const layer = result.preview.allLayers[1];
  const infillPaths = layer.paths.filter(({ type }) => type === "sparse-infill");
  const edgeKeys = new Set();
  const insetSpacing = baseConfig.lineWidth - baseConfig.layerHeight * (1 - Math.PI / 4);
  const innermostWallInset = baseConfig.lineWidth / 2 + insetSpacing;
  const infillInset = Math.max(
    baseConfig.lineWidth / 2,
    innermostWallInset + baseConfig.lineWidth * (1 - baseConfig.infillOverlap / 100) - baseConfig.lineWidth / 2,
  );
  const limitX = baseConfig.width / 2 - infillInset;
  const limitY = baseConfig.depth / 2 - infillInset;
  assert.ok(infillPaths.length > 0);
  for (const { points } of infillPaths) {
    for (const { x, y } of points) {
      assert.ok(Math.abs(x - baseConfig.centerX) <= limitX + 1e-5);
      assert.ok(Math.abs(y - baseConfig.centerY) <= limitY + 1e-5);
    }
    for (let index = 1; index < points.length; index += 1) {
      const keys = [points[index - 1], points[index]]
        .map(({ x, y }) => `${Math.round(x * 100000)},${Math.round(y * 100000)}`)
        .sort();
      const edgeKey = keys.join("|");
      assert.equal(edgeKeys.has(edgeKey), false, "a shared hexagon edge must be extruded only once");
      edgeKeys.add(edgeKey);
    }
  }
  assert.ok(
    infillPaths.some(({ points }) => points.some(({ x }) => Math.abs(Math.abs(x - baseConfig.centerX) - limitX) < 1e-4)),
    "hexagon paths should be clipped to the overlap-adjusted wall boundary",
  );
});

test("cubic infill shifts three 120-degree line families by the height-driven triangular phase", () => {
  const result = generateGcode({
    ...baseConfig,
    height: 1.04,
    wallCount: 0,
    topLayers: 0,
    bottomLayers: 0,
    skirtLoops: 0,
    sparsePattern: "cubic",
  });
  const [firstLayer, secondLayer] = result.preview.allLayers;
  const spacing = baseConfig.lineWidth * 100 / baseConfig.infillPercent;
  const lineData = [firstLayer, secondLayer].map(({ paths }) => paths.map(({ points }) => {
    const [first, last] = [points[0], points.at(-1)];
    const angle = (Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI + 180) % 180;
    const normalX = -Math.sin(angle * Math.PI / 180);
    const normalY = Math.cos(angle * Math.PI / 180);
    const offset = ((first.x + last.x) / 2 - baseConfig.centerX) * normalX
      + ((first.y + last.y) / 2 - baseConfig.centerY) * normalY;
    return { angle, residue: ((offset % spacing) + spacing) % spacing };
  }));
  const phaseChange = (secondLayer.z - firstLayer.z) / Math.SQRT2;
  for (const angle of [45, 105, 165]) {
    const residues = lineData.map((layer) => layer
      .filter((line) => Math.abs(line.angle - angle) < 1e-6)
      .map(({ residue }) => residue));
    assert.ok(residues.every((values) => values.length > 0), `cubic should include the ${angle}° line family`);
    const difference = Math.abs(residues[1][0] - residues[0][0]);
    const wrappedDifference = Math.min(difference, spacing - difference);
    assert.ok(
      Math.abs(wrappedDifference - phaseChange) < 1e-5,
      `${angle}° lines should shift by ΔZ / √2 modulo the infill spacing`,
    );
  }
});

test("gyroid infill follows the implicit gyroid surface and changes with layer height", () => {
  const result = generateGcode({
    ...baseConfig,
    height: 0.44,
    wallCount: 0,
    topLayers: 0,
    bottomLayers: 0,
    skirtLoops: 0,
    sparsePattern: "gyroid",
  });
  const [firstLayer, secondLayer] = result.preview.allLayers;
  const period = baseConfig.lineWidth * 3 / Math.sqrt(baseConfig.infillPercent / 100);
  const angle = baseConfig.infillAngle * Math.PI / 180;
  const residuals = firstLayer.paths.flatMap(({ points }) => points
    .filter(({ x, y }) => Math.abs(x - baseConfig.centerX) < 10 && Math.abs(y - baseConfig.centerY) < 10)
    .map(({ x, y }) => {
      const localX = x - baseConfig.centerX;
      const localY = y - baseConfig.centerY;
      const rotatedX = (localX * Math.cos(angle) + localY * Math.sin(angle)) * 2 * Math.PI / period;
      const rotatedY = (-localX * Math.sin(angle) + localY * Math.cos(angle)) * 2 * Math.PI / period;
      const rotatedZ = firstLayer.z * 2 * Math.PI / period;
      return Math.abs(
        Math.sin(rotatedX) * Math.cos(rotatedY)
        + Math.sin(rotatedY) * Math.cos(rotatedZ)
        + Math.sin(rotatedZ) * Math.cos(rotatedX),
      );
    }));
  assert.ok(firstLayer.paths.some(({ points }) => points.length > 4));
  assert.ok(residuals.length > 0);
  assert.ok(Math.max(...residuals) < 0.15, "sampled paths should follow the gyroid zero surface");
  assert.notDeepEqual(firstLayer.paths, secondLayer.paths);
});

test("honeycomb clips shared cells to both rectangular and circular perimeters", () => {
  for (const shape of ["cuboid", "cylinder"]) {
    const result = generateGcode({
      ...baseConfig,
      shape,
      height: 0.44,
      wallCount: 2,
      topLayers: 0,
      bottomLayers: 0,
      skirtLoops: 0,
      sparsePattern: "honeycomb",
    });
    const paths = result.preview.allLayers[1].paths.filter(({ type }) => type === "sparse-infill");
    const insetSpacing = baseConfig.lineWidth - baseConfig.layerHeight * (1 - Math.PI / 4);
    const wallInset = baseConfig.lineWidth / 2 + insetSpacing;
    const infillInset = Math.max(
      baseConfig.lineWidth / 2,
      wallInset + baseConfig.lineWidth * (1 - baseConfig.infillOverlap / 100) - baseConfig.lineWidth / 2,
    );
    const limitX = baseConfig.width / 2 - infillInset;
    const limitY = baseConfig.depth / 2 - infillInset;
    assert.ok(paths.length > 0);
    for (const { points } of paths) {
      for (const { x, y } of points) {
        const localX = x - baseConfig.centerX;
        const localY = y - baseConfig.centerY;
        assert.ok(Math.abs(localX) <= limitX + 1e-5);
        assert.ok(Math.abs(localY) <= limitY + 1e-5);
        if (shape === "cylinder") {
          assert.ok(Math.hypot(localX, localY) <= limitX + 1e-5);
        }
      }
    }
  }
});

test("monotonic infill connects scanlines and concentric skins form nested loops", () => {
  const monotonic = generateGcode({
    ...baseConfig,
    height: 0.2,
    firstLayerHeight: 0.2,
    wallCount: 0,
    topLayers: 0,
    bottomLayers: 0,
    skirtLoops: 0,
    infillPercent: 10,
  });
  assert.equal(monotonic.preview.paths.length, 1);
  const concentric = generateGcode({ ...baseConfig, solidPattern: "concentric" });
  assert.ok(concentric.preview.paths.filter((path) => path.type === "solid-infill").length > 1);
});

test("wall centerlines use Slic3r's normal overlap compensation", () => {
  const result = generateGcode({
    ...baseConfig,
    height: 0.5,
    firstLayerHeight: 0.3,
    wallCount: 3,
  });
  const wallMinX = (paths) => paths
    .filter(({ type }) => type === "wall")
    .map(({ points }) => Math.min(...points.map(({ x }) => x)))
    .sort((left, right) => left - right);
  const firstLayerWallMinX = wallMinX(result.preview.layers[0].paths);
  const regularLayerWallMinX = wallMinX(result.preview.layers[2].paths);
  const firstLayerSpacing = baseConfig.lineWidth - 0.3 * (1 - Math.PI / 4);
  const regularLayerSpacing = baseConfig.lineWidth - baseConfig.layerHeight * (1 - Math.PI / 4);
  assert.equal(firstLayerWallMinX.length, 3);
  assert.equal(regularLayerWallMinX.length, 3);
  assert.ok(Math.abs((firstLayerWallMinX[1] - firstLayerWallMinX[0]) - firstLayerSpacing) < 1e-6);
  assert.ok(Math.abs((regularLayerWallMinX[1] - regularLayerWallMinX[0]) - regularLayerSpacing) < 1e-6);
  assert.ok(Math.abs((regularLayerWallMinX[2] - regularLayerWallMinX[1]) - regularLayerSpacing) < 1e-6);

  const concentric = generateGcode({
    ...baseConfig,
    height: 0.2,
    firstLayerHeight: 0.2,
    wallCount: 2,
    solidPattern: "concentric",
  });
  const layerPaths = concentric.preview.layers[0].paths;
  const innermostWallX = Math.max(...layerPaths
    .filter(({ type }) => type === "wall")
    .map(({ points }) => Math.min(...points.map(({ x }) => x))));
  const outermostSolidX = Math.min(...layerPaths
    .filter(({ type }) => type === "solid-infill")
    .map(({ points }) => Math.min(...points.map(({ x }) => x))));
  assert.ok(Math.abs(
    (outermostSolidX - innermostWallX) - baseConfig.lineWidth * (1 - baseConfig.infillOverlap / 100),
  ) < 1e-6);
});

test("accepts zero walls and zero top and bottom layers", () => {
  const result = generateGcode({
    ...baseConfig,
    wallCount: 0,
    topLayers: 0,
    bottomLayers: 0,
    height: 0.2,
    firstLayerHeight: 0.2,
  });
  assert.doesNotMatch(result.text, /^G1 .*; wall$/m);
  assert.match(result.text, /^G1 .*; sparse infill$/m);
});

test("adaptive orientation requires a fifth axis and emits bead-relative A/B motion", () => {
  assert.throws(() => generateGcode({ ...baseConfig, angleMode: "adaptive" }), /at least a 5-axis/);
  const result = generateGcode({ ...baseConfig, axisCount: 5, angleMode: "adaptive" });
  assert.match(result.text, /angle mode: adaptive/);
  assert.match(result.text, /A[-\d.]+ B[-\d.]+/);
});

test("six-axis adaptive motion emits opposite C directions for tool and bed rotation", () => {
  const tool = generateGcode({ ...baseConfig, axisCount: 6, angleMode: "adaptive", rotaryCMode: "tool" });
  const bed = generateGcode({ ...baseConfig, axisCount: 6, angleMode: "adaptive", rotaryCMode: "bed" });
  assert.match(tool.text, /C-180/);
  assert.match(bed.text, /C180/);
});

test("tool C rotation stays inside configured limits and bed C ignores tool limits", () => {
  const constrained = generateGcode({
    ...baseConfig,
    axisCount: 6,
    angleMode: "adaptive",
    cMin: -360,
    cMax: 360,
    rotaryCMode: "tool",
  });
  const cMoves = [...constrained.text.matchAll(/\bC(-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  assert.ok(cMoves.length > 0);
  assert.ok(cMoves.every((angle) => angle >= -360 && angle <= 360));
  assert.throws(() => generateGcode({
    ...baseConfig,
    axisCount: 6,
    angleMode: "adaptive",
    cMin: -1,
    cMax: 1,
    rotaryCMode: "tool",
  }), /no equivalent within configured limits/);
  const bed = generateGcode({
    ...baseConfig,
    axisCount: 6,
    angleMode: "adaptive",
    cMin: -1,
    cMax: 1,
    rotaryCMode: "bed",
  });
  assert.match(bed.text, /\bC-?180\b/);
});

test("preview layers expose first-layer skirt and purge, middle, and last paths", () => {
  const result = generateGcode({ ...baseConfig, purgeLine: true, skirtLoops: 2 });
  assert.deepEqual(result.preview.layers.map(({ name }) => name), [
    "FIRST LAYER",
    "MIDDLE LAYER",
    "LAST LAYER",
  ]);
  assert.ok(result.preview.layers[0].paths.some(({ type }) => type === "purge"));
  assert.ok(result.preview.layers[0].paths.some(({ type }) => type === "skirt"));
  assert.equal(result.preview.layers[2].number, result.metrics.layers);
  assert.equal(result.preview.allLayers.length, result.metrics.layers);
  assert.equal(result.preview.allLayers[0].number, 1);
  assert.equal(result.preview.allLayers.at(-1).number, result.metrics.layers);
  assert.ok(result.preview.allLayers.every((layer) => layer.paths.every((path) => Number.isFinite(path.z))));
});

test("preview data exposes every selectable layer and the first, middle, and last anchors", () => {
  const result = generateGcode({ ...baseConfig, height: 2.1 });
  assert.equal(result.metrics.layers, 11);
  assert.deepEqual(result.preview.layers.map(({ number }) => number), [1, 6, 11]);
  assert.equal(result.preview.allLayers.length, 11);
  assert.ok(result.preview.allLayers[0].z < result.preview.allLayers[5].z);
  assert.ok(result.preview.allLayers[5].z < result.preview.allLayers[10].z);
});

test("optional purge priming uses two overlapping minimum-length lines at 200% flow", () => {
  const result = generateGcode({
    ...baseConfig,
    purgeLine: true,
    minimumPurgeLength: 40,
    purgeMultiplier: 200,
    skirtEnabled: false,
  });
  const purgePath = result.preview.layers[0].paths.find(({ type }) => type === "purge");
  assert.ok(purgePath);
  assert.equal(purgePath.points.length, 4);
  assert.equal(Math.hypot(
    purgePath.points[1].x - purgePath.points[0].x,
    purgePath.points[1].y - purgePath.points[0].y,
  ), 40);
  const expectedSpacing = baseConfig.lineWidth - baseConfig.firstLayerHeight * (1 - Math.PI / 4);
  assert.ok(Math.abs(Math.abs(purgePath.points[2].y - purgePath.points[1].y) - expectedSpacing) < 1e-6);
  assert.equal(result.preview.layers[0].paths.some(({ type }) => type === "skirt"), false);

  const firstPurgeExtrusion = Number(result.text.match(/^G1 .* E(-?\d+(?:\.\d+)?) .*; purge$/m)[1]);
  const beadArea = (baseConfig.lineWidth - baseConfig.firstLayerHeight) * baseConfig.firstLayerHeight
    + Math.PI * (baseConfig.firstLayerHeight / 2) ** 2;
  const filamentArea = Math.PI * (baseConfig.filamentDiameter / 2) ** 2;
  const expectedExtrusion = beadArea * 2 * 40 / filamentArea;
  assert.ok(Math.abs(firstPurgeExtrusion - expectedExtrusion) < 0.002);
});

test("validates rotary limits, nozzle clearance and bed fit", () => {
  assert.throws(() => generateGcode({ ...baseConfig, aMax: 10 }), /outside configured limits/);
  assert.throws(() => generateGcode({ ...baseConfig, tiltAngle: 40, tipDiameter: 1 }), /Layer height must be at least/);
  assert.throws(() => generateGcode({ ...baseConfig, centerX: 10 }), /falls outside the configured bed/);
  assert.throws(() => generateGcode({
    ...baseConfig,
    lineWidth: 0.1,
    layerHeight: 0.5,
    firstLayerHeight: 0.5,
  }), /overlap compensation/);
});

test("supports firmware retraction, optional pressure advance, purge, skirt and custom code", () => {
  const result = generateGcode({
    ...baseConfig,
    firmware: "klipper",
    firmwareRetraction: true,
    usePressureAdvance: false,
    purgeLine: true,
    skirtLoops: 2,
    startGcode: "G28\nM104 S[HOTEND_TEMP]",
    endGcode: "M140 S0",
  });
  assert.match(result.text, /M104 S210/);
  assert.match(result.text, /G10 ; firmware retract/);
  assert.doesNotMatch(result.text, /SET_PRESSURE_ADVANCE/);
  assert.match(result.text, /; purge/);
  assert.match(result.text, /; skirt/);
  assert.match(result.text, /Custom end G-code/);
  assert.doesNotMatch(result.text, /turn off part cooling fan/);
});

test("default end code switches off the part cooling fan and first layer uses standard line width", () => {
  const result = generateGcode({ ...baseConfig, firstLayerHeight: 0.3 });
  assert.match(result.text, /M107 ; turn off part cooling fan/);
  const firstExtrusion = result.text.split("\n").find((line) => /^G1 .*; skirt$/.test(line));
  assert.ok(firstExtrusion);
  const e = Number(firstExtrusion.match(/\bE([\d.]+)/)[1]);
  const expected = ((0.45 - 0.3) * 0.3 + Math.PI * (0.3 / 2) ** 2)
    / (Math.PI * (1.75 / 2) ** 2) * 32;
  assert.ok(Math.abs(e - expected) < 0.002);
});

test("rejects control characters in custom G-code", () => {
  assert.throws(() => generateGcode({ ...baseConfig, startGcode: "G28\u0000" }), /control characters/);
});

test("requires a Klipper extruder name for a non-default tool", () => {
  assert.throws(() => generateGcode({ ...baseConfig, firmware: "klipper", toolIndex: 1 }), /enter its extruder name/);
  const result = generateGcode({ ...baseConfig, firmware: "klipper", toolIndex: 1, extruderName: "extruder1" });
  assert.match(result.text, /SET_PRESSURE_ADVANCE EXTRUDER=extruder1 ADVANCE=0.04/);
});

test("3-axis machines generate with no rotary words even when a tilt is entered", () => {
  const result = generateGcode({ ...baseConfig, axisCount: 3, tiltAngle: 25, angleMode: "adaptive" });
  assert.doesNotMatch(result.text, /\b[ABC]-?\d/);
  assert.equal(result.preview.tiltAngle, 0);
  assert.match(result.text, /no rotary axes/);
});

test("mechanical samples support orientation, count, spacing and one group skirt", () => {
  const flat = { ...baseConfig, sampleType: "mechanical", mechanicalSample: "flexural", mechanicalStandard: "astm", infillPercent: 100, wallCount: 2, height: 3.2, skirtLoops: 1 };
  const single = generateGcode(flat);
  assert.equal(single.preview.height, 3.2);
  const four = generateGcode({ ...flat, sampleCount: 4, sampleSpacing: 4 });
  assert.equal(four.preview.sampleCount, 4);
  assert.equal(four.preview.bodies.length, 4);
  const skirts = four.preview.allLayers[0].paths.filter((path) => path.type === "skirt");
  assert.equal(skirts.length, 1);
  const xs = skirts[0].points.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > four.preview.sampleWidth);
  const side = generateGcode({ ...flat, mechanicalOrientation: "side" });
  assert.ok(Math.abs(side.preview.height - 12.7) < 1e-6);
  const upright = generateGcode({ ...flat, mechanicalOrientation: "upright" });
  assert.ok(Math.abs(upright.preview.height - 127) < 1e-6);
});

test("rejects more mechanical samples than fit on the bed", () => {
  assert.throws(() => generateGcode({
    ...baseConfig, sampleType: "mechanical", mechanicalSample: "tensile", mechanicalStandard: "astm",
    infillPercent: 100, sampleCount: 10, sampleSpacing: 4,
  }), /At most \d+ fit/);
});
