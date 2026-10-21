import test from "node:test";
import assert from "node:assert/strict";
import { generateGcode, minimumLayerHeight } from "../src/gcode.mjs";

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
