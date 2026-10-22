const point = (x, y) => ({ x, y });

export const MECHANICAL_SAMPLES = ["tensile", "flexural", "impact"];
export const MECHANICAL_STANDARDS = ["astm", "iso"];

const PRESETS = {
  tensile: {
    astm: {
      label: "Tensile · ASTM D638 Type I",
      length: 165, endWidth: 19, narrowWidth: 13, narrowLength: 57, radius: 76, thickness: 3.2,
      gauge: 50, grip: 115,
    },
    iso: {
      label: "Tensile · ISO 527-2 Type 1A",
      length: 170, endWidth: 20, narrowWidth: 10, narrowLength: 80, radius: 24, thickness: 4,
      gauge: 75, grip: 115,
    },
  },
  flexural: {
    astm: { label: "Flexural · ASTM D790", length: 127, width: 12.7, thickness: 3.2, span: 51.2 },
    iso: { label: "Flexural · ISO 178", length: 80, width: 10, thickness: 4, span: 64 },
  },
  impact: {
    astm: {
      label: "Impact · ASTM D256 Notch A",
      length: 63.5, width: 12.7, thickness: 3.2, notchDepth: 2.54, notchRadius: 0.25, notchAngle: 45,
    },
    iso: {
      label: "Impact · ISO 180/1A Notch A",
      length: 80, width: 10, thickness: 4, notchDepth: 2, notchRadius: 0.25, notchAngle: 45,
    },
  },
};

function dogBoneOutline(spec) {
  const { length, endWidth, narrowWidth, narrowLength, radius } = spec;
  const shoulder = (endWidth - narrowWidth) / 2;
  const run = Math.sqrt(radius ** 2 - (radius - shoulder) ** 2);
  const steps = 32;
  const lower = [point(-length / 2, -endWidth / 2), point(-narrowLength / 2 - run, -endWidth / 2)];
  for (let index = 1; index <= steps; index += 1) {
    const dx = run * (1 - index / steps);
    lower.push(point(-narrowLength / 2 - dx, -narrowWidth / 2 - (radius - Math.sqrt(radius ** 2 - dx ** 2))));
  }
  const right = lower.slice(1).reverse().map(({ x, y }) => point(-x, y));
  const bottom = [...lower, ...right, point(length / 2, -endWidth / 2)];
  const top = [...bottom].reverse().map(({ x, y }) => point(x, -y));
  return [...bottom, ...top];
}

function notchedBarOutline(spec) {
  const { length, width, notchDepth, notchRadius, notchAngle } = spec;
  const half = notchAngle * Math.PI / 360;
  const centerDepth = notchDepth - notchRadius;
  const sharpDepth = centerDepth + notchRadius / Math.sin(half);
  const opening = sharpDepth * Math.tan(half);
  const center = point(0, width / 2 - centerDepth);
  const arc = [];
  const steps = 12;
  const from = -half;
  const to = -Math.PI + half;
  for (let index = 0; index <= steps; index += 1) {
    const angle = from + (to - from) * index / steps;
    arc.push(point(center.x + notchRadius * Math.cos(angle), center.y + notchRadius * Math.sin(angle)));
  }
  return [
    point(-length / 2, -width / 2), point(length / 2, -width / 2), point(length / 2, width / 2),
    point(opening, width / 2), ...arc, point(-opening, width / 2), point(-length / 2, width / 2),
  ];
}

/** Flat-printed standard specimen: long axis along X, thickness along Z. */
export function mechanicalSpecimen(sample, standard = "astm") {
  if (!MECHANICAL_SAMPLES.includes(sample)) throw new Error("Choose a tensile, flexural or impact sample.");
  if (!MECHANICAL_STANDARDS.includes(standard)) throw new Error("Choose the ASTM or ISO specimen dimensions.");
  const spec = PRESETS[sample][standard];
  if (sample === "tensile") {
    return {
      key: sample, standard, label: spec.label, length: spec.length, width: spec.endWidth,
      thickness: spec.thickness, minFeature: spec.narrowWidth, outline: dogBoneOutline(spec), spec,
    };
  }
  if (sample === "impact") {
    return {
      key: sample, standard, label: spec.label, length: spec.length, width: spec.width,
      thickness: spec.thickness, minFeature: spec.width - spec.notchDepth, outline: notchedBarOutline(spec), spec,
    };
  }
  const { length, width } = spec;
  return {
    key: sample, standard, label: spec.label, length, width, thickness: spec.thickness, minFeature: width,
    outline: [point(-length / 2, -width / 2), point(length / 2, -width / 2), point(length / 2, width / 2), point(-length / 2, width / 2)],
    spec,
  };
}
