# 6-axis 3D-printing calibration

Open the [Primitive G-code Generator](https://crispybuttermilkchickensalad.github.io/6-axis-3dp-calibration/) in your browser.

Mechanical tensile specimens include ASTM D638 Type I and the smaller Type V, as well as ISO 527-2 Type 1A. Type V uses less material and typically prints faster; verify specimen dimensions, thickness, testing apparatus, and standard requirements for your application.

The nozzle-clearance minimum can be overridden for regular layers only by explicitly accepting the collision risk. This can cause the tilted nozzle to strike the print or machine; verify clearance and simulate or dry-run before printing. The first-layer minimum and other layer-height limits remain enforced.

See the [Generator Mathematics wiki](https://github.com/CrispyButtermilkChickenSalad/6-axis-3dp-calibration/wiki/Generator-Mathematics) for setup instructions, implementation details, calculations, and machine safety notes.
