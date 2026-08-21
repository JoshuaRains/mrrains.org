(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const input = document.querySelector("#quipu-input");
  const output = document.querySelector("#quipu-output");
  const emptyMessage = document.querySelector("#empty-message");
  const description = document.querySelector("#quipu-description");
  const exportSvgButton = document.querySelector("#export-svg");
  const exportPngButton = document.querySelector("#export-png");

  const MODULE_WIDTH = 306;
  const MODULE_TOP = 21;
  const WRAP_STEP = 31;
  const FIRST_WRAP_Y = 125;
  const MODULE_GAP = 30;
  const CORD_GAP = 42;
  const ZERO_HEIGHT = 170;
  const STROKE_WIDTH = 5;
  const NINE_KNOT_HEIGHT = 143 + 8 * WRAP_STEP + 128;
  const DIGIT_SLOT_HEIGHT = NINE_KNOT_HEIGHT + MODULE_GAP;

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    return element;
  }

  function moduleHeight(wrapCount) {
    if (wrapCount === 0) return ZERO_HEIGHT;
    const bottomY = 143 + (wrapCount - 1) * WRAP_STEP;
    return bottomY + 128;
  }

  function makeWrap(index) {
    const y = FIRST_WRAP_Y + index * WRAP_STEP;
    const centerY = y + 15;
    return svgElement("rect", {
      x: 84,
      y,
      width: 98,
      height: 30,
      rx: 15,
      fill: "white",
      transform: `rotate(-15 133 ${centerY})`,
    });
  }

  function makeRibbonConnector(y1, y2, edgeY1 = y1) {
    const connector = svgElement("g");
    connector.append(
      svgElement("rect", {
        x: 110,
        y: y1,
        width: 35,
        height: Math.max(0, y2 - y1),
        fill: "white",
        stroke: "none",
      }),
      svgElement("path", {
        d: `M110 ${edgeY1}V${y2}M145 ${y2}V${edgeY1}`,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": STROKE_WIDTH,
        "stroke-linecap": "butt",
      }),
    );
    return connector;
  }

  function makeKnotModule(wrapCount, offsetY) {
    const group = svgElement("g", {
      transform: `translate(0 ${offsetY})`,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": STROKE_WIDTH,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });

    if (wrapCount === 0) {
      group.append(makeRibbonConnector(21, ZERO_HEIGHT));
      return group;
    }

    const bottomY = 143 + (wrapCount - 1) * WRAP_STEP;
    const lowerLoopY = bottomY + 110.5;
    const lowerTipY = bottomY + 128;
    const outerIntersectionY = bottomY + Math.sqrt(56 ** 2 - 21 ** 2);
    const outerSwoop = `M110 130A56 56 0 0 1 222 130V${bottomY}A56 56 0 0 1 166 ${bottomY + 56}A56 56 0 0 1 145 ${outerIntersectionY.toFixed(3)}`;
    const innerSwoop = `M145 130A21 21 0 0 1 187 130V${bottomY}A21 21 0 0 1 145 ${bottomY}`;

    group.append(
      svgElement("path", {
        d: "M110 21V131L145 130V21Z",
        fill: "white",
        stroke: "none",
      }),
      svgElement("path", {
        d: "M110 21V131M145 21V78",
        "stroke-linecap": "butt",
      }),
      svgElement("path", {
        d: `${outerSwoop}L110 130Z ${innerSwoop}Z`,
        fill: "white",
        "fill-rule": "evenodd",
        stroke: "none",
      }),
      svgElement("path", {
        d: outerSwoop,
        fill: "none",
      }),
      svgElement("path", {
        d: innerSwoop,
        fill: "none",
      }),
      svgElement("path", {
        d: `M110 ${bottomY}V${lowerLoopY}A17.5 17.5 0 0 0 145 ${lowerLoopY}V${bottomY}`,
        fill: "white",
      }),
    );

    for (let index = 0; index < wrapCount; index += 1) {
      group.append(makeWrap(index));
    }

    group.dataset.height = String(lowerTipY - MODULE_TOP);
    return group;
  }

  function makeCord(value, cordIndex, x) {
    const group = svgElement("g", {
      transform: `translate(${x - MODULE_WIDTH / 2} 34)`,
      "data-cord": cordIndex + 1,
      "aria-label": `Cord ${cordIndex + 1}: ${value}`,
    });

    let y = 0;
    let previousBottom = null;
    group.append(makeRibbonConnector(0, 23.5, 17.5));

    for (const [index, character] of [...value].entries()) {
      y = index * DIGIT_SLOT_HEIGHT;
      const digit = Number(character);
      if (previousBottom !== null) {
        group.append(makeRibbonConnector(previousBottom - 17.5, y + MODULE_TOP + 2.5));
      }
      group.append(makeKnotModule(digit, y));
      previousBottom = y + moduleHeight(digit);
    }

    // Paint the junction last so nothing on the cord can overlap it.
    group.append(
      svgElement("circle", {
        cx: 127.5,
        cy: 0,
        r: 25,
        fill: "white",
        stroke: "currentColor",
        "stroke-width": STROKE_WIDTH,
      }),
    );

    return { group, height: value.length * DIGIT_SLOT_HEIGHT - MODULE_GAP };
  }

  function parseInput(value) {
    return value
      .replace(/[^\d\s]/g, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function exportFileName(extension) {
    const numberPart = parseInput(input.value).join("-") || "quipu";
    return `quipu-${numberPart}.${extension}`;
  }

  function downloadableSvg() {
    const clone = output.cloneNode(true);
    const [, , width, height] = output.getAttribute("viewBox").split(/\s+/).map(Number);

    clone.removeAttribute("id");
    clone.removeAttribute("class");
    clone.setAttribute("xmlns", SVG_NS);
    clone.setAttribute("width", width);
    clone.setAttribute("height", height);
    clone.setAttribute("color", "#211f1a");
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");

    return {
      source: new XMLSerializer().serializeToString(clone),
      width,
      height,
    };
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSvg() {
    const { source } = downloadableSvg();
    downloadBlob(new Blob([source], { type: "image/svg+xml;charset=utf-8" }), exportFileName("svg"));
  }

  async function exportPng() {
    const { source, width, height } = downloadableSvg();
    const targetHeight = 1500;
    const maxWidth = 8192;
    const scale = Math.min(targetHeight / height, maxWidth / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const imageUrl = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();

    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("The PNG renderer could not load the generated SVG."));
        image.src = imageUrl;
      });

      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const pngBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("The PNG renderer could not create an image."));
        }, "image/png");
      });

      downloadBlob(pngBlob, exportFileName("png"));
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  function render() {
    const sanitized = input.value.replace(/[^\d\s]/g, "");
    if (sanitized !== input.value) {
      const caret = input.selectionStart;
      input.value = sanitized;
      input.setSelectionRange(Math.max(0, caret - 1), Math.max(0, caret - 1));
    }

    const cords = parseInput(input.value);
    output.querySelectorAll("g[data-generated]").forEach((node) => node.remove());

    if (cords.length === 0) {
      output.classList.remove("has-quipu");
      emptyMessage.hidden = false;
      exportSvgButton.disabled = true;
      exportPngButton.disabled = true;
      description.textContent = "No quipu has been generated yet.";
      return;
    }

    const widestCord = MODULE_WIDTH;
    const width = Math.max(360, cords.length * widestCord + (cords.length - 1) * CORD_GAP + 72);
    const primaryY = 34;
    const generated = svgElement("g", { "data-generated": "true" });
    generated.append(
      svgElement("rect", {
        x: 24,
        y: primaryY - 17.5,
        width: width - 48,
        height: 35,
        rx: 17.5,
        fill: "white",
        stroke: "currentColor",
        "stroke-width": STROKE_WIDTH,
      }),
    );

    let tallestCord = 0;
    cords.forEach((value, index) => {
      const x = 36 + MODULE_WIDTH / 2 + index * (MODULE_WIDTH + CORD_GAP);
      const cord = makeCord(value, index, x);
      generated.append(cord.group);
      tallestCord = Math.max(tallestCord, cord.height);
    });

    const height = Math.max(420, tallestCord + 86);
    output.setAttribute("viewBox", `0 0 ${width} ${height}`);
    output.append(generated);
    output.classList.add("has-quipu");
    emptyMessage.hidden = true;
    exportSvgButton.disabled = false;
    exportPngButton.disabled = false;
    description.textContent = `${cords.length} quipu ${cords.length === 1 ? "cord" : "cords"} representing ${cords.join(", ")}.`;
  }

  input.addEventListener("input", render);
  exportSvgButton.addEventListener("click", exportSvg);
  exportPngButton.addEventListener("click", () => {
    exportPng().catch((error) => window.alert(error.message));
  });
  render();
})();
