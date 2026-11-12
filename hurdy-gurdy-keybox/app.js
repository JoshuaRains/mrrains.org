(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const defaults = {
    scaleLength: 345,
    keyCount: 24,
    firstInterval: 1,
    openNote: 'G♯',
    divisions: 12,
    boxHeight: 48,
    holeDiameter: 5,
    leftMargin: 12,
    rightMargin: 12,
    stringFromTop: 10,
    holeOffset: 15
  };

  const form = document.querySelector('#layoutForm');
  const svg = document.querySelector('#layoutSvg');
  const rows = document.querySelector('#positionRows');
  const labelsToggle = document.querySelector('#showLabels');
  const dimensionsToggle = document.querySelector('#showDimensions');
  const toast = document.querySelector('#toast');

  function el(name, attributes = {}, text = '') {
    const node = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }

  function number(id, fallback) {
    const input = document.querySelector(`#${id}`);
    const value = Number(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function getSettings() {
    return {
      scaleLength: Math.max(100, number('scaleLength', defaults.scaleLength)),
      keyCount: Math.max(1, Math.min(48, Math.round(number('keyCount', defaults.keyCount)))),
      firstInterval: Math.max(1, Math.round(number('firstInterval', defaults.firstInterval))),
      openNote: document.querySelector('#openNote').value,
      divisions: Math.max(5, Math.round(number('divisions', defaults.divisions))),
      boxHeight: Math.max(15, number('boxHeight', defaults.boxHeight)),
      holeDiameter: Math.max(.5, number('holeDiameter', defaults.holeDiameter)),
      leftMargin: Math.max(0, number('leftMargin', defaults.leftMargin)),
      rightMargin: Math.max(0, number('rightMargin', defaults.rightMargin)),
      stringFromTop: Math.max(0, number('stringFromTop', defaults.stringFromTop)),
      holeOffset: Math.max(0, number('holeOffset', defaults.holeOffset)),
      showLabels: labelsToggle.checked,
      showDimensions: dimensionsToggle.checked
    };
  }

  function calculate(s) {
    const openIndex = Math.max(0, NOTE_NAMES.indexOf(s.openNote));
    return Array.from({ length: s.keyCount }, (_, index) => {
      const interval = s.firstInterval + index;
      const position = s.scaleLength - (s.scaleLength / Math.pow(2, interval / s.divisions));
      const previousInterval = interval - 1;
      const previous = index === 0
        ? 0
        : s.scaleLength - (s.scaleLength / Math.pow(2, previousInterval / s.divisions));
      return {
        key: index + 1,
        interval,
        position,
        gap: position - previous,
        note: s.divisions === 12 ? NOTE_NAMES[(openIndex + interval) % 12] : `+${interval}`
      };
    });
  }

  function line(x1, y1, x2, y2, attributes = {}) {
    return el('line', { x1, y1, x2, y2, ...attributes });
  }

  function text(x, y, content, attributes = {}) {
    return el('text', { x, y, ...attributes }, content);
  }

  function drawDimension(group, x1, x2, y, label, extensionTop) {
    const style = { stroke: '#777a74', 'stroke-width': '.45', 'vector-effect': 'non-scaling-stroke' };
    group.append(line(x1, extensionTop, x1, y + 2, style));
    group.append(line(x2, extensionTop, x2, y + 2, style));
    group.append(line(x1, y, x2, y, { ...style, 'marker-start': 'url(#arrowStart)', 'marker-end': 'url(#arrowEnd)' }));
    group.append(text((x1 + x2) / 2, y - 2.2, label, { 'text-anchor': 'middle', fill: '#565954', 'font-size': '3.2', 'font-family': 'ui-monospace, monospace' }));
  }

  function render() {
    const s = getSettings();
    const keys = calculate(s);
    const lastPosition = keys.at(-1).position;
    const originX = s.leftMargin;
    const boxLength = originX + lastPosition + s.rightMargin;
    const padding = 16;
    const dimensionBottom = s.showDimensions ? 17 : 5;
    const drawingHeight = padding + s.boxHeight + dimensionBottom + 12;
    const stringY = padding + Math.min(s.boxHeight, s.stringFromTop);
    const holeY = Math.min(padding + s.boxHeight - s.holeDiameter / 2, stringY + s.holeOffset);

    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${boxLength + padding * 2} ${drawingHeight}`);
    svg.setAttribute('width', `${boxLength + padding * 2}mm`);
    svg.setAttribute('height', `${drawingHeight}mm`);
    svg.dataset.exportWidth = boxLength + padding * 2;
    svg.dataset.exportHeight = drawingHeight;

    svg.append(el('title', { id: 'svgTitle' }, 'Hurdy-gurdy keybox side profile'));
    svg.append(el('desc', { id: 'svgDesc' }, `${s.keyCount} key holes positioned for a ${s.scaleLength} millimeter scale length.`));

    const defs = el('defs');
    const markerStart = el('marker', { id: 'arrowStart', viewBox: '0 0 4 4', refX: '1', refY: '2', markerWidth: '4', markerHeight: '4', orient: 'auto-start-reverse' });
    markerStart.append(el('path', { d: 'M4 0L0 2l4 2z', fill: '#777a74' }));
    const markerEnd = el('marker', { id: 'arrowEnd', viewBox: '0 0 4 4', refX: '3', refY: '2', markerWidth: '4', markerHeight: '4', orient: 'auto' });
    markerEnd.append(el('path', { d: 'M0 0l4 2-4 2z', fill: '#777a74' }));
    defs.append(markerStart, markerEnd);
    svg.append(defs);

    const drawing = el('g', { transform: `translate(${padding} 0)` });
    const outlineStyle = { fill: 'none', stroke: '#111111', 'stroke-width': '.8', 'vector-effect': 'non-scaling-stroke' };
    drawing.append(el('rect', { x: 0, y: padding, width: boxLength, height: s.boxHeight, ...outlineStyle }));
    drawing.append(line(originX, padding, originX, padding + s.boxHeight, { stroke: '#111111', 'stroke-width': '1.3', 'vector-effect': 'non-scaling-stroke' }));
    drawing.append(text(originX, padding - 3, 'NUT', { 'text-anchor': 'middle', fill: '#171916', 'font-size': '3', 'font-weight': '700', 'font-family': 'ui-monospace, monospace', 'letter-spacing': '.4' }));

    drawing.append(line(0, stringY, boxLength, stringY, { stroke: '#1765d8', 'stroke-width': '1.15', 'vector-effect': 'non-scaling-stroke' }));

    const holes = el('g', { id: 'key-holes' });
    keys.forEach((key) => {
      const x = originX + key.position;
      holes.append(el('circle', { cx: x, cy: holeY, r: s.holeDiameter / 2, fill: 'none', stroke: '#d44234', 'stroke-width': '.85', 'vector-effect': 'non-scaling-stroke' }));
      holes.append(line(x - s.holeDiameter * .34, holeY, x + s.holeDiameter * .34, holeY, { stroke: '#d44234', 'stroke-width': '.35', 'vector-effect': 'non-scaling-stroke' }));
      holes.append(line(x, holeY - s.holeDiameter * .34, x, holeY + s.holeDiameter * .34, { stroke: '#d44234', 'stroke-width': '.35', 'vector-effect': 'non-scaling-stroke' }));
      if (s.showLabels) {
        const stagger = key.key % 2 === 0 ? 5 : 0;
        holes.append(line(x, holeY + s.holeDiameter / 2 + 1, x, holeY + s.holeDiameter / 2 + 3 + stagger, { stroke: '#aaa69c', 'stroke-width': '.3', 'vector-effect': 'non-scaling-stroke' }));
        holes.append(text(x, holeY + s.holeDiameter / 2 + 7 + stagger, `${key.key} · ${key.note}`, { 'text-anchor': 'middle', fill: '#a42e24', 'font-size': '2.6', 'font-weight': '700', 'font-family': 'ui-monospace, monospace' }));
      }
    });
    drawing.append(holes);

    if (s.showDimensions) {
      const dimensionGroup = el('g', { id: 'dimensions' });
      drawDimension(dimensionGroup, 0, boxLength, padding + s.boxHeight + 11, `${boxLength.toFixed(2)} mm overall`, padding + s.boxHeight);
      drawDimension(dimensionGroup, originX, originX + lastPosition, 8, `${lastPosition.toFixed(2)} mm nut → last key`, padding);
      drawing.append(dimensionGroup);
    }

    svg.append(drawing);

    document.querySelector('#boxLengthReadout').textContent = `${boxLength.toFixed(2)} mm`;
    document.querySelector('#firstHoleReadout').textContent = `${keys[0].position.toFixed(2)} mm`;
    document.querySelector('#lastHoleReadout').textContent = `${lastPosition.toFixed(2)} mm`;

    rows.replaceChildren(...keys.map((key) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${key.key}</td><td>${key.note}</td><td>+${key.interval}</td><td>${key.position.toFixed(3)} mm</td><td>${key.gap.toFixed(3)} mm</td>`;
      return row;
    }));
  }

  function exportSvg() {
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', NS);
    copy.setAttribute('width', `${Number(svg.dataset.exportWidth).toFixed(3)}mm`);
    copy.setAttribute('height', `${Number(svg.dataset.exportHeight).toFixed(3)}mm`);
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`;
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hurdy-gurdy-keybox-${getSettings().scaleLength}mm-${getSettings().keyCount}keys.svg`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 1800);
  }

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  labelsToggle.addEventListener('change', render);
  dimensionsToggle.addEventListener('change', render);
  document.querySelector('#exportButton').addEventListener('click', exportSvg);
  document.querySelector('#resetButton').addEventListener('click', () => {
    Object.entries(defaults).forEach(([key, value]) => { document.querySelector(`#${key}`).value = value; });
    labelsToggle.checked = true;
    dimensionsToggle.checked = true;
    render();
  });

  render();
})();
