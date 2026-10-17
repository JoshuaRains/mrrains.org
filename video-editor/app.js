const $ = (selector) => document.querySelector(selector);
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const esc = (value = '') => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain = (html = '') => { const el = document.createElement('div'); el.innerHTML = html; return el.textContent || ''; };
const fmt = (seconds) => {
  seconds = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
};

const defaultState = () => ({
  version: 1,
  name: 'Untitled classroom clip',
  mediaName: '',
  mediaDuration: 30,
  currentTime: 0,
  zoom: 56,
  clips: [],
  captions: [],
  selected: null
});

let state = defaultState();
let objectUrl = null;
let mediaFile = null;
let clipboard = null;
let history = [];
let future = [];
let playing = false;
let playStartedAt = 0;
let playStartedFrom = 0;
let frameRequest = null;
let focusedEditor = null;
let toastTimer = null;
let exportingVideo = false;

const video = $('#video');
const timelineContent = $('#timelineContent');
const timelineScroll = $('#timelineScroll');

function snapshot() {
  history.push(JSON.stringify({...state, selected: state.selected}));
  if (history.length > 80) history.shift();
  future = [];
}

function restore(serialized) {
  const mediaUrl = objectUrl;
  state = JSON.parse(serialized);
  renderAll();
  if (mediaUrl) video.src = mediaUrl;
}

function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(state));
  restore(history.pop());
}

function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(state));
  restore(future.pop());
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function projectDuration() {
  const clipEnd = state.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const capEnd = state.captions.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const emptyMinimum = state.clips.length || state.captions.length || state.mediaDuration ? .1 : 10;
  return Math.max(emptyMinimum, clipEnd, capEnd, state.mediaDuration || 0);
}

function renderAll() {
  renderTimeline();
  renderInspector();
  updatePlayhead();
  updateCaptions();
  $('#currentTime').textContent = fmt(state.currentTime);
  $('#duration').textContent = fmt(projectDuration());
  $('#zoom').value = state.zoom;
}

function renderRuler(width, duration) {
  const ruler = $('#ruler');
  ruler.innerHTML = '';
  const interval = state.zoom >= 90 ? 1 : state.zoom >= 45 ? 2 : 5;
  for (let t = 0; t <= duration + interval; t += interval / 2) {
    const tick = document.createElement('div');
    const major = Math.abs((t / interval) - Math.round(t / interval)) < .001;
    tick.className = `tick${major ? '' : ' minor'}`;
    tick.style.left = `${t * state.zoom}px`;
    tick.textContent = major ? (t >= 60 ? `${Math.floor(t/60)}:${String(Math.round(t%60)).padStart(2,'0')}` : `${Math.round(t)}s`) : '';
    ruler.appendChild(tick);
  }
}

function renderTimeline() {
  const duration = projectDuration();
  const width = Math.max(timelineScroll.clientWidth || 900, duration * state.zoom + 140);
  timelineContent.style.width = `${width}px`;
  renderRuler(width, duration);
  $('#videoTrack').innerHTML = '';
  $('#audioTrack').innerHTML = '';
  $('#subtitleTrack').innerHTML = '';
  state.clips.forEach(clip => addClipNode(clip, clip.type === 'video' ? $('#videoTrack') : $('#audioTrack')));
  state.captions.forEach(caption => addCaptionNode(caption, $('#subtitleTrack')));
}

function addClipNode(clip, track) {
  const el = document.createElement('div');
  el.className = `clip ${clip.type}${state.selected?.id === clip.id ? ' selected' : ''}`;
  el.dataset.id = clip.id;
  el.dataset.kind = 'clip';
  el.style.left = `${clip.start * state.zoom}px`;
  el.style.width = `${Math.max(10, clip.duration * state.zoom)}px`;
  el.innerHTML = `${clip.type === 'audio' ? '<div class="waveform"></div>' : ''}<div class="resize-handle left" title="Adjust start"></div><div class="clip-body"><div class="clip-title">${esc(clip.name)}</div><div class="clip-meta">${fmt(clip.duration)}</div></div><div class="resize-handle right" title="Adjust end"></div>`;
  bindClipPointer(el, clip, 'clip');
  track.appendChild(el);
}

function addCaptionNode(caption, track) {
  const el = document.createElement('div');
  el.className = `clip subtitle${state.selected?.id === caption.id ? ' selected' : ''}`;
  el.dataset.id = caption.id;
  el.dataset.kind = 'caption';
  el.style.left = `${caption.start * state.zoom}px`;
  el.style.width = `${Math.max(10, caption.duration * state.zoom)}px`;
  const label = plain(caption.spanish) || plain(caption.english) || 'New subtitle';
  el.innerHTML = `<div class="resize-handle left" title="Adjust start"></div><div class="clip-body"><div class="clip-title">${esc(label)}</div><div class="clip-meta">${caption.showEnglish ? 'ES + EN' : 'ES'} · ${fmt(caption.duration)}</div></div><div class="resize-handle right" title="Adjust end"></div>`;
  bindClipPointer(el, caption, 'caption');
  track.appendChild(el);
}

function bindClipPointer(el, item, kind) {
  el.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    event.preventDefault();
    state.selected = {kind, id:item.id};
    document.querySelectorAll('.clip.selected').forEach(node => node.classList.remove('selected'));
    el.classList.add('selected');
    renderInspector();
    const handle = event.target.closest('.resize-handle');
    const resizeSide = handle?.classList.contains('left') ? 'left' : handle ? 'right' : null;
    const originX = event.clientX;
    const originalStart = item.start;
    const originalDuration = item.duration;
    const originalSourceStart = item.sourceStart;
    const linked = kind === 'clip' && item.group ? state.clips.filter(c => c.group === item.group && c.id !== item.id) : [];
    const linkedStarts = linked.map(c => ({id: c.id, start: c.start, duration: c.duration, sourceStart:c.sourceStart}));
    let moved = false;
    const onMove = (e) => {
      const delta = (e.clientX - originX) / state.zoom;
      if (Math.abs(delta) > .02 && !moved) { snapshot(); moved = true; }
      if (!moved) return;
      if (resizeSide === 'right') {
        item.duration = Math.max(.2, Math.round((originalDuration + delta) * 10) / 10);
        if (item.sourceStart != null && objectUrl) item.duration = Math.min(item.duration, Math.max(.2, state.mediaDuration - item.sourceStart));
        linked.forEach((c, i) => {
          c.duration = Math.max(.2, Math.round((linkedStarts[i].duration + delta) * 10) / 10);
          if (c.sourceStart != null && objectUrl) c.duration = Math.min(c.duration, Math.max(.2, state.mediaDuration - c.sourceStart));
        });
      } else if (resizeSide === 'left') {
        let applied = Math.min(delta, originalDuration - .2);
        if (originalSourceStart != null) applied = Math.max(applied, -originalSourceStart);
        item.start = Math.max(0, Math.round((originalStart + applied) * 10) / 10);
        applied = item.start - originalStart;
        item.duration = Math.max(.2, Math.round((originalDuration - applied) * 10) / 10);
        if (originalSourceStart != null) item.sourceStart = Math.max(0, Math.round((originalSourceStart + applied) * 10) / 10);
        linked.forEach((c, i) => {
          const original = linkedStarts[i];
          c.start = Math.max(0, Math.round((original.start + applied) * 10) / 10);
          c.duration = Math.max(.2, Math.round((original.duration - applied) * 10) / 10);
          if (original.sourceStart != null) c.sourceStart = Math.max(0, Math.round((original.sourceStart + applied) * 10) / 10);
        });
      } else {
        item.start = Math.max(0, Math.round((originalStart + delta) * 10) / 10);
        linked.forEach((c, i) => c.start = Math.max(0, Math.round((linkedStarts[i].start + delta) * 10) / 10));
      }
      renderTimeline();
      updatePlayhead();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      renderTimeline();
      renderInspector();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, {once:true});
  });
}

function select(kind, id) {
  state.selected = {kind, id};
  renderTimeline();
  renderInspector();
}

function selectedItem() {
  if (!state.selected) return null;
  return state.selected.kind === 'caption' ? state.captions.find(c => c.id === state.selected.id) : state.clips.find(c => c.id === state.selected.id);
}

function renderInspector() {
  const item = selectedItem();
  $('#emptyInspector').classList.toggle('hidden', !!item);
  $('#captionInspector').classList.toggle('hidden', state.selected?.kind !== 'caption' || !item);
  $('#clipInspector').classList.toggle('hidden', state.selected?.kind !== 'clip' || !item);
  $('#selectionKind').textContent = item ? (state.selected.kind === 'caption' ? 'Subtitle' : `${item.type} clip`) : 'Nothing selected';
  if (!item) return;
  if (state.selected.kind === 'caption') {
    $('#spanishEditor').innerHTML = item.spanish;
    $('#englishEditor').innerHTML = item.english;
    $('#showEnglish').checked = item.showEnglish;
    $('#englishFields').classList.toggle('hidden', !item.showEnglish);
    $('#captionStart').value = item.start.toFixed(1);
    $('#captionDuration').value = item.duration.toFixed(1);
    $('#captionFont').value = item.style.font;
    $('#captionSize').value = item.style.size;
    $('#captionColor').value = item.style.color;
    $('#spanishHeight').value = item.style.spanishHeight;
    $('#englishHeight').value = item.style.englishHeight;
    $('#spanishHeightOut').textContent = `${item.style.spanishHeight}%`;
    $('#englishHeightOut').textContent = `${item.style.englishHeight}%`;
  } else {
    $('#clipBadge').textContent = `${item.type.toUpperCase()} CLIP`;
    $('#clipName').value = item.name;
    $('#clipStart').value = item.start.toFixed(1);
    $('#clipDuration').value = item.duration.toFixed(1);
    $('#sourceStart').value = item.sourceStart.toFixed(1);
  }
}

function activeVideoClip(time) {
  return state.clips.filter(c => c.type === 'video' && time >= c.start && time < c.start + c.duration).sort((a,b) => b.start-a.start)[0];
}

function seekProject(time, syncVideo = true) {
  state.currentTime = clamp(time, 0, projectDuration());
  const clip = activeVideoClip(state.currentTime);
  if (clip && objectUrl && syncVideo) {
    const sourceTime = clip.sourceStart + (state.currentTime - clip.start);
    if (Math.abs(video.currentTime - sourceTime) > .12) video.currentTime = sourceTime;
  }
  updatePlayhead();
  updateCaptions();
  $('#currentTime').textContent = fmt(state.currentTime);
}

function seekFromTimeline(time) {
  seekProject(time, true);
  if (playing) {
    playStartedFrom = state.currentTime;
    playStartedAt = performance.now();
    const clip = activeVideoClip(state.currentTime);
    if (clip && video.paused) video.play().catch(() => {});
  }
}

function updatePlayhead() {
  $('#playhead').style.left = `${state.currentTime * state.zoom}px`;
}

function updateCaptions() {
  const caption = state.captions.filter(c => state.currentTime >= c.start && state.currentTime < c.start + c.duration).sort((a,b) => b.start-a.start)[0];
  const spanish = $('#spanishPreview');
  const english = $('#englishPreview');
  if (!caption) { spanish.innerHTML = ''; english.innerHTML = ''; return; }
  const common = {fontFamily: caption.style.font, fontSize: `${caption.style.size}px`, color: caption.style.color};
  Object.assign(spanish.style, common, {bottom: `${caption.style.spanishHeight}%`});
  Object.assign(english.style, common, {bottom: `${caption.style.englishHeight}%`, color: caption.style.englishColor || '#ffe970'});
  spanish.innerHTML = caption.spanish;
  english.innerHTML = caption.showEnglish ? caption.english : '';
}

function play() {
  if (!objectUrl) { toast('Load a video first'); return; }
  if (playing) { pause(); return; }
  if (state.currentTime >= projectDuration() - .05) seekProject(0);
  playing = true;
  $('#playButton').textContent = '❚❚';
  playStartedAt = performance.now();
  playStartedFrom = state.currentTime;
  const clip = activeVideoClip(state.currentTime);
  if (clip) video.play().catch(() => {});
  const loop = (now) => {
    if (!playing) return;
    const next = playStartedFrom + (now - playStartedAt) / 1000;
    if (next >= projectDuration()) { seekProject(projectDuration()); pause(); return; }
    const before = activeVideoClip(state.currentTime);
    seekProject(next, false);
    const active = activeVideoClip(state.currentTime);
    if (active) {
      const desired = active.sourceStart + (state.currentTime - active.start);
      if (before?.id !== active.id || Math.abs(video.currentTime - desired) > .3) video.currentTime = desired;
      if (video.paused) video.play().catch(() => {});
    } else if (!video.paused) video.pause();
    frameRequest = requestAnimationFrame(loop);
  };
  frameRequest = requestAnimationFrame(loop);
}

function pause() {
  playing = false;
  video.pause();
  cancelAnimationFrame(frameRequest);
  $('#playButton').textContent = '▶';
}

function loadVideoFile(file) {
  if (!file || !file.type.startsWith('video/')) { toast('Please choose a video file'); return; }
  pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  mediaFile = file;
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  video.onloadedmetadata = () => {
    snapshot();
    state.mediaName = file.name;
    state.mediaDuration = video.duration;
    state.currentTime = 0;
    const group = uid();
    state.clips = [
      {id: uid(), group, type: 'video', name: file.name, start: 0, sourceStart: 0, duration: video.duration},
      {id: uid(), group, type: 'audio', name: `${file.name} audio`, start: 0, sourceStart: 0, duration: video.duration}
    ];
    state.captions = [];
    state.selected = null;
    $('#stageWrap').classList.add('has-video');
    $('#emptyStage').classList.add('hidden');
    $('#mediaInfo').classList.remove('empty');
    $('#mediaInfo').innerHTML = `<div><strong>${esc(file.name)}</strong><small>${fmt(video.duration)}</small></div>`;
    renderAll();
    fitTimeline();
    toast('Video ready to edit');
  };
}

function addCaption() {
  snapshot();
  const duration = Math.min(3, Math.max(.5, projectDuration() - state.currentTime));
  const caption = {
    id: uid(), start: state.currentTime, duration,
    spanish: 'Escribe el subtítulo', english: 'Add the English translation', showEnglish: true,
    style: {font: 'Inter, Arial, sans-serif', size: 28, color: '#ffffff', englishColor: '#ffe970', spanishHeight: 10, englishHeight: 22}
  };
  state.captions.push(caption);
  select('caption', caption.id);
  updateCaptions();
  setTimeout(() => { $('#spanishEditor').focus(); document.execCommand('selectAll', false); }, 0);
}

function splitSelected() {
  const item = selectedItem();
  if (!item) { toast('Select a clip or subtitle first'); return; }
  const cut = state.currentTime;
  if (cut <= item.start + .05 || cut >= item.start + item.duration - .05) { toast('Move the playhead inside the selected block'); return; }
  snapshot();
  const leftDuration = cut - item.start;
  const rightDuration = item.duration - leftDuration;
  if (state.selected.kind === 'caption') {
    item.duration = leftDuration;
    const clone = structuredClone(item);
    clone.id = uid(); clone.start = cut; clone.duration = rightDuration;
    state.captions.push(clone);
    select('caption', clone.id);
  } else {
    const groupItems = item.group ? state.clips.filter(c => c.group === item.group) : [item];
    const newGroup = uid();
    let selectedClone = null;
    groupItems.forEach(original => {
      original.duration = leftDuration;
      const clone = structuredClone(original);
      clone.id = uid(); clone.group = newGroup; clone.start = cut; clone.sourceStart += leftDuration; clone.duration = rightDuration;
      state.clips.push(clone);
      if (original.id === item.id) selectedClone = clone;
    });
    select('clip', selectedClone.id);
  }
  renderAll();
}

function copySelected() {
  const item = selectedItem();
  if (!item) { toast('Nothing selected'); return; }
  if (state.selected.kind === 'caption') clipboard = {kind: 'caption', items: [structuredClone(item)]};
  else {
    const items = item.group ? state.clips.filter(c => c.group === item.group) : [item];
    clipboard = {kind: 'clip', items: structuredClone(items), anchor: Math.min(...items.map(c => c.start))};
  }
  toast('Copied');
}

function paste() {
  if (!clipboard) { toast('Copy a block first'); return; }
  snapshot();
  if (clipboard.kind === 'caption') {
    const copy = structuredClone(clipboard.items[0]);
    copy.id = uid(); copy.start = state.currentTime;
    state.captions.push(copy); select('caption', copy.id);
  } else {
    const group = uid(); let selected = null;
    clipboard.items.forEach(source => {
      const copy = structuredClone(source);
      copy.id = uid(); copy.group = group; copy.start = state.currentTime + (source.start - clipboard.anchor);
      state.clips.push(copy);
      if (copy.type === 'video') selected = copy;
    });
    select('clip', selected?.id || state.clips.at(-1).id);
  }
  renderAll();
  toast('Pasted at playhead');
}

function deleteSelected() {
  const item = selectedItem();
  if (!item) return;
  snapshot();
  if (state.selected.kind === 'caption') state.captions = state.captions.filter(c => c.id !== item.id);
  else if (item.group) state.clips = state.clips.filter(c => c.group !== item.group);
  else state.clips = state.clips.filter(c => c.id !== item.id);
  state.selected = null;
  renderAll();
}

function updateCaption(prop, value) {
  const item = selectedItem();
  if (!item || state.selected.kind !== 'caption') return;
  item[prop] = value;
  renderTimeline(); updateCaptions();
}

function updateCaptionStyle(prop, value) {
  const item = selectedItem();
  if (!item || state.selected.kind !== 'caption') return;
  item.style[prop] = value;
  updateCaptions();
}

function fitTimeline() {
  state.zoom = clamp((timelineScroll.clientWidth - 120) / projectDuration(), 24, 140);
  renderAll();
}

function snapToPlayhead() {
  const x = state.currentTime * state.zoom;
  const maxScroll = Math.max(0, timelineContent.scrollWidth - timelineScroll.clientWidth);
  timelineScroll.scrollTo({left: clamp(x - timelineScroll.clientWidth / 2, 0, maxScroll), behavior: 'smooth'});
}

function download(name, content, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveProject() {
  if (!mediaFile) { toast('Load a video before saving'); return; }
  const exportState = {...state, selected: null};
  const metadata = new TextEncoder().encode(JSON.stringify({...exportState, mediaType: mediaFile.type || 'video/mp4'}));
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode('BRUHVID1'), 0);
  new DataView(header.buffer).setUint32(8, metadata.length, true);
  const blob = new Blob([header, metadata, mediaFile], {type: 'application/octet-stream'});
  const base = (state.mediaName || 'video-editor-project').replace(/\.[^.]+$/, '');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `${base}.bruh`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Editable .bruh project saved');
}

function exportCaptions() {
  if (!state.captions.length) { toast('Add at least one subtitle'); return; }
  const ts = (s) => {
    const ms = Math.round(s * 1000); const h = Math.floor(ms/3600000); const m = Math.floor(ms/60000)%60; const sec = Math.floor(ms/1000)%60; const rem = ms%1000;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(rem).padStart(3,'0')}`;
  };
  const body = state.captions.sort((a,b) => a.start-b.start).map(c => `${ts(c.start)} --> ${ts(c.start+c.duration)}\n${plain(c.spanish)}${c.showEnglish && plain(c.english) ? `\n${plain(c.english)}` : ''}\n`).join('\n');
  download('video-editor-captions.vtt', `WEBVTT\n\n${body}`, 'text/vtt');
  toast('WebVTT captions exported');
}

function drawExportCaption(ctx, caption, text, height, color) {
  if (!text) return;
  const lines = plain(text).split(/\n|\r/).filter(Boolean);
  const size = caption.style.size;
  const lineHeight = size * 1.2;
  const bottom = ctx.canvas.height * (height / 100);
  ctx.save();
  ctx.font = `600 ${size}px ${caption.style.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.88)';
  ctx.lineWidth = Math.max(3, size * .18);
  ctx.fillStyle = color;
  lines.forEach((line, index) => {
    const y = ctx.canvas.height - bottom - (lines.length - 1 - index) * lineHeight;
    ctx.strokeText(line, ctx.canvas.width / 2, y, ctx.canvas.width * .92);
    ctx.fillText(line, ctx.canvas.width / 2, y, ctx.canvas.width * .92);
  });
  ctx.restore();
}

function renderExportFrame(ctx) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
  const caption = state.captions.filter(c => state.currentTime >= c.start && state.currentTime < c.start + c.duration).sort((a,b) => b.start-a.start)[0];
  if (!caption) return;
  drawExportCaption(ctx, caption, caption.spanish, caption.style.spanishHeight, caption.style.color);
  if (caption.showEnglish) drawExportCaption(ctx, caption, caption.english, caption.style.englishHeight, caption.style.englishColor || '#ffe970');
}

async function exportVideo() {
  if (exportingVideo) return;
  if (!mediaFile || !objectUrl) { toast('Load a video before exporting'); return; }
  const mimeTypes = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs="avc1.42E01E"',
    'video/mp4'
  ];
  const mimeType = typeof MediaRecorder === 'undefined' ? null : mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType || !video.captureStream || !HTMLCanvasElement.prototype.captureStream) {
    toast('This browser cannot create MP4 files');
    return;
  }
  pause();
  const previousTime = state.currentTime;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  const outputStream = canvas.captureStream(30);
  const sourceStream = video.captureStream();
  sourceStream.getAudioTracks().forEach(track => outputStream.addTrack(track));
  const chunks = [];
  const recorder = new MediaRecorder(outputStream, {mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000});
  const finished = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = event => reject(event.error || new Error('MP4 recording failed'));
    recorder.onstop = resolve;
  });
  exportingVideo = true;
  const button = $('#exportVideo');
  button.disabled = true;
  button.textContent = 'Exporting…';
  seekProject(0);
  recorder.start(1000);
  play();
  await new Promise(resolve => {
    const draw = () => {
      renderExportFrame(ctx);
      if (playing) requestAnimationFrame(draw);
      else resolve();
    };
    requestAnimationFrame(draw);
  });
  recorder.stop();
  try {
    await finished;
    const blob = new Blob(chunks, {type:'video/mp4'});
    if (!blob.size) throw new Error('Empty MP4');
    const base = (state.mediaName || 'video-editor-export').replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${base}-subtitled.mp4`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('MP4 exported');
  } catch { toast('MP4 export failed'); }
  outputStream.getTracks().forEach(track => track.stop());
  sourceStream.getTracks().forEach(track => track.stop());
  exportingVideo = false;
  button.disabled = false;
  button.textContent = 'Export MP4';
  seekProject(previousTime);
}

async function openProject(file) {
  if (file.name.toLowerCase().endsWith('.bruh')) {
    try {
      const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      if (new TextDecoder().decode(header.slice(0, 8)) !== 'BRUHVID1') throw new Error('Invalid header');
      const metadataLength = new DataView(header.buffer).getUint32(8, true);
      if (!metadataLength || metadataLength > 10_000_000 || 12 + metadataLength >= file.size) throw new Error('Invalid metadata');
      const saved = JSON.parse(await file.slice(12, 12 + metadataLength).text());
      const embeddedVideo = new File(
        [file.slice(12 + metadataLength)],
        saved.mediaName || 'embedded-video.mp4',
        {type: saved.mediaType || 'video/mp4'}
      );
      pause();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      mediaFile = embeddedVideo;
      objectUrl = URL.createObjectURL(embeddedVideo);
      video.src = objectUrl;
      video.onloadedmetadata = () => {
        state = {...defaultState(), ...saved, selected: null};
        history = []; future = [];
        $('#stageWrap').classList.add('has-video');
        $('#emptyStage').classList.add('hidden');
        $('#mediaInfo').classList.remove('empty');
        $('#mediaInfo').innerHTML = `<div><strong>${esc(state.mediaName)}</strong><small>${fmt(state.mediaDuration)}</small></div>`;
        renderAll();
        toast('.bruh project opened');
      };
      return;
    } catch { toast('That .bruh project could not be opened'); return; }
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      pause(); state = {...defaultState(), ...JSON.parse(reader.result)}; history = []; future = []; renderAll();
      toast('Project opened — relink the original video');
    } catch { toast('That project file could not be opened'); }
  };
  reader.readAsText(file);
}

$('#videoInput').addEventListener('change', e => loadVideoFile(e.target.files[0]));
$('#projectInput').addEventListener('change', e => openProject(e.target.files[0]));
$('#dropzone').addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); });
$('#dropzone').addEventListener('dragleave', e => e.currentTarget.classList.remove('dragover'));
$('#dropzone').addEventListener('drop', e => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); loadVideoFile(e.dataTransfer.files[0]); });
$('#playButton').addEventListener('click', play);
$('#jumpBack').addEventListener('click', () => seekProject(state.currentTime - 5));
$('#jumpForward').addEventListener('click', () => seekProject(state.currentTime + 5));
$('#addCaption').addEventListener('click', addCaption);
$('#splitButton').addEventListener('click', splitSelected);
$('#copyButton').addEventListener('click', copySelected);
$('#pasteButton').addEventListener('click', paste);
$('#deleteButton').addEventListener('click', deleteSelected);
$('#undoButton').addEventListener('click', undo);
$('#redoButton').addEventListener('click', redo);
$('#fitTimeline').addEventListener('click', fitTimeline);
$('#snapPlayhead').addEventListener('click', snapToPlayhead);
$('#saveProject').addEventListener('click', saveProject);
$('#exportCaptions').addEventListener('click', exportCaptions);
$('#exportVideo').addEventListener('click', exportVideo);
$('#newProject').addEventListener('click', () => { if (!confirm('Start a new project? Unsaved edits will be lost.')) return; pause(); state = defaultState(); history=[]; future=[]; video.removeAttribute('src'); objectUrl=null; mediaFile=null; $('#stageWrap').classList.remove('has-video'); $('#emptyStage').classList.remove('hidden'); renderAll(); });
$('#zoom').addEventListener('input', e => { state.zoom = Number(e.target.value); renderTimeline(); updatePlayhead(); });

timelineContent.addEventListener('pointerdown', e => {
  if (e.target.closest('.clip')) return;
  const rect = timelineContent.getBoundingClientRect();
  const seekAtPointer = event => seekFromTimeline((event.clientX - rect.left) / state.zoom);
  seekAtPointer(e);
  const onMove = event => seekAtPointer(event);
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, {once:true});
});

['spanishEditor','englishEditor'].forEach(id => {
  const el = $(`#${id}`);
  el.addEventListener('focus', () => focusedEditor = el);
  el.addEventListener('input', () => updateCaption(id === 'spanishEditor' ? 'spanish' : 'english', el.innerHTML));
});
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => {
  (focusedEditor || $('#spanishEditor')).focus(); document.execCommand(button.dataset.command, false); (focusedEditor || $('#spanishEditor')).dispatchEvent(new Event('input'));
}));
$('#showEnglish').addEventListener('change', e => { snapshot(); updateCaption('showEnglish', e.target.checked); $('#englishFields').classList.toggle('hidden', !e.target.checked); });
$('#captionStart').addEventListener('change', e => { snapshot(); updateCaption('start', Math.max(0, Number(e.target.value))); renderAll(); });
$('#captionDuration').addEventListener('change', e => { snapshot(); updateCaption('duration', Math.max(.2, Number(e.target.value))); renderAll(); });
$('#captionFont').addEventListener('change', e => { snapshot(); updateCaptionStyle('font', e.target.value); });
$('#captionSize').addEventListener('change', e => { snapshot(); updateCaptionStyle('size', clamp(Number(e.target.value), 14, 72)); });
$('#captionColor').addEventListener('input', e => updateCaptionStyle('color', e.target.value));
$('#spanishHeight').addEventListener('input', e => { updateCaptionStyle('spanishHeight', Number(e.target.value)); $('#spanishHeightOut').textContent = `${e.target.value}%`; });
$('#englishHeight').addEventListener('input', e => { updateCaptionStyle('englishHeight', Number(e.target.value)); $('#englishHeightOut').textContent = `${e.target.value}%`; });

function clipField(id, prop, transform = v => v) {
  $(`#${id}`).addEventListener('change', e => {
    const item = selectedItem(); if (!item || state.selected.kind !== 'clip') return;
    snapshot(); const value = transform(e.target.value); item[prop] = value;
    if (item.group) state.clips.filter(c => c.group === item.group && c.id !== item.id).forEach(c => c[prop] = value);
    renderAll();
  });
}
clipField('clipName','name');
clipField('clipStart','start', v => Math.max(0, Number(v)));
clipField('clipDuration','duration', v => Math.max(.1, Number(v)));
clipField('sourceStart','sourceStart', v => Math.max(0, Number(v)));

document.addEventListener('keydown', e => {
  const typing = e.target.matches('input, select, [contenteditable="true"]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
  if (typing) return;
  if (e.code === 'Space') { e.preventDefault(); play(); }
  else if (e.key.toLowerCase() === 's') splitSelected();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') copySelected();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') paste();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') e.shiftKey ? redo() : undo();
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  else if (e.key === 'ArrowLeft') seekProject(state.currentTime - (e.shiftKey ? 1 : .1));
  else if (e.key === 'ArrowRight') seekProject(state.currentTime + (e.shiftKey ? 1 : .1));
});

window.addEventListener('resize', () => renderTimeline());
renderAll();

// Compact browser-agent controls. These operate on the same state and render
// path as the visible editor, so human and agent edits stay in sync.
function sanitizeCaptionHtml(value) {
  const template = document.createElement('template');
  template.innerHTML = String(value ?? '');
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'BR']);
  const clean = (node) => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed.has(child.tagName)) child.replaceWith(...child.childNodes);
        else { [...child.attributes].forEach(attr => child.removeAttribute(attr.name)); clean(child); }
      }
    });
  };
  clean(template.content);
  return template.innerHTML;
}

function compactEditState(includeStyles = false) {
  return {
    media: {loaded: Boolean(objectUrl), name: state.mediaName, duration: Number((state.mediaDuration || 0).toFixed(2))},
    playhead: Number(state.currentTime.toFixed(2)),
    duration: Number(projectDuration().toFixed(2)),
    selected: state.selected,
    clips: state.clips.map(c => ({id:c.id, group:c.group, type:c.type, name:c.name, start:+c.start.toFixed(2), duration:+c.duration.toFixed(2), sourceStart:+c.sourceStart.toFixed(2)})),
    captions: state.captions.map(c => ({
      id:c.id, start:+c.start.toFixed(2), duration:+c.duration.toFixed(2),
      spanish:c.spanish, english:c.english, showEnglish:c.showEnglish,
      ...(includeStyles ? {style:c.style} : {})
    }))
  };
}

function findAnyItem(id) {
  const caption = state.captions.find(c => c.id === id);
  if (caption) return {kind:'caption', item:caption};
  const clip = state.clips.find(c => c.id === id);
  if (clip) return {kind:'clip', item:clip};
  throw new Error(`No timeline item with id ${id}`);
}

function applyAgentOperation(op) {
  if (!op || typeof op !== 'object' || typeof op.action !== 'string') throw new Error('Each operation needs an action.');
  const number = (value, label, min = 0) => {
    const result = Number(value);
    if (!Number.isFinite(result) || result < min) throw new Error(`${label} must be a number at least ${min}.`);
    return Math.round(result * 100) / 100;
  };
  if (op.action === 'seek') {
    seekProject(number(op.at, 'at'));
    return {action:'seek', at:state.currentTime};
  }
  if (op.action === 'select') {
    const found = findAnyItem(String(op.id));
    state.selected = {kind:found.kind, id:found.item.id};
    return {action:'select', id:found.item.id};
  }
  if (op.action === 'add_caption') {
    const caption = {
      id:uid(), start:number(op.start ?? state.currentTime, 'start'), duration:number(op.duration ?? 3, 'duration', .2),
      spanish:sanitizeCaptionHtml(op.spanish ?? ''), english:sanitizeCaptionHtml(op.english ?? ''), showEnglish:op.showEnglish !== false,
      style:{font:'Inter, Arial, sans-serif', size:28, color:'#ffffff', englishColor:'#ffe970', spanishHeight:10, englishHeight:22, ...(op.style || {})}
    };
    state.captions.push(caption); state.selected = {kind:'caption', id:caption.id};
    return {action:'add_caption', id:caption.id};
  }
  const found = findAnyItem(String(op.id));
  const item = found.item;
  if (op.action === 'update_caption') {
    if (found.kind !== 'caption') throw new Error(`${op.id} is not a caption.`);
    if ('start' in op) item.start = number(op.start, 'start');
    if ('duration' in op) item.duration = number(op.duration, 'duration', .2);
    if ('spanish' in op) item.spanish = sanitizeCaptionHtml(op.spanish);
    if ('english' in op) item.english = sanitizeCaptionHtml(op.english);
    if ('showEnglish' in op) item.showEnglish = Boolean(op.showEnglish);
    if (op.style && typeof op.style === 'object') item.style = {...item.style, ...op.style};
    return {action:'update_caption', id:item.id};
  }
  if (op.action === 'move') {
    const start = number(op.start, 'start');
    if (found.kind === 'clip' && item.group) state.clips.filter(c => c.group === item.group).forEach(c => c.start = start);
    else item.start = start;
    return {action:'move', id:item.id, start};
  }
  if (op.action === 'resize') {
    const duration = number(op.duration, 'duration', .2);
    if (found.kind === 'clip' && item.group) state.clips.filter(c => c.group === item.group).forEach(c => c.duration = duration);
    else item.duration = duration;
    return {action:'resize', id:item.id, duration};
  }
  if (op.action === 'delete') {
    if (found.kind === 'caption') state.captions = state.captions.filter(c => c.id !== item.id);
    else if (item.group) state.clips = state.clips.filter(c => c.group !== item.group);
    else state.clips = state.clips.filter(c => c.id !== item.id);
    if (state.selected?.id === item.id) state.selected = null;
    return {action:'delete', id:item.id};
  }
  if (op.action === 'split') {
    const at = number(op.at, 'at');
    if (at <= item.start + .05 || at >= item.start + item.duration - .05) throw new Error(`Split time must be inside ${item.id}.`);
    const leftDuration = at - item.start;
    const rightDuration = item.duration - leftDuration;
    if (found.kind === 'caption') {
      item.duration = leftDuration;
      const clone = structuredClone(item); clone.id = uid(); clone.start = at; clone.duration = rightDuration;
      state.captions.push(clone); state.selected = {kind:'caption', id:clone.id};
      return {action:'split', id:item.id, newId:clone.id};
    }
    const originals = item.group ? state.clips.filter(c => c.group === item.group) : [item];
    const group = uid(); let newId;
    originals.forEach(original => {
      original.duration = leftDuration;
      const clone = structuredClone(original); clone.id = uid(); clone.group = group; clone.start = at; clone.sourceStart += leftDuration; clone.duration = rightDuration;
      state.clips.push(clone); if (original.id === item.id) newId = clone.id;
    });
    state.selected = {kind:'clip', id:newId};
    return {action:'split', id:item.id, newId};
  }
  throw new Error(`Unsupported action: ${op.action}`);
}

function registerBrowserAgentTools() {
  const registry = document.modelContext;
  if (typeof registry?.registerTool !== 'function') return;
  const report = error => console.warn('Browser-agent tool registration failed', error);
  try {
    Promise.resolve(registry.registerTool({
      name:'read_edit_state',
      description:'Read the current Video Editor playhead, clips, and bilingual captions in one compact response. Use before editing when IDs or timing are unknown.',
      inputSchema:{type:'object', properties:{includeStyles:{type:'boolean'}}, additionalProperties:false},
      annotations:{readOnlyHint:true},
      execute(input = {}) { return compactEditState(Boolean(input.includeStyles)); }
    })).catch(report);
    Promise.resolve(registry.registerTool({
      name:'batch_edit_project',
      description:'Apply several Video Editor timeline or bilingual-caption edits in one call. Actions: seek, select, add_caption, update_caption, move, resize, split, delete. Caption text accepts only b, strong, i, em, and br HTML.',
      inputSchema:{
        type:'object', required:['operations'], additionalProperties:false,
        properties:{operations:{type:'array', minItems:1, maxItems:50, items:{
          type:'object', required:['action'], additionalProperties:true,
          properties:{
            action:{type:'string', enum:['seek','select','add_caption','update_caption','move','resize','split','delete']},
            id:{type:'string'}, at:{type:'number', minimum:0}, start:{type:'number', minimum:0}, duration:{type:'number', minimum:.2},
            spanish:{type:'string'}, english:{type:'string'}, showEnglish:{type:'boolean'},
            style:{type:'object', properties:{font:{type:'string'},size:{type:'number',minimum:14,maximum:72},color:{type:'string'},englishColor:{type:'string'},spanishHeight:{type:'number',minimum:4,maximum:65},englishHeight:{type:'number',minimum:8,maximum:82}},additionalProperties:false}
          }
        }}}
      },
      execute(input) {
        if (!Array.isArray(input?.operations) || !input.operations.length || input.operations.length > 50) throw new Error('operations must contain 1 to 50 edits.');
        snapshot();
        try {
          const results = input.operations.map(applyAgentOperation);
          renderAll();
          return {applied:results.length, results, playhead:+state.currentTime.toFixed(2), duration:+projectDuration().toFixed(2)};
        } catch (error) {
          const previous = history.pop();
          if (previous) restore(previous);
          throw error;
        }
      }
    })).catch(report);
  } catch (error) { report(error); }
}

registerBrowserAgentTools();
