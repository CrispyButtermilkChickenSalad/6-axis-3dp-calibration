import { generateGcode, minimumLayerHeight } from "./gcode.mjs";
import { createScenePreview } from "./preview.mjs?v=toolpath-colors-2";

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
let generated = null;

function readConfig() {
  const config = Object.fromEntries(new FormData(form).entries());
  config.skirtEnabled = form.elements.namedItem("skirtEnabled").checked;
  form.querySelectorAll('input[type="number"]').forEach((input) => {
    config[input.name] = input.value === "" ? null : Number(input.value);
  });
  return config;
}

function selectedShape() {
  return form.elements.namedItem("shape").value;
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
  for (const [name, visible] of [
    ["width", shape !== "cylinder"],
    ["depth", shape === "cuboid"],
    ["diameter", shape === "cylinder"],
  ]) {
    const field = form.querySelector(`[data-shape-field="${name}"]`);
    field.hidden = !visible;
    field.querySelector("input").disabled = !visible;
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
    const minimum = minimumLayerHeight(config.tipDiameter, config.tiltAngle);
    hint.textContent = `Collision-safe minimum: ${minimum.toFixed(3)} mm at ${config.tiltAngle}° tilt. Layer and first-layer heights must meet this value.`;
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
  updateShapeFields();
  updateBedControls();
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
    document.querySelector("#stat-shape").textContent = `${generated.preview.shape} · ${generated.preview.width} × ${generated.preview.depth} × ${generated.preview.height} mm`;
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
updateClearanceHint();
validateOutputFilename();
