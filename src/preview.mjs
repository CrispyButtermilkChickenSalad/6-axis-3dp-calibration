const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createScenePreview(canvas) {
  const context = canvas.getContext("2d");
  let model = null;
  let yaw = -0.62;
  let pitch = 0.56;
  let zoom = 1;
  let drag = null;
  let dragMode = null;
  let nozzlePosition = null;
  let viewTransform = null;

  function draw() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const width = rect.width;
    const height = rect.height;
    const dark = document.body.dataset.theme === "dark";
    const palette = getComputedStyle(document.documentElement);
    const paletteColor = (name) => palette.getPropertyValue(`--path-${name}`).trim();
    const colors = dark
      ? { background: "#211c28", grid: "#40364a", plane: "#2a2432", text: "#bdb0c8", side: "#74558f", sideDark: "#4e3863", top: "#a383bd" }
      : { background: "#f7f5f9", grid: "#e5deeb", plane: "#f0ecf4", text: "#796e82", side: "#9477aa", sideDark: "#69517f", top: "#c4afd4" };
    colors.toolpath = paletteColor("uniform");
    colors.wallPath = paletteColor("wall");
    colors.solidPath = paletteColor("solid");
    colors.sparsePath = paletteColor("sparse");
    colors.prime = paletteColor("prime");
    context.fillStyle = colors.background;
    context.fillRect(0, 0, width, height);
    if (!model) {
      context.fillStyle = colors.text;
      context.font = "13px Segoe UI, sans-serif";
      context.textAlign = "center";
      context.fillText("Generate a specimen to preview its toolpath", width / 2, height / 2);
      drawNozzle(context, width, height, colors, 0, 0);
      return;
    }

    const centerX = model.centerX;
    const centerY = model.centerY;
    const projected = (x, y, z) => {
      const dx = x - centerX;
      const dy = y - centerY;
      const horizontal = dx * Math.cos(yaw) - dy * Math.sin(yaw);
      const depth = dx * Math.sin(yaw) + dy * Math.cos(yaw);
      return {
        x: horizontal,
        y: -depth * Math.sin(pitch) - z * Math.cos(pitch),
      };
    };
    const halfX = model.width / 2;
    const halfY = model.depth / 2;
    const topZ = model.viewZ ?? model.height;
    const corners = [
      [-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY],
    ];
    const heightMM = model.height;
    const fitPoints = [
      ...corners.map(([x, y]) => projected(centerX + x, centerY + y, 0)),
      ...corners.map(([x, y]) => projected(centerX + x, centerY + y, heightMM)),
    ];
    const minX = Math.min(...fitPoints.map((item) => item.x));
    const maxX = Math.max(...fitPoints.map((item) => item.x));
    const minY = Math.min(...fitPoints.map((item) => item.y));
    const maxY = Math.max(...fitPoints.map((item) => item.y));
    const scale = Math.min(width * 0.64 / Math.max(1, maxX - minX), height * 0.58 / Math.max(1, maxY - minY)) * zoom;
    const offsetX = width / 2 - (minX + maxX) / 2 * scale;
    const offsetY = height * 0.55 - (minY + maxY) / 2 * scale;
    const screen = (x, y, z) => {
      const result = projected(x, y, z);
      return { x: offsetX + result.x * scale, y: offsetY + result.y * scale };
    };
    viewTransform = {
      screen,
      width,
      height,
      scale,
      offsetX,
      offsetY,
      centerX,
      centerY,
      yaw,
      pitch,
      screenToBed(clientX, clientY, z) {
        const localX = (clientX - rect.left - offsetX) / scale;
        const localY = (clientY - rect.top - offsetY) / scale;
        const depth = -(localY + z * Math.cos(pitch)) / Math.sin(pitch);
        const x = localX * Math.cos(yaw) + depth * Math.sin(yaw) + centerX;
        const y = -localX * Math.sin(yaw) + depth * Math.cos(yaw) + centerY;
        return { x, y };
      },
    };
    const polygon = (points, fill, stroke = "rgba(30, 55, 38, .2)") => {
      context.beginPath();
      points.forEach((point, index) => {
        const at = index ? "lineTo" : "moveTo";
        context[at](point.x, point.y);
      });
      context.closePath();
      context.fillStyle = fill;
      context.fill();
      context.strokeStyle = stroke;
      context.lineWidth = 0.8;
      context.stroke();
    };
    const line = (points, color, lineWidth = 1) => {
      if (!points.length) return;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((item) => context.lineTo(item.x, item.y));
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.stroke();
    };
    const pathColor = (path) => {
      if (!model.colorByType) return colors.toolpath;
      if (path.type === "wall") return colors.wallPath;
      if (path.type === "solid-infill") return colors.solidPath;
      if (path.type === "sparse-infill") return colors.sparsePath;
      return colors.prime;
    };
    const drawSolidLayer = (layer, paths) => {
      const z = layer.z;
      const thickness = Math.max(0.1, model.layerHeight ?? 0.2) * Math.cos(pitch) * scale;
      const widthPx = Math.max(1, (model.lineWidth ?? 0.42) * scale);
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const type of ["prime", "wall", "solid-infill", "sparse-infill"]) {
        const batch = paths.filter((path) => path.points.length > 1
          && (type === "prime" ? path.type === "purge" || path.type === "skirt" : path.type === type));
        if (!batch.length) continue;
        const trace = (dy) => {
          context.beginPath();
          for (const path of batch) {
            const pathZ = path.z ?? z;
            path.points.forEach((point, index) => {
              const p = screen(point.x, point.y, pathZ);
              context[index ? "lineTo" : "moveTo"](p.x, p.y + dy);
            });
          }
        };
        context.lineWidth = widthPx;
        trace(thickness * 0.5);
        context.strokeStyle = pathColor({ type });
        context.stroke();
        context.strokeStyle = "rgba(0, 0, 0, 0.38)";
        context.stroke();
        trace(0);
        context.strokeStyle = pathColor({ type });
        context.stroke();
      }
      context.restore();
    };
    const drawLayer = (layer) => drawSolidLayer(layer, layer.paths);

    const bedCenterX = (model.bedMinX + model.bedMaxX) / 2;
    const bedCenterY = (model.bedMinY + model.bedMaxY) / 2;
    const bedCorners = model.bedShape === "circular"
      ? Array.from({ length: 48 }, (_, index) => {
        const angle = index * Math.PI * 2 / 48;
        return screen(bedCenterX + Math.cos(angle) * model.bedWidth / 2, bedCenterY + Math.sin(angle) * model.bedWidth / 2, 0);
      })
      : [
        screen(model.bedMinX, model.bedMinY, 0),
        screen(model.bedMaxX, model.bedMinY, 0),
        screen(model.bedMaxX, model.bedMaxY, 0),
        screen(model.bedMinX, model.bedMaxY, 0),
      ];
    polygon(bedCorners, colors.plane, colors.grid);
    context.strokeStyle = colors.grid;
    context.lineWidth = 0.55;
    context.save();
    context.beginPath();
    if (model.bedShape === "circular") {
      context.moveTo(bedCorners[0].x, bedCorners[0].y);
      bedCorners.slice(1).forEach((item) => context.lineTo(item.x, item.y));
      context.closePath();
      context.clip();
    }
    const gridStep = Math.max(2, Math.ceil(Math.max(model.width, model.depth) / 8 / 2) * 2);
    for (let x = Math.ceil(model.bedMinX / gridStep) * gridStep; x <= model.bedMaxX; x += gridStep) {
      const from = screen(x, model.bedMinY, 0);
      const to = screen(x, model.bedMaxY, 0);
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
    for (let y = Math.ceil(model.bedMinY / gridStep) * gridStep; y <= model.bedMaxY; y += gridStep) {
      const from = screen(model.bedMinX, y, 0);
      const to = screen(model.bedMaxX, y, 0);
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
    context.stroke();
    context.restore();

    if (model.shape === "cylinder") {
      const segments = 40;
      const ring = (z, radius) => Array.from({ length: segments }, (_, index) => {
        const angle = index * Math.PI * 2 / segments;
        return screen(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, z);
      });
      const bottom = ring(0, halfX);
      const top = ring(topZ, halfX);
      for (let index = 0; index < segments; index += 1) {
        const next = (index + 1) % segments;
        if (Math.sin(index * Math.PI * 2 / segments - yaw) > -0.1) {
          polygon([bottom[index], bottom[next], top[next], top[index]], colors.side);
        }
      }
      polygon(top, colors.top);
      line([...top, top[0]], colors.sideDark, 1);
      line([...bottom, bottom[0]], colors.sideDark, 0.8);
    } else {
      const bottom = corners.map(([x, y]) => screen(centerX + x, centerY + y, 0));
      const top = corners.map(([x, y]) => screen(centerX + x, centerY + y, topZ));
      const faces = [
        { index: 0, fill: colors.side },
        { index: 1, fill: colors.sideDark },
        { index: 2, fill: colors.side },
        { index: 3, fill: colors.sideDark },
      ];
      faces.forEach(({ index, fill }) => {
        const next = (index + 1) % 4;
        polygon([bottom[index], bottom[next], top[next], top[index]], fill);
      });
      polygon(top, colors.top);
      line([...top, top[0]], colors.sideDark, 1);
    }

    if (model.allLayers) {
      const activeLayerNumber = model.activeLayerNumber;
      model.allLayers.forEach((layer) => {
        if (layer.number > activeLayerNumber) return;
        if (layer.number === activeLayerNumber) return;
        drawLayer(layer);
      });
    }
    drawSolidLayer({ z: topZ }, model.paths);
    model.paths.forEach((path) => {
      const points = path.points.map((item) => screen(item.x, item.y, path.z ?? topZ));
      drawDirectionalPath(context, points, pathColor(path));
    });
    if (!nozzlePosition) {
      const firstPath = model.paths.find((path) => path.points.length > 1 && !["purge", "skirt"].includes(path.type))
        ?? model.paths.find((path) => path.points.length > 1);
      nozzlePosition = firstPath?.points[Math.floor(firstPath.points.length / 2)] ?? { x: centerX, y: centerY };
    }
    const beadDirection = nearestPathDirection(nozzlePosition);
    const orientationOffset = ({ trailing: Math.PI, leading: 0, adjacent: Math.PI / 2, "hybrid-trailing": 3 * Math.PI / 4, "hybrid-leading": Math.PI / 4 })[model.orientation] ?? Math.PI;
    const absoluteDirection = model.tiltAxis === "A" ? Math.PI / 2 : 0;
    const tiltDirection = model.angleMode === "adaptive" ? beadDirection + orientationOffset : absoluteDirection;
    drawNozzleModel(context, screen, nozzlePosition, topZ, beadDirection, tiltDirection, model.tiltAngle, model.tipDiameter, colors);
    context.fillStyle = colors.text;
    context.textAlign = "left";
    context.font = "10px Segoe UI, sans-serif";
    context.fillText(`${model.viewLabel ?? "LAST LAYER"} · Z ${topZ.toFixed(2)} MM · ${model.tiltAngle}° ${model.tiltAxis}-AXIS TILT`, 12, height - 11);
  }

  function drawDirectionalPath(ctx, points, color) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((item) => ctx.lineTo(item.x, item.y));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.35;
    ctx.stroke();

    const lengths = [];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
      lengths.push({ index, length });
      total += length;
    }
    const arrowCount = Math.min(6, Math.max(1, Math.floor(total / 42)));
    for (let arrow = 0; arrow < arrowCount; arrow += 1) {
      const target = total * (arrow + 1) / (arrowCount + 1);
      let walked = 0;
      for (const segment of lengths) {
        if (walked + segment.length >= target && segment.length > 2) {
          const start = points[segment.index - 1];
          const end = points[segment.index];
          const fraction = Math.min(0.88, Math.max(0.12, (target - walked) / segment.length));
          const x = start.x + (end.x - start.x) * fraction;
          const y = start.y + (end.y - start.y) * fraction;
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const size = 4;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
          ctx.lineTo(x - Math.cos(angle - 0.55) * size, y - Math.sin(angle - 0.55) * size);
          ctx.lineTo(x - Math.cos(angle + 0.55) * size, y - Math.sin(angle + 0.55) * size);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
          break;
        }
        walked += segment.length;
      }
    }
  }

  function nearestPathDirection(position) {
    if (!model?.paths.length) return 0;
    let nearestDistance = Infinity;
    let heading = 0;
    for (const path of model.paths) {
      for (let index = 1; index < path.points.length; index += 1) {
        const start = path.points[index - 1];
        const end = path.points[index];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) continue;
        const ratio = clamp(((position.x - start.x) * dx + (position.y - start.y) * dy) / lengthSquared, 0, 1);
        const distance = Math.hypot(position.x - (start.x + ratio * dx), position.y - (start.y + ratio * dy));
        if (distance < nearestDistance) {
          nearestDistance = distance;
          heading = Math.atan2(dy, dx);
        }
      }
    }
    return heading;
  }

  function drawNozzleModel(ctx, screen, position, z, beadHeading, tiltHeading, angleDegrees, tipDiameter, colors) {
    const tilt = angleDegrees * Math.PI / 180;
    const axisX = Math.cos(tiltHeading) * Math.sin(tilt);
    const axisY = Math.sin(tiltHeading) * Math.sin(tilt);
    const axisZ = Math.cos(tilt);
    const normalX = -Math.sin(tiltHeading);
    const normalY = Math.cos(tiltHeading);
    const sides = 8;
    const along = (distance, radius, around) => screen(
      position.x + axisX * distance + radius * (normalX * Math.cos(around) - Math.cos(tiltHeading) * Math.cos(tilt) * Math.sin(around)),
      position.y + axisY * distance + radius * (normalY * Math.cos(around) - Math.sin(tiltHeading) * Math.cos(tilt) * Math.sin(around)),
      z + axisZ * distance + radius * Math.sin(tilt) * Math.sin(around),
    );
    const tip = screen(position.x, position.y, z);
    const tipRing = Array.from({ length: sides }, (_, index) => (
      along(0, tipDiameter / 2, index * Math.PI * 2 / sides)
    ));
    const neckRing = Array.from({ length: sides }, (_, index) => (
      along(3, tipDiameter * 1.25, index * Math.PI * 2 / sides)
    ));
    const bodyRing = Array.from({ length: sides }, (_, index) => (
      along(12, Math.max(3, tipDiameter * 2.5), index * Math.PI * 2 / sides)
    ));
    const depthOrder = Array.from({ length: sides }, (_, index) => index)
      .sort((first, second) => bodyRing[first].y - bodyRing[second].y);
    for (const index of depthOrder) {
      const next = (index + 1) % sides;
      ctx.beginPath();
      ctx.moveTo(tipRing[index].x, tipRing[index].y);
      ctx.lineTo(tipRing[next].x, tipRing[next].y);
      ctx.lineTo(neckRing[next].x, neckRing[next].y);
      ctx.lineTo(neckRing[index].x, neckRing[index].y);
      ctx.closePath();
      ctx.fillStyle = index % 2 ? "#51455f" : "#786887";
      ctx.fill();
      ctx.strokeStyle = "#392e46";
      ctx.lineWidth = 0.75;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(neckRing[index].x, neckRing[index].y);
      ctx.lineTo(neckRing[next].x, neckRing[next].y);
      ctx.lineTo(bodyRing[next].x, bodyRing[next].y);
      ctx.lineTo(bodyRing[index].x, bodyRing[index].y);
      ctx.closePath();
      ctx.fillStyle = index % 2 ? "#51455f" : "#786887";
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    tipRing.forEach((item, index) => ctx[index ? "lineTo" : "moveTo"](item.x, item.y));
    ctx.closePath();
    ctx.fillStyle = "#51455f";
    ctx.fill();
    ctx.strokeStyle = "#d6c4e7";
    ctx.stroke();

    const screenTip = screen(position.x, position.y, z + 0.25);
    const beadDirection = Math.atan2(
      screen(position.x + Math.cos(beadHeading), position.y + Math.sin(beadHeading), z).y - screen(position.x, position.y, z).y,
      screen(position.x + Math.cos(beadHeading), position.y + Math.sin(beadHeading), z).x - screen(position.x, position.y, z).x,
    );
    const arrowLength = 20;
    const arrowEnd = { x: screenTip.x + Math.cos(beadDirection) * arrowLength, y: screenTip.y + Math.sin(beadDirection) * arrowLength };
    ctx.beginPath();
    ctx.moveTo(screenTip.x, screenTip.y);
    ctx.lineTo(arrowEnd.x, arrowEnd.y);
    ctx.strokeStyle = colors.toolpath;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(arrowEnd.x, arrowEnd.y);
    ctx.lineTo(arrowEnd.x - Math.cos(beadDirection - 0.55) * 6, arrowEnd.y - Math.sin(beadDirection - 0.55) * 6);
    ctx.lineTo(arrowEnd.x - Math.cos(beadDirection + 0.55) * 6, arrowEnd.y - Math.sin(beadDirection + 0.55) * 6);
    ctx.closePath();
    ctx.fillStyle = colors.toolpath;
    ctx.fill();
    ctx.fillStyle = colors.text;
    ctx.font = "9px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("NOZZLE · DRAG", screenTip.x, screenTip.y - 17);
  }

  function drawNozzle(ctx, width, height, colors, angleDegrees, orientation) {
    const tilt = angleDegrees * Math.PI / 180;
    const heading = ({ trailing: 180, leading: 0, adjacent: 90, "hybrid-trailing": 135, "hybrid-leading": 45 })[orientation] ?? 180;
    const radians = heading * Math.PI / 180;
    const tip = { x: width - 65, y: 92 };
    const dx = Math.sin(tilt) * Math.cos(radians);
    const dy = Math.sin(tilt) * Math.sin(radians);
    ctx.save();
    ctx.fillStyle = colors.background;
    ctx.fillRect(width - 112, 8, 104, 128);
    ctx.strokeStyle = colors.grid;
    ctx.strokeRect(width - 112, 8, 104, 128);
    ctx.fillStyle = colors.text;
    ctx.font = "9px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("NOZZLE MODEL", width - 60, 22);

    const along = (distance) => ({ x: tip.x - dx * distance, y: tip.y - dy * distance - Math.cos(tilt) * distance });
    const back = along(44);
    const shoulder = along(15);
    const normal = { x: Math.cos(radians), y: -Math.sin(radians) };
    ctx.beginPath();
    ctx.moveTo(back.x + normal.x * 8, back.y + normal.y * 8);
    ctx.lineTo(shoulder.x + normal.x * 5, shoulder.y + normal.y * 5);
    ctx.lineTo(tip.x + normal.x * 2.5, tip.y + normal.y * 2.5);
    ctx.lineTo(tip.x - normal.x * 2.5, tip.y - normal.y * 2.5);
    ctx.lineTo(shoulder.x - normal.x * 5, shoulder.y - normal.y * 5);
    ctx.lineTo(back.x - normal.x * 8, back.y - normal.y * 8);
    ctx.closePath();
    ctx.fillStyle = "#59645d";
    ctx.fill();
    ctx.strokeStyle = "#37423b";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = colors.toolpath;
    ctx.fill();
    ctx.fillStyle = colors.text;
    ctx.fillText(`${Math.abs(angleDegrees).toFixed(1)}°`, width - 60, 124);
    ctx.restore();
  }

  function placeNozzle(clientX, clientY) {
    if (!viewTransform || !model) return;
    const position = viewTransform.screenToBed(clientX, clientY, model.height);
    const x = clamp(position.x, model.centerX - model.width / 2, model.centerX + model.width / 2);
    const y = clamp(position.y, model.centerY - model.depth / 2, model.centerY + model.depth / 2);
    if (model.shape === "cylinder") {
      const dx = x - model.centerX;
      const dy = y - model.centerY;
      const distance = Math.hypot(dx, dy);
      const radius = model.width / 2;
      const scaleToCircle = distance > radius ? radius / distance : 1;
      nozzlePosition = { x: model.centerX + dx * scaleToCircle, y: model.centerY + dy * scaleToCircle };
    } else {
      nozzlePosition = { x, y };
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    dragMode = event.button === 2 ? "orbit" : "nozzle";
    drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    if (dragMode === "nozzle") {
      placeNozzle(event.clientX, event.clientY);
      draw();
    }
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (dragMode === "nozzle" && viewTransform && model) {
      placeNozzle(event.clientX, event.clientY);
    } else if (dragMode === "orbit") {
      yaw += (event.clientX - drag.x) * 0.01;
      pitch = clamp(pitch + (event.clientY - drag.y) * 0.008, 0.12, 1.35);
    }
    drag = { x: event.clientX, y: event.clientY };
    draw();
  });
  canvas.addEventListener("pointerup", () => { drag = null; dragMode = null; });
  canvas.addEventListener("pointercancel", () => { drag = null; dragMode = null; });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.5, 3);
    draw();
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") yaw -= 0.1;
    else if (event.key === "ArrowRight") yaw += 0.1;
    else if (event.key === "ArrowUp") pitch = clamp(pitch - 0.08, 0.12, 1.35);
    else if (event.key === "ArrowDown") pitch = clamp(pitch + 0.08, 0.12, 1.35);
    else if (event.key === "+" || event.key === "=") zoom = clamp(zoom * 1.1, 0.5, 3);
    else if (event.key === "-") zoom = clamp(zoom * 0.9, 0.5, 3);
    else return;
    event.preventDefault();
    draw();
  });
  window.addEventListener("resize", draw);

  return {
    update(nextModel) {
      model = nextModel;
      model.viewZ = model.height;
      model.viewLabel = "LAST LAYER";
      model.colorByType = true;
      model.activeLayerNumber = model.allLayers?.at(-1)?.number;
      model.paths = model.allLayers?.at(-1)?.paths ?? model.paths;
      draw();
    },
    setLayer(index) {
      const layer = model?.allLayers?.[index];
      if (!layer) return;
      model.paths = layer.paths;
      model.viewZ = layer.z;
      model.viewLabel = `LAYER ${layer.number}`;
      model.activeLayerNumber = layer.number;
      nozzlePosition = null;
      draw();
    },
    setColorByType(enabled) {
      if (!model) return;
      model.colorByType = enabled;
      draw();
    },
    reset() {
      yaw = -0.62;
      pitch = 0.56;
      zoom = 1;
      nozzlePosition = null;
      draw();
    },
    refresh: draw,
  };
}
