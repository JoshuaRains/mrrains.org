const DB_NAME = 'mrrains-slides-documents';
const STORE = 'documents';
const STATE_KEY = 'mrrains-slides-document-state-v1';
const CHANNEL = 'mrrains-slides-document-sync-v1';
const channel = new BroadcastChannel(CHANNEL);
const $ = selector => document.querySelector(selector);
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

let state = readState();
let pdfCache = new Map();
let renderToken = 0;
let gesture = null;
let pdfLibraryPromise = null;

function getPdfLibrary() {
  if (window.slidesPdfJs?.getDocument) return Promise.resolve(window.slidesPdfJs);
  if (window.pdfjsLib?.getDocument) return Promise.resolve(window.pdfjsLib);
  if (!pdfLibraryPromise) {
    pdfLibraryPromise = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs')
      .then(library => {
        library.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
        window.slidesPdfJs = library;
        return library;
      })
      .catch(error => {
        pdfLibraryPromise = null;
        throw new Error(`PDF renderer could not be loaded: ${error?.message || 'unknown loading error'}`);
      });
  }
  return pdfLibraryPromise;
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    return {
      documents: Array.isArray(saved.documents) ? saved.documents : [],
      activeIndex: Number.isInteger(saved.activeIndex) ? saved.activeIndex : 0,
      pageById: saved.pageById || {}, studentViews: saved.studentViews || {},
      histories: saved.histories || {}, historyPositions: saved.historyPositions || {},
      studentViewport: saved.studentViewport || { width: 0, height: 0 },
      checkpointSoundEnabled: saved.checkpointSoundEnabled !== false
    };
  } catch { return { documents: [], activeIndex: 0, pageById: {}, studentViews: {}, histories: {}, historyPositions: {}, studentViewport: { width: 0, height: 0 }, checkpointSoundEnabled: true }; }
}

function saveState(broadcast = true) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  if (broadcast) channel.postMessage({ type: 'state', state });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(value) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
async function dbGet(id) { const db = await openDb(); return new Promise((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function dbDelete(id) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }

function ensureSlidesDocument() {
  const url = $('#slidesUrl')?.value.trim();
  const index = state.documents.findIndex(item => item.type === 'slides');
  if (url && index < 0) state.documents.unshift({ id: 'google-slides', type: 'slides', name: 'Google Slides', url });
  else if (index >= 0) state.documents[index].url = url;
  if (!url && index >= 0) state.documents.splice(index, 1);
  state.activeIndex = Math.min(state.activeIndex, Math.max(0, state.documents.length - 1));
}

function activeDocument() { return state.documents[state.activeIndex] || null; }
function viewFor(id) { return state.studentViews[id] ||= { x: 0, y: 0, zoom: 1 }; }

function buildUi() {
  const switcher = document.createElement('nav');
  switcher.className = 'document-switcher';
  switcher.setAttribute('aria-label', 'Lesson documents');
  switcher.innerHTML = `<button class="btn" data-doc-action="previous" title="Previous document" aria-label="Previous document"><span class="material-symbols-outlined">chevron_left</span></button><button class="btn" data-doc-action="teacher" title="Open teacher document editor" aria-label="Open teacher document editor"><span class="material-symbols-outlined">co_present</span></button><button class="btn" data-doc-action="next" title="Next document" aria-label="Next document"><span class="material-symbols-outlined">chevron_right</span></button><span class="document-label" aria-live="polite">Slides</span>`;
  $('.controls').appendChild(switcher);
  const stage = document.createElement('div');
  stage.className = 'document-stage'; stage.hidden = true;
  stage.innerHTML = `<div class="document-page-wrap"><canvas></canvas><svg class="document-annotation-layer"></svg></div><div class="document-page-counter"></div>`;
  $('.slides-area').appendChild(stage);
  switcher.addEventListener('click', event => { const action = event.target.closest('button')?.dataset.docAction; if (action === 'previous') moveDocument(-1); if (action === 'next') moveDocument(1); if (action === 'teacher') window.open('./teacher.html', 'slides-document-teacher', 'popup,width=1280,height=820'); });
  positionDocumentSwitcher();
  setupGestures(stage);
}

function positionDocumentSwitcher() {
  const switcher = $('.document-switcher');
  const rightTools = $('.canvas-tool-stack');
  if (!switcher || !rightTools) return;
  switcher.classList.remove('compact-position');
  switcher.classList.toggle('compact-position', switcher.getBoundingClientRect().right + 6 > rightTools.getBoundingClientRect().left);
}

function publishStudentViewport() {
  const stage = $('.document-stage');
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  state.studentViewport = { width: rect.width, height: rect.height };
  channel.postMessage({ type: 'student-viewport', viewport: state.studentViewport });
}

function renderSettingsList() {
  const list = $('#documentSettingsList'); if (!list) return;
  list.innerHTML = '';
  state.documents.filter(doc => doc.type === 'pdf').forEach(doc => {
    const row = document.createElement('div'); row.className = 'document-settings-item';
    row.innerHTML = `<span title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span><button type="button" data-remove-document="${doc.id}">Remove</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-remove-document]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.removeDocument; await dbDelete(id); pdfCache.delete(id);
    state.documents = state.documents.filter(doc => doc.id !== id); delete state.pageById[id]; delete state.studentViews[id]; delete state.histories[id]; delete state.historyPositions[id];
    state.activeIndex = Math.min(state.activeIndex, Math.max(0, state.documents.length - 1)); saveState(); renderSettingsList(); renderActive();
  }));
}

async function addFiles(files) {
  ensureSlidesDocument();
  let firstAddedId = '';
  for (const file of files) {
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) continue;
    const id = uid(); const data = await file.arrayBuffer(); await dbPut({ id, name: file.name, type: file.type, data });
    state.documents.push({ id, type: 'pdf', name: file.name }); state.pageById[id] = 1; viewFor(id);
    firstAddedId ||= id;
    try {
      const pdfLibrary = await getPdfLibrary();
      const imported = await pdfLibrary.getDocument({ data: data.slice(0) }).promise;
      const metadata = await imported.getMetadata();
      const prefix = 'MR Rains Slides edit history: ';
      if (metadata.info?.Subject?.startsWith(prefix)) {
        const actions = JSON.parse(metadata.info.Subject.slice(prefix.length));
        if (Array.isArray(actions)) { state.histories[id] = actions; state.historyPositions[id] = actions.length; }
      }
      await imported.destroy();
    } catch { /* A normal PDF simply has no embedded lesson history. */ }
  }
  if (firstAddedId) state.activeIndex = state.documents.findIndex(doc => doc.id === firstAddedId);
  saveState(); renderSettingsList(); renderActive();
}

async function getPdf(doc) {
  if (pdfCache.has(doc.id)) return pdfCache.get(doc.id);
  const record = await dbGet(doc.id); if (!record) throw new Error('Stored PDF was not found.');
  const pdfLibrary = await getPdfLibrary();
  const pdf = await pdfLibrary.getDocument({ data: record.data.slice(0) }).promise; pdfCache.set(doc.id, pdf); return pdf;
}

async function renderActive() {
  ensureSlidesDocument(); const doc = activeDocument(); const stage = $('.document-stage'); const frame = $('#slidesFrame'); const viewer = $('#fileSlideViewer');
  $('.document-label').textContent = doc?.name || 'No documents';
  const teacherButton = $('[data-doc-action="teacher"]');
  if (teacherButton) teacherButton.title = `Open teacher editor${doc ? ` — ${doc.name}` : ''}`;
  if (!doc || doc.type === 'slides') {
    stage.hidden = true; viewer.hidden = true; frame.hidden = false;
    if (doc?.url && frame.src !== doc.url) frame.src = doc.url;
    saveState(false); return;
  }
  frame.hidden = true; viewer.hidden = true; stage.hidden = false;
  requestAnimationFrame(publishStudentViewport);
  const token = ++renderToken;
  try {
    const pdf = await getPdf(doc); if (token !== renderToken) return;
    const pageNumber = Math.max(1, Math.min(pdf.numPages, state.pageById[doc.id] || 1)); state.pageById[doc.id] = pageNumber;
    const page = await pdf.getPage(pageNumber); const viewport = page.getViewport({ scale: 2 }); const canvas = stage.querySelector('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height; canvas.style.width = `${viewport.width / 2}px`; canvas.style.height = `${viewport.height / 2}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    stage.querySelector('.document-page-counter').textContent = `${pageNumber} / ${pdf.numPages}`; applyStudentTransform(); renderAnnotations(stage, doc.id, pageNumber);
  } catch (error) { stage.querySelector('.document-page-counter').textContent = error.message; }
}

function applyStudentTransform() {
  const doc = activeDocument(); if (!doc || doc.type !== 'pdf') return;
  const view = viewFor(doc.id); $('.document-page-wrap').style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom}) translate(-50%, -50%)`;
}

function setupGestures(stage) {
  const pointers = new Map();
  stage.addEventListener('pointerdown', event => { pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); stage.setPointerCapture(event.pointerId); const doc = activeDocument(); if (!doc || doc.type !== 'pdf') return; const view = viewFor(doc.id); gesture = { x: view.x, y: view.y, zoom: view.zoom, points: [...pointers.values()] }; stage.classList.add('dragging'); });
  stage.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId) || !gesture) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); const points = [...pointers.values()]; const doc = activeDocument(); const view = viewFor(doc.id);
    if (points.length === 1) { view.x = gesture.x + points[0].x - gesture.points[0].x; view.y = gesture.y + points[0].y - gesture.points[0].y; }
    else { const distance = pairDistance(points); const startDistance = pairDistance(gesture.points); const center = pairCenter(points); const startCenter = pairCenter(gesture.points); view.zoom = Math.max(.25, Math.min(6, gesture.zoom * distance / Math.max(1, startDistance))); view.x = gesture.x + center.x - startCenter.x; view.y = gesture.y + center.y - startCenter.y; }
    applyStudentTransform(); channel.postMessage({ type: 'viewport', id: doc.id, view });
  });
  const finish = event => { pointers.delete(event.pointerId); if (!pointers.size) { gesture = null; stage.classList.remove('dragging'); saveState(); } else { const doc = activeDocument(); const view = viewFor(doc.id); gesture = { x: view.x, y: view.y, zoom: view.zoom, points: [...pointers.values()] }; } };
  stage.addEventListener('pointerup', finish); stage.addEventListener('pointercancel', finish);
  stage.addEventListener('wheel', event => { const doc = activeDocument(); if (!doc || doc.type !== 'pdf') return; event.preventDefault(); const view = viewFor(doc.id); view.zoom = Math.max(.25, Math.min(6, view.zoom * Math.exp(-event.deltaY * .001))); applyStudentTransform(); saveState(); }, { passive: false });
}

function pairDistance(points) { return points.length < 2 ? 1 : Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y); }
function pairCenter(points) { return points.length < 2 ? points[0] : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }; }
function moveDocument(delta) { if (!state.documents.length) return; state.activeIndex = (state.activeIndex + delta + state.documents.length) % state.documents.length; saveState(); renderActive(); }

function renderAnnotations(stage, id, page) {
  const svg = stage.querySelector('svg'); const canvas = stage.querySelector('canvas'); svg.setAttribute('viewBox', `0 0 ${canvas.width / 2} ${canvas.height / 2}`); svg.innerHTML = '';
  const actions = (state.histories[id] || []).slice(0, state.historyPositions[id] ?? (state.histories[id] || []).length).filter(a => a.page === page);
  for (const action of actions) {
    if (action.type === 'stroke') { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', action.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')); path.setAttribute('fill', 'none'); path.setAttribute('stroke', action.color || '#ef4444'); path.setAttribute('stroke-width', action.width || 4); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.appendChild(path); }
    if (action.type === 'text') { const box = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject'); box.setAttribute('x', action.x); box.setAttribute('y', action.y - (action.size || 24)); box.setAttribute('width', action.width || 220); box.setAttribute('height', action.height || 54); const text = document.createElementNS('http://www.w3.org/1999/xhtml', 'div'); text.style.cssText = `color:${action.color || '#ef4444'};font:${action.size || 24}px/1.25 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;`; text.textContent = action.text; box.appendChild(text); svg.appendChild(box); }
  }
}

function setupSounds() {
  const timer = $('#timerSoundSelect'); const enabled = $('#checkpointSoundEnabled'); const bell = $('#bellSound');
  enabled.checked = state.checkpointSoundEnabled;
  const apply = () => { const timerAudio = $('#ding'); bell.src = timerAudio.currentSrc || timerAudio.src; };
  timer.addEventListener('change', () => setTimeout(apply));
  enabled.addEventListener('change', () => { state.checkpointSoundEnabled = enabled.checked; saveState(); });
  new MutationObserver(apply).observe($('#ding'), { attributes: true, attributeFilter: ['src'] });
  setTimeout(apply);
  window.playTimelineTick = () => { if (!state.checkpointSoundEnabled) return; const audio = $('#ding'); audio.currentTime = 0; audio.play().catch(() => {}); };
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]); }

$('#slideFiles').addEventListener('change', event => { if (!event.target.files?.length) return; event.stopImmediatePropagation(); addFiles(event.target.files); event.target.value = ''; }, true);
$('#slidesUrl').addEventListener('change', () => { ensureSlidesDocument(); saveState(); renderActive(); });
$('#slidesReloadBtn').addEventListener('click', () => { const doc = activeDocument(); if (!doc || doc.type === 'slides') { const frame = $('#slidesFrame'); const src = frame.src; frame.src = 'about:blank'; requestAnimationFrame(() => { frame.src = src; }); } else { pdfCache.delete(doc.id); renderActive(); } });
window.addEventListener('resize', () => { positionDocumentSwitcher(); publishStudentViewport(); });
channel.onmessage = event => { if (event.data?.type === 'state') { state = event.data.state; renderSettingsList(); if (event.data.annotationsOnly && activeDocument()?.type === 'pdf') renderAnnotations($('.document-stage'), activeDocument().id, state.pageById[activeDocument().id] || 1); else renderActive(); } if (event.data?.type === 'viewport') { state.studentViews[event.data.id] = event.data.view; if (activeDocument()?.id === event.data.id) applyStudentTransform(); } };
function initializeDocumentWorkspace() {
  buildUi(); ensureSlidesDocument(); setupSounds(); renderSettingsList(); renderActive(); publishStudentViewport(); saveState(false);
  new ResizeObserver(publishStudentViewport).observe($('.document-stage'));
  const switcherLayoutObserver = new ResizeObserver(positionDocumentSwitcher);
  switcherLayoutObserver.observe($('.controls'));
  switcherLayoutObserver.observe($('.canvas-tool-stack'));
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initializeDocumentWorkspace, { once: true });
else initializeDocumentWorkspace();
