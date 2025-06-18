// script.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  set,
  remove,
  get
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

// ------------------------------
// Firebase initialization
// ------------------------------
const firebaseConfig = {
            apiKey: "AIzaSyBBxUdOHCB1fJI9mZgYHJ0HCg6p_8R_1-s",
            authDomain: "interactive-whiteboard-8bc1e.firebaseapp.com",
            projectId: "interactive-whiteboard-8bc1e",
            storageBucket: "interactive-whiteboard-8bc1e.firebasestorage.app",
            messagingSenderId: "403793324386",
            appId: "1:403793324386:web:c5f8da9579cd97f935a43b"
        };
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ------------------------------
// Canvas & state variables
// ------------------------------
const CANVAS_WIDTH    = 4000;
const CANVAS_HEIGHT   = 4000;
const REF_DOT_SPACING = 100;

let canvas, ctx;
let isLocked       = false;
let scale          = 1;
let offsetX        = 0;
let offsetY        = 0;
let isPanning      = false;
let panStart       = {};
let currentTool    = null;
let currentBoardId = null;

let boards    = {};
let strokes   = [];
let imagesArr = [];

let isDrawing  = false;
let isErasing  = false;
let isLassoing = false;
let eraserPath = [];
let lassoPath  = [];
let selectionBox = null;

// for pinch‐zoom support
let pointers = new Map();
let initialPinchDist = 0;
let initialScale = 1;
let pinchCenter = { x: 0, y: 0 };

// with these:
let isPlacingImage     = false;
let placeImageScreen   = { x: 0, y: 0 };

let isDraggingSelection = false;
let dragStart           = { x: 0, y: 0 };
let selectedStrokes     = [];
let selectedImages      = [];

let originalBox, originalSelection;
// alongside imagesArr…
let elementsArr = [];

// and for selection/dragging:
let selectedElements = [];



// ------------------------------
// DOM elements cache
// ------------------------------
const el = {};
function cacheDOM() {
  el.boardDropdownBtn     = document.getElementById("board-dropdown-btn");
  el.boardDropdown        = document.getElementById("board-dropdown");
  el.boardList            = document.getElementById("board-list");
  el.newBoardBtn          = document.getElementById("new-board-btn");
  el.newBoardModal        = document.getElementById("new-board-modal");
  el.newBoardNameInput    = document.getElementById("new-board-name");
  el.newBoardPeriodSelect = document.getElementById("new-board-period");
  el.createBoardConfirm   = document.getElementById("create-board-confirm");
  el.createBoardCancel    = document.getElementById("create-board-cancel");
el.elementTemplates = document.getElementById("element-templates");
el.fullscreenBtn = document.getElementById("fullscreen-btn");

  el.canvasContainer      = document.getElementById("canvas-container");
  canvas                   = document.getElementById("whiteboard-canvas");
  ctx                      = canvas.getContext("2d");

  el.lockToggleBtn         = document.getElementById("lock-toggle");
  el.lockIcon              = document.getElementById("lock-icon");
  el.homeBtn               = document.getElementById("home-btn");

  el.toolButtons           = Array.from(document.querySelectorAll(".tool-btn"));
  el.penSlider             = document.getElementById("pen-slider");
  el.penSizeSlider         = document.getElementById("pen-size-slider");

  el.pasteImageBtn         = document.getElementById("paste-image-btn");
  el.eraserBtn             = document.getElementById("eraser-btn");
  el.lassoBtn              = document.getElementById("lasso-btn");

  el.consoleOutput         = document.getElementById("user-console-output");

  // hide dropdown, modal, and pen slider by default
  el.boardDropdown.style.display = "none";
  el.newBoardModal.style.display = "none";
  el.penSlider.style.display     = "none";

  el.scaleSlider = document.getElementById("scale-slider");
el.scaleRange  = document.getElementById("scale-range");
// hide by default
el.scaleSlider.style.display = "none";


//uhhhhhhhh stuff for the special items on the canvas
el.addElementBtn    = document.getElementById("add-element-btn");
el.elementModal     = document.getElementById("element-modal");
el.elementTextarea  = document.getElementById("element-config");
el.elementAddBtn    = document.getElementById("element-add");
el.elementCancelBtn = document.getElementById("element-cancel");

}

// ------------------------------
// Initialization
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
  cacheDOM();
  initCanvas();
  setupUI();
  fetchBoards();
});

// ------------------------------
// initialize canvas size & handlers
// ------------------------------
function initCanvas() {
  canvas.width  = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.style.cursor = "grab";

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup",    onPointerUp);
  canvas.addEventListener("wheel",        onWheel, { passive: false });

  window.addEventListener("resize", () => {
    if (el.boardDropdown.style.display === "block") computeDropdownPosition();
    if (currentTool && currentTool.startsWith("pen")) positionPenSlider();
  });

  redraw();
}

function toggleFullScreen() {
  const icon = el.fullscreenBtn.querySelector("span.material-icons");
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    icon.textContent = "fullscreen_exit";
  } else {
    document.exitFullscreen();
    icon.textContent = "fullscreen";
  }
}



// ------------------------------
// fetch list of boards (once)
// ------------------------------
function fetchBoards() {
  get(ref(db, "whiteboards")).then(snapshot => {
    const val = snapshot.val() || {};
    boards = {};
    Object.entries(val).forEach(([id, bd]) => {
      boards[id] = { name: bd.name };
    });
    renderBoardList();
    if (!currentBoardId && Object.keys(boards).length) {
      loadBoard(Object.keys(boards)[0]);
    }
  });
}

function updateElementInteractivity() {
  // only allow clicks when a “pen” tool is active
  const interactive = currentTool?.startsWith("pen");
  elementsArr.forEach(e => {
    e.elDiv.style.pointerEvents = interactive ? "auto" : "none";
  });
}


// ------------------------------
// render board dropdown list
// ------------------------------
function renderBoardList() {
  el.boardList.innerHTML = "";
  Object.entries(boards).forEach(([id, data]) => {
    const item = document.createElement("div");
    item.className = "board-item";
    item.textContent = data.name;
    item.onclick = () => {
      toggleDropdown(false);
      loadBoard(id);
    };
    const del = document.createElement("span");
    del.className = "material-icons";
    del.textContent = "delete";
    del.onclick = e => {
      e.stopPropagation();
      deleteBoard(id);
    };
    item.appendChild(del);
    el.boardList.appendChild(item);
  });
}

// registry of renderers by type
const renderers = {
  "flip-card":     renderFlipCard,
  "animated-text": renderAnimatedText,
  "youtube-video": renderYouTubeVideo,
  "textbox":       renderTextbox    // ← new
};


// main entrypoint: drop each element into the page
function renderInteractiveElements(list) {
  // clear any old elements
  el.canvasContainer
    .querySelectorAll(".interactive-element")
    .forEach(e => e.remove());

  list.forEach(data => {
    const container = document.createElement("div");
    container.className        = "interactive-element";
    container.style.position   = "absolute";
    container.style.display    = "inline-block";
    container.style.visibility = "hidden";
    container.style.pointerEvents = "none";

    el.canvasContainer.appendChild(container);
    const fn = renderers[data.type];
    if (fn) fn(container, data.config);

    // allow animated-text to override size first…
    if (data.type === "animated-text") {
      if (data.config.width  != null) container.style.width  = data.config.width  + "px";
      if (data.config.height != null) container.style.height = data.config.height + "px";
    }

    // measure or reuse stored size
    const w = data.w != null ? data.w : container.scrollWidth;
    const h = data.h != null ? data.h : container.scrollHeight;
    data.w     = w;
    data.h     = h;
    data.elDiv = container;

    // finalize size & position
    container.style.visibility = "";
    container.style.width      = w + "px";
    container.style.height     = h + "px";
    container.style.left       = data.x + "px";
    container.style.top        = data.y + "px";

    // new styling
    container.style.backgroundColor = "transparent";
    container.style.border          = "1px solid black";
    container.style.boxShadow       = "0 2px 6px rgba(0,0,0,0.3)";
  });

  updateElementInteractivity();
  redraw();
}






function renderTextbox(container, cfg) {
  container.classList.add("textbox-element");

  // create the editable area
  const textarea = document.createElement("textarea");
  textarea.value = cfg.text || "";

  // fill the container, no native borders
  textarea.style.width      = "100%";
  textarea.style.height     = "100%";
  textarea.style.resize     = "none";
  textarea.style.border     = "none";
  textarea.style.outline    = "none";
  textarea.style.background = "transparent";

  // optional fontSize support
  if (cfg.fontSize != null) {
    textarea.style.fontSize = cfg.fontSize + "px";
  }

  container.appendChild(textarea);

  // when the user types, update the config so saveBoard() will pick it up
  textarea.addEventListener("input", () => {
    cfg.text = textarea.value;
  });

  // when they leave the box, write to Firebase
  textarea.addEventListener("blur", () => {
    saveBoard();
  });
}


function renderFlipCard(container, cfg) {
  container.classList.add("flashcard");
  container.innerHTML = `
    <div class="flashcard-inner">
      <div class="flashcard-front">${cfg.frontHtml}</div>
      <div class="flashcard-back">${cfg.backHtml}</div>
    </div>`;
  container.onclick = () => {
    container.classList.toggle("is-flipped");
  };
}

function renderAnimatedText(container, cfg) {
  container.classList.add("animated-text-container");
  // apply user‐specified box size
  if (cfg.width  != null) container.style.width     = cfg.width  + "px";
  if (cfg.height != null) container.style.height    = cfg.height + "px";
  // new: apply user‐specified font size
  if (cfg.fontSize != null) container.style.fontSize = cfg.fontSize + "px";

  container.innerHTML = `<p>${cfg.text}</p>`;
  container.onclick   = () => container.classList.toggle("visible");
}



function renderYouTubeVideo(container, cfg) {
  const iframe = document.createElement("iframe");
  iframe.src        = `https://www.youtube.com/embed/${cfg.videoId}?start=${cfg.start||0}`;
  iframe.allow      = "autoplay; encrypted-media";
  iframe.width      = 320;
  iframe.height     = 180;
  iframe.style.border = "none";
  container.appendChild(iframe);
}

function renderIFrame(container, cfg) {
  container.innerHTML = `
    <iframe
      src="${cfg.src}"
      width="100%" height="100%"
      frameborder="0"
      allowfullscreen
      mozallowfullscreen
      webkitallowfullscreen>
    </iframe>`;
}
renderers["iframe-element"] = renderIFrame;



function importItem(item) {
  if (Array.isArray(item.points) && item.tool) {
    // it’s a stroke
    strokes.push(item);
  }
  else if (item.url && item.w != null) {
    // it’s an image
    const div = document.createElement("div");
    div.style.position        = "absolute";
    div.style.backgroundImage = `url(${item.url})`;
    div.style.backgroundSize  = "cover";
    div.style.left            = item.x + "px";
    div.style.top             = item.y + "px";
    div.style.width           = item.w + "px";
    div.style.height          = item.h + "px";
    el.canvasContainer.appendChild(div);
    imagesArr.push({ ...item, elDiv: div });
  }
  else if (item.type) {
    // it’s an element (flip-card, text, video…)
    elementsArr.push(item);
  }
}

// ------------------------------
// position dropdown
// ------------------------------
function computeDropdownPosition() {
  const rect = el.boardDropdownBtn.getBoundingClientRect();
  el.boardDropdown.style.left = `${rect.left}px`;
  el.boardDropdown.style.top  = `${rect.bottom}px`;
}

// ------------------------------
// toggle boards dropdown
// ------------------------------
function toggleDropdown(forceShow) {
  const isShown = el.boardDropdown.style.display === "block";
  const show = typeof forceShow === "boolean" ? forceShow : !isShown;
  el.boardDropdown.style.display = show ? "block" : "none";
  if (show) computeDropdownPosition();
}

// ------------------------------
// delete a board & refresh list
// ------------------------------
function deleteBoard(boardId) {
  if (!confirm("Remove this whiteboard?")) return;
  remove(ref(db, `whiteboards/${boardId}`)).then(() => {
    if (boardId === currentBoardId) currentBoardId = null;
    fetchBoards();
  });
}

// ------------------------------
// open "create board" modal
// ------------------------------
function openCreateModal() {
  el.newBoardNameInput.value = "";
  el.newBoardModal.style.display = "flex";
}

// ------------------------------
// hide "create board" modal
// ------------------------------
function cancelCreate() {
  el.newBoardModal.style.display = "none";
}

// ------------------------------
// create a new board & refresh list
// ------------------------------
function createBoard() {
  let name = el.newBoardNameInput.value.trim();
  if (!name) {
    const period = el.newBoardPeriodSelect.value;
    const d      = new Date();
    const mm     = d.getMonth() + 1,
          dd     = d.getDate(),
          yy     = String(d.getFullYear() % 100).padStart(2, "0");
    name = `${period} - ${mm}/${dd}/${yy}`;
  }
  const newRef = push(ref(db, "whiteboards"));
  set(newRef, { name, data: { strokes: [], images: [] } }).then(() => {
    cancelCreate();
    fetchBoards();
  });
}

// ------------------------------
// load a board’s data (once)
// ------------------------------
function loadBoard(boardId) {
  currentBoardId = boardId;

  // clear previous strokes, images, elements
  strokes = [];
  imagesArr.forEach(img => img.elDiv.remove());
  imagesArr = [];
  elementsArr.forEach(elm => elm.elDiv.remove());
  elementsArr = [];

  get(ref(db, `whiteboards/${boardId}/data`)).then(snapshot => {
    const data = snapshot.val() || {};

    // 1) load strokes
    strokes = Array.isArray(data.strokes) ? data.strokes : [];

    // 2) load images
    const rawImages = Array.isArray(data.images) ? data.images : [];
    rawImages.forEach(item => {
      const div = document.createElement("div");
      div.style.position        = "absolute";
      div.style.backgroundImage = `url(${item.url})`;
      div.style.backgroundSize  = "cover";
      div.style.left            = item.x + "px";
      div.style.top             = item.y + "px";
      div.style.width           = item.w + "px";
      div.style.height          = item.h + "px";
      el.canvasContainer.appendChild(div);

      imagesArr.push({
        url:   item.url,
        x:     item.x,
        y:     item.y,
        w:     item.w,
        h:     item.h,
        elDiv: div
      });
    });

    // 3) load interactive elements
    const rawElements = Array.isArray(data.elements) ? data.elements : [];
    elementsArr = rawElements.map(item => {
      const div = document.createElement("div");
div.className           = "interactive-element";
div.style.position      = "absolute";
div.style.left          = item.x + "px";
div.style.top           = item.y + "px";
div.style.pointerEvents = "none";
el.canvasContainer.appendChild(div);

const fn = renderers[item.type];
if (fn) fn(div, item.config);

const w = item.w != null ? item.w : div.scrollWidth;
const h = item.h != null ? item.h : div.scrollHeight;
div.style.width  = w + "px";
div.style.height = h + "px";

// apply consistent styling
div.style.backgroundColor = "transparent";
div.style.border          = "1px solid black";
div.style.boxShadow       = "0 2px 6px rgba(0,0,0,0.3)";

      return {
        id:     item.id,
        type:   item.type,
        config: item.config,
        x:      item.x,
        y:      item.y,
        w, h,
        elDiv:  div
      };
    });

    // ensure interactivity matches current tool, then redraw
    updateElementInteractivity();
    redraw();
  });
}


// ------------------------------
// save current board (only serializable data)
// ------------------------------
function saveBoard() {
  if (!currentBoardId) return;
  set(ref(db, `whiteboards/${currentBoardId}/data`), {
    strokes,
    images: imagesArr.map(({url,x,y,w,h})=>({url,x,y,w,h})),
    elements: elementsArr.map(e => ({
      id:     e.id,
      type:   e.type,
      config: e.config,
      x:      e.x,
      y:      e.y,
      w:      e.w,
      h:      e.h
    }))
  });
}


// ------------------------------
// wire up UI event listeners
// ------------------------------
function setupUI() {
  el.boardDropdownBtn.onclick   = () => toggleDropdown();
  el.newBoardBtn.onclick        = openCreateModal;
  el.createBoardConfirm.onclick = createBoard;
  el.createBoardCancel.onclick  = cancelCreate;
  el.fullscreenBtn.onclick = () => toggleFullScreen();


  el.lockToggleBtn.onclick = () => {
    isLocked = !isLocked;
    el.lockIcon.textContent = isLocked ? "lock" : "lock_open";
    canvas.style.cursor     = isLocked ? "crosshair" : "grab";
  };

  el.homeBtn.onclick = () => {
    scale = 1; offsetX = 0; offsetY = 0;
    redraw();
  };

  el.copyJsonBtn = document.getElementById("copy-json-btn");
el.copyJsonBtn.onclick = () => {
  const fullData = {
    strokes,
    images: imagesArr.map(({url, x, y, w, h}) => ({url, x, y, w, h})),
    elements: elementsArr.map(({id, type, config, x, y, w, h}) =>
      ({id, type, config, x, y, w, h}))
  };
  const json = JSON.stringify(fullData, null, 2);
  navigator.clipboard.writeText(json)
    .then(() => showConsoleMessage("Board JSON copied!", "green"))
    .catch(() => showConsoleMessage("Copy failed.", "red"));
};


  // unified tool selection handler
  el.toolButtons.forEach(btn => {
 btn.onclick = () => {
    const newTool = btn.dataset.tool;
    const prevTool = currentTool;
    currentTool = newTool;

    updateElementInteractivity();


    // UI “pressed” styling
    el.toolButtons.forEach(b =>
      b.classList.toggle("selected", b === btn)
    );

    // pen slider
    if (newTool.startsWith("pen")) {
      el.penSlider.style.display = "block";

      positionPenSlider();
    } else {
      el.penSlider.style.display = "none";
    }

    if (newTool !== "lasso") {
      el.scaleSlider.style.display = "none";
    }

     // if switching *into* lasso and we already have selectionBox
    if (newTool === "lasso" && selectionBox) {
      // compute current scale factor from baseline
      const factor = selectionBox.w / originalBox.w;
      el.scaleRange.value = factor;
      el.scaleSlider.style.display = "block";
      positionScaleSlider();
    }
    

    // ---- NEW: clear any prior lasso/selection ----
    lassoPath = [];
    selectionBox = null;
    selectedStrokes = [];
    selectedImages = [];
    redraw();
  };


el.scaleRange.oninput = () => {
  const factor = parseFloat(el.scaleRange.value);
  // center of the original box
  const cx = originalBox.x + originalBox.w / 2;
  const cy = originalBox.y + originalBox.h / 2;

  // rescale strokes
  selectedStrokes.forEach((s, i) => {
    const orig = originalSelection.strokes[i];
    s.points = orig.points.map(p0 => ({
      x: cx + (p0.x - cx) * factor,
      y: cy + (p0.y - cy) * factor
    }));
    s.size = orig.size * factor;
  });

  // rescale images
  selectedImages.forEach((img, i) => {
    const orig = originalSelection.images[i];
    const imgCx = orig.x + orig.w / 2;
    const imgCy = orig.y + orig.h / 2;
    img.w = orig.w * factor;
    img.h = orig.h * factor;
    img.x = cx + (imgCx - cx) * factor - img.w / 2;
    img.y = cy + (imgCy - cy) * factor - img.h / 2;
  });

  // update selection box
  selectionBox = {
    x: cx - (originalBox.w / 2) * factor,
    y: cy - (originalBox.h / 2) * factor,
    w: originalBox.w * factor,
    h: originalBox.h * factor
  };

  redraw();
};

// commit scale change once user releases
el.scaleRange.onchange = () => saveBoard();

});



// open the element modal
el.addElementBtn.onclick = () => {
  el.elementTextarea.value = "";
  el.elementModal.style.display = "flex";
};
// close if click outside content
el.elementModal.addEventListener("click", e => {
  if (e.target === el.elementModal) {
    el.elementModal.style.display = "none";
  }
});
el.elementCancelBtn.onclick = () => {
  el.elementModal.style.display = "none";
};

// define one JSON template per element type
const templates = {
  "Flip Card": {
    id:   "tmpl-flip-card",
    type: "flip-card",
    x:    100, y: 100, w: 200, h: 120,
    config: {
      frontHtml: "<p><strong>Q:</strong><br/>Your question here</p>",
      backHtml:  "<p><strong>A:</strong><br/>Your answer here</p>"
    }
  },
  "Animated Text": {
    id:   "tmpl-animated-text",
    type: "animated-text",
    x:    100, y: 100, w: 250, h: 60,
    config: {
      text:     "Your animated text",
      width:    250,
      height:   60,
      fontSize: 18
    }
  },
  "YouTube Video": {
    id:   "tmpl-youtube-video",
    type: "youtube-video",
    x:    100, y: 100, w: 320, h: 180,
    config: {
      videoId: "dQw4w9WgXcQ",
      start:    0
    }
  },
  "Textbox": {
    id:   "tmpl-textbox",
    type: "textbox",
    x:    100, y: 100, w: 300, h: 100,
    config: {
      text:     "Click and type here…",
      fontSize: 16
    }
  },
  "Google Slides": {
    id:   "tmpl-google-slides",
    type: "iframe-element",
    x:    100, y: 100, w: 960, h: 569,
    config: {
      src: "https://docs.google.com/presentation/d/e/2PACX-1vQ13FTDpcrQmxj74WCDSwAXDdECVyTBLlG1YZW3q0LHPcZJE6xo6Nl_jWinTjjBau1C95AI-Xr-L6w1/pubembed?start=false&loop=false&delayms=3000"
    }
  }

};

// create one button per template
Object.entries(templates).forEach(([label, json]) => {
  const btn = document.createElement("button");
  btn.type        = "button";
  btn.textContent = label;
  btn.onclick     = () => {
    el.elementTextarea.value = JSON.stringify(json, null, 2);
  };
  el.elementTemplates.appendChild(btn);
});


// parse & add element
el.elementAddBtn.onclick = () => {
  const text = el.elementTextarea.value.trim();
  try {
    const data = JSON.parse(text);

    // full-board JSON?
    if (data.strokes || data.images || data.elements) {
      if (Array.isArray(data.strokes))  data.strokes.forEach(importItem);
      if (Array.isArray(data.images))   data.images.forEach(importItem);
      if (Array.isArray(data.elements)) data.elements.forEach(importItem);
    }
    // array of mixed items?
    else if (Array.isArray(data)) {
      data.forEach(importItem);
    }
    // single stroke/image/element?
    else {
      importItem(data);
    }

    // re-render everything
    renderInteractiveElements(elementsArr);
    redraw();
    saveBoard();
    el.elementModal.style.display = "none";
    showConsoleMessage("Imported JSON!", "green");
  } catch (err) {
    alert("Invalid JSON:\n" + err.message);
  }
};






}

// ------------------------------
// position the pen-size slider
// ------------------------------
function positionPenSlider() {
  const rect = document.querySelector(".tool-group").getBoundingClientRect();
  el.penSlider.style.left = `${rect.left + rect.width / 2}px`;
}

function positionScaleSlider() {
  const btn = document.querySelector('button[data-tool="lasso"]');
  const rect = btn.getBoundingClientRect();
  el.scaleSlider.style.left = `${rect.left + rect.width/2}px`;
}


// ------------------------------
// pointer down handler
// ------------------------------
function onPointerDown(e) {

    // if the “paste-image” tool is active and we clicked *on* the canvas, start placement
if (currentTool === "paste-image" && e.target === canvas) {
  isPlacingImage     = true;
  placeImageScreen   = { x: e.clientX, y: e.clientY };
  return;
}


    if (e.pointerType === 'touch') {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
        const [p1, p2] = Array.from(pointers.values());
        initialPinchDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        initialScale     = scale;
        pinchCenter      = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        }
    }

  const pt = screenToWorld(e.clientX, e.clientY);

  if (!isLocked) {
    // start panning
    isPanning = true;
    panStart  = { x: e.clientX, y: e.clientY, offsetX, offsetY };
    canvas.style.cursor = "grabbing";
    return;
  }

  // start drawing, erasing, or lasso
  if (currentTool?.startsWith("pen")) {
    isDrawing = true;
    strokes.push({ tool: currentTool, size: +el.penSizeSlider.value, points: [pt] });
    redraw();
  } else if (currentTool === "eraser") {
    isErasing  = true;
    eraserPath = [pt];
  } else if (currentTool === "lasso") {
    // if click is inside existing selectionBox, start dragging
    if (selectionBox &&
        pt.x >= selectionBox.x && pt.x <= selectionBox.x + selectionBox.w &&
        pt.y >= selectionBox.y && pt.y <= selectionBox.y + selectionBox.h) {
      isDraggingSelection = true;
      dragStart = pt;
      return;
    }
    // otherwise begin a new lasso
    isLassoing       = true;
    lassoPath        = [pt];
    selectionBox     = null;
    selectedStrokes  = [];
    selectedImages   = [];
    return;
  }
}

// ------------------------------
// pointer move handler
// ------------------------------
function onPointerMove(e) {

 if (!isLocked && e.pointerType === 'touch' && pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [p1, p2] = Array.from(pointers.values());
      const dist     = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const newScale = Math.min(
        Math.max(0.2, initialScale * (dist / initialPinchDist)),
        5
      );

      const worldC = screenToWorld(pinchCenter.x, pinchCenter.y);
      const rect   = canvas.getBoundingClientRect();
      offsetX = pinchCenter.x - rect.left - worldC.x * newScale;
      offsetY = pinchCenter.y - rect.top  - worldC.y * newScale;
      scale   = newScale;
      redraw();
      return;  // skip all other move logic while pinching
    }
  }


  const pt = screenToWorld(e.clientX, e.clientY);

  // handle dragging a selection
  if (isDraggingSelection) {
    const dx = pt.x - dragStart.x;
    const dy = pt.y - dragStart.y;
    // move strokes
    selectedStrokes.forEach(s =>
      s.points.forEach(p => { p.x += dx; p.y += dy; })
    );
    // move images
    selectedImages.forEach(img => {
      img.x += dx; img.y += dy;
    });
    // during elements:
    selectedElements.forEach(elm => {
    elm.x += dx;
    elm.y += dy;
    });

    // move the box
    selectionBox.x += dx;
    selectionBox.y += dy;
    dragStart = pt;
    redraw();
    return;
  }

  if (isPanning) {
    offsetX = panStart.offsetX + (e.clientX - panStart.x);
    offsetY = panStart.offsetY + (e.clientY - panStart.y);
    redraw();
    return;
  }
  if (!isLocked) return;

  if (isDrawing) {
    strokes.at(-1).points.push(pt);
    redraw();
  } else if (isErasing) {
    eraserPath.push(pt);
    handleEraserMove(pt);
    redraw();
  } else if (isLassoing) {
    lassoPath.push(pt);
    const xs = lassoPath.map(p => p.x), ys = lassoPath.map(p => p.y);
    selectionBox = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys)
    };
    redraw();
    return;
  }
}

// ------------------------------
// pointer up handler (global)
// ------------------------------
function onPointerUp(e) {
// finish image placement if we started it
if (isPlacingImage) {
  const world = screenToWorld(placeImageScreen.x, placeImageScreen.y);
  handleImagePaste(world.x, world.y);
  isPlacingImage = false;
  return;
}


     if (e.pointerType === 'touch') {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      initialPinchDist = 0;
    }
  }
  const pt = screenToWorld(e.clientX, e.clientY);

   if (isDraggingSelection) {
    isDraggingSelection = false;
    saveBoard();
    return;
  }

  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = "grab";
    return;
  }
  if (!isLocked) return;

  if (isDrawing) {
    // finish stroke
    strokes.at(-1).points.push(pt);
    isDrawing = false;
    saveBoard();
  } else if (isErasing) {
     isErasing   = false;
    eraserPath  = [];
    redraw();
    saveBoard();
    return;
  } else  if (isLassoing) {
    isLassoing = false;
    finalizeLasso();
    lassoPath = [];    // ← clear the drawn lasso

    redraw();
    return;
  }


}

// ------------------------------
// wheel handler for zoom
// ------------------------------
function onWheel(e) {
  // don’t zoom when unmovable
  if (isLocked) return;

  e.preventDefault();
  const rect  = canvas.getBoundingClientRect();
  const mouse = screenToWorld(e.clientX, e.clientY);
  const delta = -e.deltaY * 0.001;
  const newScale = Math.min(Math.max(0.2, scale * (1 + delta)), 5);

  offsetX = e.clientX - rect.left - mouse.x * newScale;
  offsetY = e.clientY - rect.top  - mouse.y * newScale;
  scale   = newScale;
  redraw();
}



// ------------------------------
// redraw entire canvas
// ------------------------------
function redraw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  // draw strokes
  strokes.forEach(s => {
    ctx.strokeStyle = s.tool === "pen-red"   ? "red"
                    : s.tool === "pen-blue"  ? "blue"
                    :                          "black";
    ctx.lineWidth = s.size;
    ctx.lineCap   = "round";
    ctx.beginPath();
    s.points.forEach((p, i) =>
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    );
    ctx.stroke();
  });

  // update image overlays
  imagesArr.forEach(img => {
    const sw = img.w * scale, sh = img.h * scale;
    img.elDiv.style.left   = `${img.x * scale + offsetX}px`;
    img.elDiv.style.top    = `${img.y * scale + offsetY}px`;
    img.elDiv.style.width  = `${sw}px`;
    img.elDiv.style.height = `${sh}px`;
  });

  // draw/update interactive elements
elementsArr.forEach(e => {
  const el = e.elDiv;

  // make sure we scale around the element's top-left
  el.style.transformOrigin = "0 0";

  // compute screen position of its world-coords
  const sx = e.x * scale + offsetX;
  const sy = e.y * scale + offsetY;

  // place it there...
  el.style.left = `${sx}px`;
  el.style.top  = `${sy}px`;

  // ...and then uniformly zoom its contents
  el.style.transform = `scale(${scale})`;
});


  // debug: eraser path
  if (eraserPath.length) {
    ctx.strokeStyle = "green";
    ctx.lineWidth   = 10;
    ctx.beginPath();
    eraserPath.forEach((p, i) =>
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    );
    ctx.stroke();
  }

  // debug: lasso path
  if (lassoPath.length) {
    ctx.strokeStyle = "purple";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    lassoPath.forEach((p, i) =>
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    );
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // draw selection box
  if (selectionBox) {
    ctx.strokeStyle = "orange";
    ctx.setLineDash([10, 5]);
    ctx.lineWidth = 2;
    const b = selectionBox;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
  }
}

// ------------------------------
// draw grid of reference dots
// ------------------------------
function drawGrid() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ddd";
  for (let x = 0; x < CANVAS_WIDTH; x += REF_DOT_SPACING) {
    for (let y = 0; y < CANVAS_HEIGHT; y += REF_DOT_SPACING) {
      const sx = x * scale + offsetX;
      const sy = y * scale + offsetY;
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ------------------------------
// handle eraser collision
// ------------------------------
function handleEraserMove(pt) {
  const thresh = 10 / scale;

  // erase strokes as before
  strokes = strokes.filter(s =>
    !s.points.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) < thresh)
  );

  // erase images as before
  imagesArr = imagesArr.filter(img => {
    const inside =
      pt.x > img.x &&
      pt.x < img.x + img.w &&
      pt.y > img.y &&
      pt.y < img.y + img.h;
    if (inside) img.elDiv.remove();
    return !inside;
  });

  // now for interactive elements (flashcards, videos, textboxes, iframes…)
  elementsArr = elementsArr.filter(elm => {
    const inside =
      pt.x > elm.x &&
      pt.x < elm.x + elm.w &&
      pt.y > elm.y &&
      pt.y < elm.y + elm.h;

    if (!inside) {
      return true;  // keep anything not hit by the eraser
    }

    // if it’s an iframe-element (your PPT/Slides), ask first
    if (elm.type === "iframe-element") {
      const ok = confirm("Are you sure you want to erase this PowerPoint?");
      if (!ok) {
        return true;  // user cancelled, so keep it
      }
    }

    // otherwise (or if they confirmed), remove it
    elm.elDiv.remove();
    return false;
  });
}


// ------------------------------
// finalize lasso selection
// ------------------------------
function finalizeLasso() {
  // build bounding box from lassoPath
  const xs = lassoPath.map(p => p.x), ys = lassoPath.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  selectionBox = {
    x: minX, y: minY,
    w: maxX - minX,
    h: maxY - minY
  };

  // pick out which strokes & images are inside that box
  selectedStrokes = strokes.filter(s =>
    s.points.some(p =>
      p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
    )
  );
  selectedImages = imagesArr.filter(img =>
    img.x + img.w >= minX && img.x <= maxX &&
    img.y + img.h >= minY && img.y <= maxY
  );
  selectedElements = elementsArr.filter(elm =>
  elm.x + elm.w >= minX && elm.x <= maxX &&
  elm.y + elm.h >= minY && elm.y <= maxY
);


  // if we’re still in lasso mode, show & position the scale slider
if (currentTool === "lasso") {
  el.scaleSlider.style.display = "block";
  positionScaleSlider();
}

// record original box & object data for slider reference
  originalBox = { ...selectionBox };
  originalSelection = {
    strokes: selectedStrokes.map(s => ({
      points: s.points.map(p => ({ x: p.x, y: p.y })),
      size: s.size
    })),
    images: selectedImages.map(img => ({
      x: img.x, y: img.y, w: img.w, h: img.h
    }))
  };

  // reset slider to 1× for this new selection
  el.scaleRange.value = 1;

  // show & position the slider
  if (currentTool === "lasso") {
    el.scaleSlider.style.display = "block";
    positionScaleSlider();
  }


}


// ------------------------------
// show console message
// ------------------------------
function showConsoleMessage(text, color = "red", duration = 3000) {
  const msg = document.createElement("div");
  msg.className    = "console-message";
  msg.textContent  = text;
  msg.style.color  = color;
  el.consoleOutput.appendChild(msg);
  setTimeout(() => msg.remove(), duration);
}

// ------------------------------
// paste image from clipboard
// ------------------------------
async function handleImagePaste(worldX, worldY) {
  try {
    const clip = await navigator.clipboard.readText();
    new URL(clip);
    const img = new Image();
    img.src = clip;
    img.onload = () => {
      const containerRect = el.canvasContainer.getBoundingClientRect();
        const visibleH = containerRect.height / scale;

      const h = visibleH / 2;
      const w = h * (img.width / img.height);
      const x = worldX - w / 2;
      const y = worldY - h / 2;
      const div = document.createElement("div");
      div.style.position        = "absolute";
      div.style.backgroundImage = `url(${clip})`;
      div.style.backgroundSize  = "cover";
      div.style.pointerEvents = "none";

      el.canvasContainer.appendChild(div);
      imagesArr.push({ url: clip, x, y, w, h, elDiv: div });
      redraw();
      saveBoard();
    };
  } catch {
    showConsoleMessage("Copied text is not a valid image URL.");
  }
}

// ------------------------------
// convert screen to world coords
// ------------------------------
function screenToWorld(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (sx - rect.left - offsetX) / scale,
    y: (sy - rect.top  - offsetY) / scale
  };
}
