import { generateGcode, minimumLayerHeight } from "./gcode.mjs?v=mechanical-2";
import { mechanicalSpecimen } from "./mechanical.mjs?v=mechanical-2";
import { orientedSpecimen } from "./orientation.mjs?v=mechanical-2";
import { createScenePreview } from "./preview.mjs?v=mechanical-2";

const form = document.querySelector("#generator-form");
const errorBox = document.querySelector("#form-error");
const downloadButton = document.querySelector("#download-button");
const outputFilename = document.querySelector("#output-filename");
const outputFilenameHint = document.querySelector("#output-filename-hint");
const codePreview = document.querySelector("#preview-code");
const statusBadge = document.querySelector("#status-badge");
const preview = createScenePreview(document.querySelector("#preview-scene"));
const layerSlider = document.querySelector("#preview-layer-slider");
const layerLabel = document.querySelector("#preview-layer-label");
const layerTicks = document.querySelector("#preview-layer-ticks");
const pathColorToggle = document.querySelector("#path-color-toggle");
const solidViewToggle = document.querySelector("#solid-view-toggle");
const solidViewWarning = document.querySelector("#solid-view-warning");
let generated = null;

function readConfig() {
  const config = Object.fromEntries(new FormData(form).entries());
  config.skirtEnabled = form.elements.namedItem("skirtEnabled").checked;
  form.querySelectorAll('input[type="number"]').forEach((input) => {
    config[input.name] = input.value === "" ? null : Number(input.value);
  });
  config.orientation = form.elements.namedItem("orientation").value;
  config.angleMode = form.elements.namedItem("angleMode").value;
  const axisCount = Number(form.elements.namedItem("axisCount").value);
  const rotaryA = form.elements.namedItem("rotaryA").checked;
  const rotaryB = form.elements.namedItem("rotaryB").checked;
  config.tiltAxis = axisCount < 4 ? "A" : axisCount === 4 ? (rotaryB && !rotaryA ? "B" : "A") : form.elements.namedItem("tiltAxis").value;
  return config;
}

function updateAxisControls(event) {
  const axisCount = Number(form.elements.namedItem("axisCount").value);
  const checks = { A: form.elements.namedItem("rotaryA"), B: form.elements.namedItem("rotaryB"), C: form.elements.namedItem("rotaryC") };
  const tiltAxis = form.elements.namedItem("tiltAxis");
  const name = event?.target?.name;
  if (name === "rotaryA" || name === "rotaryB") {
    tiltAxis.value = name === "rotaryA" ? "A" : "B";
  }
  if (axisCount === 4) {
    checks.A.checked = tiltAxis.value === "A";
    checks.B.checked = tiltAxis.value === "B";
    checks.C.checked = false;
  } else {
    checks.A.checked = axisCount >= 5;
    checks.B.checked = axisCount >= 5;
    checks.C.checked = axisCount >= 6;
  }
  checks.A.disabled = axisCount !== 4;
  checks.B.disabled = axisCount !== 4;
  checks.C.disabled = true;
  document.querySelector("#rotary-axes").classList.toggle("is-disabled", axisCount < 4);
  tiltAxis.disabled = axisCount < 5;
  document.querySelector("#tilt-axis-field").classList.toggle("is-disabled", axisCount < 5);
  const noRotary = axisCount < 4;
  form.elements.namedItem("tiltAngle").disabled = noRotary;
  form.elements.namedItem("tiltAngle").closest("label").classList.toggle("is-disabled", noRotary);
  ["orientation", "angleMode"].forEach((group) => {
    const radios = form.querySelectorAll(`input[name="${group}"]`);
    radios.forEach((radio) => { radio.disabled = noRotary; });
    radios[0].closest("fieldset").classList.toggle("is-disabled", noRotary);
  });
  if (noRotary) form.querySelector('input[name="angleMode"][value="absolute"]').checked = true;
  ["aMin", "aMax", "bMin", "bMax"].forEach((limit) => {
    const input = form.elements.namedItem(limit);
    input.disabled = noRotary;
    input.closest("label").classList.toggle("is-disabled", noRotary);
  });
}

function selectedShape() {
  return form.elements.namedItem("shape").value || "cuboid";
}

function selectedSampleType() {
  return form.elements.namedItem("sampleType").value;
}

function validateOutputFilename() {
  const valid = /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]*[A-Za-z0-9_-])?$/.test(outputFilename.value);
  outputFilename.setCustomValidity(valid ? "" : "Use letters, numbers, spaces, dots, underscores, and hyphens; do not end with a dot or space.");
  outputFilenameHint.textContent = valid
    ? "Choose a file name without the .gcode extension."
    : "Use letters, numbers, spaces, dots, underscores, and hyphens; do not end with a dot or space.";
  return valid;
}

function updateShapeFields() {
  const shape = selectedShape();
  const mechanical = selectedSampleType() === "mechanical";
  form.querySelector("#primitive-options").hidden = mechanical;
  form.querySelector("#mechanical-options").hidden = !mechanical;
  form.querySelectorAll('input[name="shape"]').forEach((input) => { input.disabled = mechanical; });
  form.querySelectorAll('[name="mechanicalSample"], [name="mechanicalStandard"], [name="mechanicalOrientation"], [name="sampleCount"], [name="sampleSpacing"]').forEach((input) => { input.disabled = !mechanical; });
  form.elements.namedItem("height").disabled = mechanical;
  for (const [name, visible] of [
    ["width", shape !== "cylinder"],
    ["depth", shape === "cuboid"],
    ["diameter", shape === "cylinder"],
  ]) {
    const field = form.querySelector(`[data-shape-field="${name}"]`);
    field.hidden = !visible;
    field.querySelector("input").disabled = !visible || mechanical;
  }
  if (mechanical) {
    const specimen = mechanicalSpecimen(
      form.elements.namedItem("mechanicalSample").value,
      form.elements.namedItem("mechanicalStandard").value,
    );
    document.querySelector("#mechanical-dimensions").textContent = describeSpecimen(specimen);
    const oriented = orientedSpecimen(specimen, form.elements.namedItem("mechanicalOrientation").value);
    document.querySelector("#mechanical-layout").textContent =
      `${form.elements.namedItem("mechanicalOrientation").value} orientation: footprint ${oriented.width.toFixed(1)} × ${oriented.depth.toFixed(1)} mm, build height ${oriented.height.toFixed(1)} mm per sample. Samples are arranged automatically to fit the bed, skirt and purge line, with one skirt around the whole group.`;
  }
}

function describeSpecimen(specimen) {
  const { spec } = specimen;
  const overall = `${specimen.length} × ${specimen.width} × ${specimen.thickness} mm overall`;
  if (specimen.key === "tensile") {
    return `${spec.label}: ${overall}; narrow section ${spec.narrowWidth} × ${spec.narrowLength} mm, shoulder radius ${spec.radius} mm, gauge length ${spec.gauge} mm, grip distance ${spec.grip} mm.`;
  }
  if (specimen.key === "flexural") {
    return `${spec.label}: ${overall}; 16:1 support span ${spec.span} mm.`;
  }
  return `${spec.label}: ${overall}; ${spec.notchAngle}° notch ${spec.notchDepth} mm deep, ${spec.notchRadius} mm tip radius, ${(spec.width - spec.notchDepth).toFixed(2)} mm remaining.`;
}

let primitiveInfillPercent = null;
function applyMechanicalDefaults(event) {
  const infill = form.elements.namedItem("infillPercent");
  const name = event.target?.name;
  if (name === "sampleType") {
    if (selectedSampleType() === "mechanical") {
      primitiveInfillPercent = infill.value;
      infill.value = "100";
    } else if (primitiveInfillPercent !== null) {
      infill.value = primitiveInfillPercent;
      primitiveInfillPercent = null;
    }
  } else if (name === "mechanicalSample") {
    infill.value = "100";
  }
}

function updateBedControls() {
  const bedShape = form.elements.namedItem("bedShape");
  const bedDepth = form.elements.namedItem("bedDepth");
  const centerX = form.elements.namedItem("centerX");
  const centerY = form.elements.namedItem("centerY");
  const bedWidth = Number(form.elements.namedItem("bedWidth").value);
  const bedHeight = bedShape.value === "circular" ? bedWidth : Number(bedDepth.value);
  const centered = form.elements.namedItem("originAtCenter").checked;
  bedDepth.disabled = bedShape.value === "circular";
  bedDepth.closest("label").classList.toggle("is-disabled", bedDepth.disabled);
  form.elements.namedItem("bedWidth").closest("label").querySelector("span").firstChild.nodeValue =
    bedShape.value === "circular" ? "Bed diameter " : "Bed width X ";
  centerX.min = String(centered ? -bedWidth / 2 : 0);
  centerX.max = String(centered ? bedWidth / 2 : bedWidth);
  centerY.min = String(centered ? -bedHeight / 2 : 0);
  centerY.max = String(centered ? bedHeight / 2 : bedHeight);
  const axisCount = Number(form.elements.namedItem("axisCount").value);
  const rotaryCMode = form.elements.namedItem("rotaryCMode");
  const adaptive = form.querySelector('input[name="angleMode"][value="adaptive"]');
  adaptive.disabled = axisCount < 5;
  if (adaptive.disabled && form.elements.namedItem("angleMode").value === "adaptive") {
    form.querySelector('input[name="angleMode"][value="absolute"]').checked = true;
  }
  rotaryCMode.disabled = axisCount < 6;
  const cLimits = document.querySelector("#c-axis-limits");
  const cLimitsDisabled = axisCount < 6 || rotaryCMode.value === "bed";
  cLimits.querySelectorAll("input").forEach((input) => { input.disabled = cLimitsDisabled; });
  cLimits.classList.toggle("is-disabled", cLimitsDisabled);
  document.querySelector("#c-axis-hint").textContent = rotaryCMode.value === "bed"
    ? "Bed rotation reverses C direction and wraps to ±180°; tool C-axis limits do not apply. Verify the bed's own physical travel and cable clearance."
    : "In 6-axis adaptive tool-rotation mode, C follows the bead heading and is kept within these physical limits. Unsupported headings are rejected; limits are never bypassed.";
}

function updateClearanceHint() {
  const config = readConfig();
  const hint = document.querySelector("#clearance-hint");
  try {
    const minimum = minimumLayerHeight(config.tipDiameter, form.elements.namedItem("axisCount").value < 4 ? 0 : config.tiltAngle);
    hint.textContent = `Collision-safe minimum: ${minimum.toFixed(3)} mm at ${form.elements.namedItem("axisCount").value < 4 ? 0 : config.tiltAngle}° tilt. Layer and first-layer heights must meet this value.`;
    hint.classList.toggle("is-warning", config.layerHeight < minimum || config.firstLayerHeight < minimum);
  } catch {
    hint.textContent = "Enter valid nozzle-tip and tilt values to calculate the collision-safe layer-height minimum.";
    hint.classList.remove("is-warning");
  }
}

function syncSkinFields(target) {
  const layerHeight = Number(form.elements.namedItem("layerHeight").value);
  if (!Number.isFinite(layerHeight) || layerHeight <= 0) return;
  const pairs = [
    ["bottomLayers", "bottomThickness"],
    ["topLayers", "topThickness"],
  ];
  for (const [layerName, thicknessName] of pairs) {
    const layers = form.elements.namedItem(layerName);
    const thickness = form.elements.namedItem(thicknessName);
    if (target === layers) {
      thickness.value = (Number(layers.value) * layerHeight).toFixed(2);
    } else if (target === thickness) {
      const count = Math.round(Number(thickness.value) / layerHeight + 1e-9);
      layers.value = String(count);
      thickness.value = (count * layerHeight).toFixed(2);
    } else if (target === form.elements.namedItem("layerHeight")) {
      thickness.value = (Number(layers.value) * layerHeight).toFixed(2);
    }
  }
}

function invalidate() {
  generated = null;
  downloadButton.disabled = true;
  layerSlider.disabled = true;
  layerLabel.textContent = "Generate a toolpath to inspect layers";
  statusBadge.innerHTML = '<span class="status-dot"></span> REGENERATE';
  statusBadge.classList.remove("is-ready");
  errorBox.hidden = true;
  updateClearanceHint();
}

form.addEventListener("change", (event) => {
  syncSkinFields(event.target);
  if (event.target?.name === "originAtCenter") {
    const centered = form.elements.namedItem("originAtCenter").checked;
    const bedWidth = Number(form.elements.namedItem("bedWidth").value);
    const bedDepth = form.elements.namedItem("bedShape").value === "circular"
      ? bedWidth
      : Number(form.elements.namedItem("bedDepth").value);
    const offset = centered ? -1 : 1;
    form.elements.namedItem("centerX").value = String(Number(form.elements.namedItem("centerX").value) + offset * bedWidth / 2);
    form.elements.namedItem("centerY").value = String(Number(form.elements.namedItem("centerY").value) + offset * bedDepth / 2);
  }
  applyMechanicalDefaults(event);
  updateShapeFields();
  updateBedControls();
  updateAxisControls(event);
  invalidate();
});
form.addEventListener("input", invalidate);
document.querySelector("#reset-view").addEventListener("click", () => preview.reset());
const themeToggle = document.querySelector("#theme-toggle");
themeToggle.addEventListener("click", () => {
  const isDark = document.body.dataset.theme !== "dark";
  document.body.dataset.theme = isDark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = isDark ? "#1c1821" : "#f5f2f8";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.innerHTML = isDark ? '<span aria-hidden="true">☼</span> Light mode' : '<span aria-hidden="true">◐</span> Dark mode';
  preview.refresh();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  try {
    generated = generateGcode(readConfig());
    preview.update(generated.preview);
    preview.setColorByType(pathColorToggle.checked);
    preview.setSolidView(solidViewToggle.checked);
    const layers = generated.preview.allLayers;
    const lastIndex = layers.length - 1;
    const middleIndex = Math.floor(lastIndex / 2);
    layerSlider.max = String(lastIndex);
    layerSlider.value = String(lastIndex);
    layerTicks.replaceChildren();
    const sliderTicks = [{ index: 0, label: "FIRST" }];
    if (lastIndex > 1) sliderTicks.push({ index: middleIndex, label: "MIDDLE" });
    if (lastIndex > 0) sliderTicks.push({ index: lastIndex, label: "LAST" });
    sliderTicks.forEach(({ index, label }) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.label = label;
      layerTicks.append(option);
    });
    layerSlider.disabled = false;
    updateLayerPreview(lastIndex);
    const p = generated.preview;
    const count = p.sampleCount > 1 ? ` × ${p.sampleCount}` : "";
    const orient = p.sampleType === "mechanical" ? ` (${p.sampleOrientation})` : "";
    document.querySelector("#stat-shape").textContent = `${p.sampleLabel || p.shape}${count}${orient} · ${p.sampleWidth} × ${p.sampleDepth} × ${p.height} mm`;
    document.querySelector("#stat-layers").textContent = String(generated.metrics.layers).padStart(2, "0");
    document.querySelector("#stat-paths").textContent = String(generated.metrics.pathCount);
    document.querySelector("#stat-filament").textContent = `${(generated.metrics.filamentLength / 1000).toFixed(2)} m`;
    codePreview.textContent = generated.text;
    document.querySelector("#code-line-count").textContent = `${generated.text.trimEnd().split("\n").length} lines`;
    statusBadge.innerHTML = '<span class="status-dot"></span> PATH READY';
    statusBadge.classList.add("is-ready");
    downloadButton.disabled = false;
  } catch (error) {
    generated = null;
    downloadButton.disabled = true;
    statusBadge.innerHTML = '<span class="status-dot"></span> CHECK SETUP';
    statusBadge.classList.remove("is-ready");
    errorBox.textContent = error instanceof Error ? error.message : String(error);
    errorBox.hidden = false;
  }
});

function updateLayerPreview(value) {
  if (!generated) return;
  const index = Number(value);
  preview.setLayer(index);
  const layer = generated.preview.allLayers[index];
  const lastIndex = generated.preview.allLayers.length - 1;
  const anchor = index === 0 ? "FIRST LAYER"
    : index === lastIndex ? "LAST LAYER"
      : index === Math.floor(lastIndex / 2) ? "MIDDLE LAYER"
        : `LAYER ${layer.number}`;
  layerLabel.textContent = `${anchor} · ${layer.number}/${generated.metrics.layers} · Z ${layer.z.toFixed(2)} mm`;
}

layerSlider.addEventListener("input", () => updateLayerPreview(layerSlider.value));
solidViewToggle.addEventListener("change", () => {
  if (solidViewToggle.checked && !window.confirm("Simulated solid draws every bead with shading and may slow the preview and this whole page, especially for tall or dense specimens. Turn it on anyway?")) {
    solidViewToggle.checked = false;
  }
  solidViewWarning.hidden = !solidViewToggle.checked;
  preview.setSolidView(solidViewToggle.checked);
});
pathColorToggle.addEventListener("change", () => {
  preview.setColorByType(pathColorToggle.checked);
  document.querySelector(".preview-legend").classList.toggle("is-uniform", !pathColorToggle.checked);
});

downloadButton.addEventListener("click", () => {
  if (!generated) return;
  validateOutputFilename();
  if (!outputFilename.reportValidity()) return;
  const blob = new Blob([generated.text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${outputFilename.value.trim()}.gcode`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

outputFilename.addEventListener("input", validateOutputFilename);

updateShapeFields();
updateBedControls();
updateAxisControls();
updateClearanceHint();
validateOutputFilename();
