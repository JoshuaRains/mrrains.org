import { TEAM_COLORS, TILE_TYPES, cellKey, hexDistance } from "./game-logic.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ROOT_THREE = Math.sqrt(3);

function svgElement(name, attrs = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function hexPoints(cx, cy, size, scale = 0.94) {
  const points = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 180) * (60 * index - 30);
    points.push(`${cx + size * scale * Math.cos(angle)},${cy + size * scale * Math.sin(angle)}`);
  }
  return points.join(" ");
}

function starPoints(cx, cy, outerRadius, innerRadius, points = 10) {
  const result = [];
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + index * Math.PI / points;
    result.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return result.join(" ");
}

function hexCenter(column, row, size, padding) {
  return {
    x: padding + ROOT_THREE * size * (column + (row & 1) / 2) + ROOT_THREE * size / 2,
    y: padding + size + 1.5 * size * row
  };
}

function addLabel(group, text, x, y, className) {
  const label = svgElement("text", { x, y, class: className, "text-anchor": "middle" });
  label.textContent = text;
  group.appendChild(label);
}

function addTileDetails(group, cell, cx, cy, size) {
  if (!cell?.team) return;

  if (cell.capital) {
    const diamond = svgElement("rect", {
      x: cx - size * 0.23,
      y: cy - size * 0.23,
      width: size * 0.46,
      height: size * 0.46,
      class: "capital-mark",
      transform: `rotate(45 ${cx} ${cy})`
    });
    group.appendChild(diamond);
  }

  if (cell.type === "armored") {
    group.appendChild(svgElement("polygon", {
      points: hexPoints(cx, cy, size * 0.52, 1),
      class: "armor-core"
    }));
    addLabel(group, String(cell.health || 0), cx, cy + size * 0.13, "health-label");
  }

}

function addTileGlyph(group, tileType, cx, cy, size, variant = "shop") {
  const suffix = variant === "preview" ? " preview-glyph" : "";
  if (tileType === "regular") {
    group.appendChild(svgElement("polygon", {
      points: hexPoints(cx, cy, size * 0.48, 1),
      class: `regular-inset${suffix}`
    }));
    group.appendChild(svgElement("circle", {
      cx, cy, r: size * 0.08, class: `regular-core${suffix}`
    }));
    return;
  }

  if (tileType === "armored") {
    group.appendChild(svgElement("polygon", {
      points: hexPoints(cx, cy, size * 0.52, 1),
      class: `armor-core${suffix}`
    }));
    addLabel(group, "5", cx, cy + size * 0.12, `health-label shop-label${suffix}`);
    return;
  }

  if (tileType === "explosive1") {
    group.appendChild(svgElement("circle", {
      cx, cy: cy + size * 0.08, r: size * 0.31, class: `bomb-body${suffix}`
    }));
    group.appendChild(svgElement("path", {
      d: `M ${cx + size * 0.15} ${cy - size * 0.18} Q ${cx + size * 0.28} ${cy - size * 0.42} ${cx + size * 0.42} ${cy - size * 0.34}`,
      class: `bomb-fuse${suffix}`
    }));
    group.appendChild(svgElement("polygon", {
      points: starPoints(cx + size * 0.46, cy - size * 0.37, size * 0.14, size * 0.055, 6),
      class: `bomb-spark${suffix}`
    }));
    group.appendChild(svgElement("circle", {
      cx: cx - size * 0.1, cy: cy - size * 0.03, r: size * 0.07, class: `bomb-shine${suffix}`
    }));
    return;
  }

  if (tileType === "explosive2") {
    group.appendChild(svgElement("polygon", {
      points: starPoints(cx, cy, size * 0.49, size * 0.27, 12),
      class: `blast-burst${suffix}`
    }));
    group.appendChild(svgElement("circle", {
      cx, cy, r: size * 0.18, class: `blast-core${suffix}`
    }));
    group.appendChild(svgElement("circle", {
      cx, cy, r: size * 0.08, class: `blast-center${suffix}`
    }));
    return;
  }

  if (tileType === "repair") {
    group.appendChild(svgElement("circle", {
      cx, cy, r: size * 0.39, class: `repair-disc${suffix}`
    }));
    group.appendChild(svgElement("rect", {
      x: cx - size * 0.09, y: cy - size * 0.28,
      width: size * 0.18, height: size * 0.56,
      rx: size * 0.04, class: `repair-cross${suffix}`
    }));
    group.appendChild(svgElement("rect", {
      x: cx - size * 0.28, y: cy - size * 0.09,
      width: size * 0.56, height: size * 0.18,
      rx: size * 0.04, class: `repair-cross${suffix}`
    }));
  }
}

export function renderHexMap(svg, grid, cols, rows, options = {}) {
  const size = 36;
  const padding = 12;
  const width = ROOT_THREE * size * (cols + 0.5) + padding * 2;
  const height = size * (2 + 1.5 * (rows - 1)) + padding * 2;

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "grid");
  svg.setAttribute("aria-label", `${cols} by ${rows} hex game map`);

  for (let r = 0; r < rows; r += 1) {
    for (let q = 0; q < cols; q += 1) {
      const key = cellKey(q, r);
      const cell = grid?.[key] || { team: null, type: null };
      const { x: cx, y: cy } = hexCenter(q, r, size, padding);
      const group = svgElement("g", {
        class: "hex-cell",
        "data-q": q,
        "data-r": r,
        role: "gridcell",
        tabindex: options.interactive ? "0" : "-1"
      });
      const title = svgElement("title");
      title.textContent = cell.team
        ? `${cell.team} ${cell.capital ? "base" : (cell.type || "tile")}${cell.health ? `, ${cell.health} health` : ""}`
        : "Empty hex";
      group.appendChild(title);

      const polygon = svgElement("polygon", {
        points: hexPoints(cx, cy, size),
        class: `hex-shape${cell.team ? ` team-${cell.team}` : ""}`,
        fill: cell.team ? TEAM_COLORS[cell.team] : "#3a3a3a"
      });
      group.appendChild(polygon);
      addTileDetails(group, cell, cx, cy, size);

      if (options.interactive) {
        const updatePreview = show => {
          group.querySelectorAll(".placement-preview").forEach(node => node.remove());
          svg.querySelectorAll(".placement-zone-preview").forEach(node => node.remove());
          group.classList.remove("valid-target", "invalid-target");
          if (!show || !options.selectedType) return;
          const validity = options.isValid?.(q, r);
          group.classList.add(validity?.ok ? "valid-target" : "invalid-target");
          if (!validity?.ok) return;

          const definition = TILE_TYPES[options.selectedType];
          if (definition?.radius) {
            const zone = svgElement("g", { class: "placement-zone-preview" });
            for (let zoneR = 0; zoneR < rows; zoneR += 1) {
              for (let zoneQ = 0; zoneQ < cols; zoneQ += 1) {
                if (hexDistance(q, r, zoneQ, zoneR) > definition.radius) continue;
                const center = hexCenter(zoneQ, zoneR, size, padding);
                zone.appendChild(svgElement("polygon", {
                  points: hexPoints(center.x, center.y, size * 0.91, 1),
                  class: "blast-zone-preview"
                }));
              }
            }
            const target = hexCenter(q, r, size, padding);
            addTileGlyph(zone, options.selectedType, target.x, target.y, size * 0.78, "preview");
            svg.appendChild(zone);
            return;
          }

          const preview = svgElement("g", { class: "placement-preview" });
          preview.appendChild(svgElement("polygon", {
            points: hexPoints(cx, cy, size * 0.91, 1),
            class: "placement-preview-shape"
          }));
          addTileGlyph(preview, options.selectedType, cx, cy, size * 0.78, "preview");
          group.appendChild(preview);
        };

        group.addEventListener("pointerenter", () => updatePreview(true));
        group.addEventListener("pointerleave", () => updatePreview(false));
        group.addEventListener("focus", () => updatePreview(true));
        group.addEventListener("blur", () => updatePreview(false));
        group.addEventListener("click", () => options.onSelect?.(q, r));
        group.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            options.onSelect?.(q, r);
          }
        });
      }
      svg.appendChild(group);
    }
  }
}

export function renderTileIcon(svg, tileType, color = "#4dabf7") {
  const definition = TILE_TYPES[tileType];
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 100 92");
  svg.setAttribute("aria-label", definition?.name || tileType);
  const group = svgElement("g");
  group.appendChild(svgElement("polygon", {
    points: hexPoints(50, 46, 45),
    fill: color,
    class: "shop-hex"
  }));
  addTileGlyph(group, tileType, 50, 46, 43);
  svg.appendChild(group);
}

export function animateBlast(svg, column, row, tileType, cols, rows) {
  const definition = TILE_TYPES[tileType];
  if (!definition?.radius || !svg || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const size = 36;
  const padding = 12;
  const { x: cx, y: cy } = hexCenter(column, row, size, padding);
  svg.querySelectorAll(".blast-animation").forEach(node => node.remove());

  const animation = svgElement("g", { class: "blast-animation" });
  const drop = svgElement("g", { class: "blast-drop" });
  addTileGlyph(drop, tileType, cx, cy, size * 0.82);
  animation.appendChild(drop);

  const wave = svgElement("circle", {
    cx,
    cy,
    r: size * (definition.radius * 1.55 + 0.45),
    class: "blast-wave"
  });
  animation.appendChild(wave);
  svg.appendChild(animation);

  if (typeof drop.animate === "function") {
    drop.animate([
      { transform: `translateY(-${size * 4}px) scale(2.3)`, opacity: 0 },
      { transform: `translateY(-${size * 3.2}px) scale(2.1)`, opacity: 1, offset: 0.16 },
      { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.68 },
      { transform: "translateY(0) scale(1.35)", opacity: 0 }
    ], { duration: 950, easing: "cubic-bezier(.2,.75,.3,1)", fill: "forwards" });
    wave.animate([
      { transform: "scale(.08)", opacity: 0 },
      { transform: "scale(.15)", opacity: 0.85, offset: 0.08 },
      { transform: "scale(1)", opacity: 0.38, offset: 0.72 },
      { transform: "scale(1.18)", opacity: 0 }
    ], { duration: 700, delay: 560, easing: "ease-out", fill: "forwards" });
  }
  window.setTimeout(() => animation.remove(), 1350);
}
