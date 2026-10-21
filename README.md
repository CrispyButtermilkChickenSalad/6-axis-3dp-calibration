# 6-axis-3dp-calibration

Testing g-code generation for up to 6-axis capable motion platforms for 3D printing.

## Primitive G-code generator

A static browser tool for generating simple cube, cuboid and cylinder test prints with configurable perimeters, solid skins, sparse infill and nozzle tilt. It carries forward the nozzle angle calibration setup: nozzle-tip collision clearance, tip and hole diameters, layer height, extrusion multiplier, bead-relative orientation choices, machine rotary axes and limits, bed placement, temperatures, motion speeds, retraction distance/threshold/speeds, Z-hop, pressure advance, purge/skirt and custom start/end G-code.

Solid skin infill can be monotonic (connected alternating scanlines) or concentric. Sparse infill supports rectilinear, grid, triangles, honeycomb, cubic and gyroid patterns; density and infill-to-wall overlap are configurable. Wall-to-wall path spacing uses the flow compensation described in the [Slic3r flow math guide](https://manual.slic3r.org/advanced/flow-math): `lineWidth - layerHeight * (1 - π/4)`. Cubic and gyroid are computationally light approximations for calibration specimens, not implementations of a production slicer's volumetric infill or machine-specific 3D toolpath planning. Top and bottom layer counts are editable and linked to their displayed thickness using the regular layer height. Zero walls and zero skin layers are supported for sparse-only specimens.

## Run locally

Open `index.html` from a local static web server, for example:

```sh
python -m http.server 8000
```

Then browse to `http://localhost:8000`. The generator has no build step or runtime dependency. Run the focused generator tests with `npm test` (Node.js built-in test runner).

## Machine and G-code notes

The standard 3-axis option emits no rotary motion when tilt is zero. Absolute tilt emits the selected A or B angle, independent of extrusion direction. Adaptive tilt requires at least five axes and calculates A/B values for each extrusion segment using the selected trailing, leading, adjacent or hybrid orientation; a six-axis configuration additionally emits C-axis heading. Tool C chooses the nearest equivalent angle inside configured physical limits and rejects unsupported headings rather than bypassing the limits. Bed rotation reverses and wraps the C direction; tool C limits do not apply to bed C, whose physical travel and cable clearance must be checked on the machine. Circular and rectangular bed fit, purge line, skirt and nozzle-tip clearance are also validated. Firmware startup can independently home, heat the bed and heat the hotend; custom start/end blocks replace the generated blocks.

The generated file is a starting point, not a printer-independent slicing format. The C bed/tool option changes the emitted C direction only; it does not solve machine-specific inverse kinematics or compensate XY for a moving bed. Axis letter conventions, rotary kinematics, firmware-specific pressure advance and retraction, homing, temperature commands and custom start/end code must be verified against the target machine. A custom start or end block replaces that block's generated commands. Custom G-code supports `[BED_TEMP]`, `[HOTEND_TEMP]` and `[TOOL_INDEX]` placeholders.

The 3D preview is an approximation of the model and selected first, middle or last layer; its slider changes the viewed layer without redrawing every layer. The first-layer view includes purge and skirt paths. Left-drag moves the preview nozzle only; right-drag orbits the view. These preview-only interactions do not change generated G-code. The light/dark theme toggle keeps the application local and stateless. Values for layer height and extrusion multiplier are editable starting values informed by the associated nozzle-angle calibration workflow, not automatic calibration results.
