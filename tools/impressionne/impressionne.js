/* Impressionne moi : interface. 100 % local (aucune ressource externe). */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var MAX_SIDE = 1700;        // grand côté du tableau (compromis qualité / mémoire / temps sur iPhone)
  var FOCUS_RADIUS = 0.12;    // rayon d'un point de finesse, divisé par le zoom courant
  var MAX_POINTS = 12;
  var MAX_ZOOM = 8;
  var HIST_MAX = 30;
  var JPEG_QUALITY = 0.93;
  var STEPS = ['Grandes masses…', 'Formes…', 'Modelé…', 'Détails…', 'Accents…', 'Matière…'];

  // ---------- État ----------
  // Une étape d'historique = { abstraction, focus, seed, blob } ;
  // blob = le tableau fini, pour que précédent / suivant ne recalcule rien.
  var state = {
    w: 0, h: 0,
    src: null,              // ImageData de la photo
    hist: [], idx: -1,
    saved: null,
    view: { z: 1, x: 0, y: 0 },
    fit: { x: 0, y: 0, w: 1, h: 1 }
  };
  var worker = null, job = 0, loadJob = 0;

  var stage = $('#stage'), wrap = $('#canvas-wrap');
  var painting = $('#painting'), pctx = painting.getContext('2d');
  var original = $('#original');
  var pointsEl = $('#points'), slider = $('#abstraction'), bottomBars = $('#bottom-bars');
  var statusEl = $('#status'), fileInput = $('#file-input'), toastEl = $('#toast');

  function current() { return state.hist[state.idx]; }

  // ---------- Chargement ----------
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (unsaved() && !window.confirm('Remplacer le tableau en cours ? Il n’a pas été exporté.')) return;
    loadFile(file);
  });

  function loadFile(file) {
    var id = ++loadJob, url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      if (id !== loadJob) { URL.revokeObjectURL(url); return; }
      stopPainting();
      var k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(8, Math.round(img.naturalWidth * k)), h = Math.max(8, Math.round(img.naturalHeight * k));
      original.width = painting.width = w;
      original.height = painting.height = h;
      var octx = original.getContext('2d');
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, w, h);
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      state.src = octx.getImageData(0, 0, w, h);
      state.w = w; state.h = h;
      pctx.drawImage(original, 0, 0);

      state.hist = [{ abstraction: 0.45, focus: [], seed: 1, blob: null }];
      state.idx = 0;
      state.saved = null;
      state.view = { z: 1, x: 0, y: 0 };
      $('#empty').hidden = true;
      wrap.hidden = false;
      bottomBars.hidden = false;
      $('#btn-new').hidden = false;
      layout();
      showState();
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Photo illisible'); };
    img.src = url;
  }

  // ---------- Peinture ----------
  function stopPainting() {
    job++;
    if (worker) { worker.terminate(); worker = null; }
    statusEl.hidden = true;
  }

  function progress(step) {
    $('#status-text').textContent = STEPS[step];
    $('#progress-bar').style.width = Math.round((step + 0.5) / STEPS.length * 100) + '%';
  }

  function render(entry) {
    stopPainting();
    var id = job;
    statusEl.hidden = false;
    progress(0);
    worker = new Worker('paint-worker.js');
    worker.onerror = function () {
      if (id !== job) return;
      stopPainting();
      toast('Peinture impossible');
    };
    worker.onmessage = function (e) {
      if (id !== job) return;
      var m = e.data;
      if (m.type === 'error') { stopPainting(); toast('Peinture impossible'); return; }
      if (m.buffer) pctx.putImageData(new ImageData(new Uint8ClampedArray(m.buffer), state.w, state.h), 0, 0);
      if (m.type === 'layer') { progress(m.index + 1); return; }
      stopPainting();
      painting.toBlob(function (blob) {
        if (!blob) { toast('Export impossible'); return; }
        // le canvas est copié à l'appel de toBlob : ce blob est bien celui de cette étape
        entry.blob = blob;
        updateUI();
      }, 'image/jpeg', JPEG_QUALITY);
    };
    var copy = state.src.data.slice().buffer;
    worker.postMessage({
      buffer: copy, w: state.w, h: state.h,
      options: { abstraction: entry.abstraction, focus: entry.focus, seed: entry.seed }
    }, [copy]);
  }

  // Affiche l'étape courante : depuis sa copie si elle existe, sinon on peint.
  function showState() {
    var entry = current();
    slider.value = Math.round(entry.abstraction * 100);
    drawPoints();
    updateUI();
    if (!entry.blob) { render(entry); return; }
    stopPainting();
    var id = job, url = URL.createObjectURL(entry.blob), img = new Image();
    img.onload = function () {
      if (id === job) pctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function change(patch) {
    var c = current();
    var next = { abstraction: c.abstraction, focus: c.focus, seed: c.seed, blob: null };
    Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
    state.hist = state.hist.slice(0, state.idx + 1);
    state.hist.push(next);
    if (state.hist.length > HIST_MAX) state.hist.shift();
    state.idx = state.hist.length - 1;
    showState();
  }

  function undo() { if (state.idx > 0) { state.idx--; showState(); } }
  function redo() { if (state.idx < state.hist.length - 1) { state.idx++; showState(); } }
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && key === 'y') { e.preventDefault(); redo(); }
  });

  slider.addEventListener('change', function () {
    if (state.src && Math.round(current().abstraction * 100) !== +slider.value) change({ abstraction: slider.value / 100 });
  });
  $('#btn-variant').addEventListener('click', function () { if (state.src) change({ seed: current().seed + 1 }); });
  $('#btn-clear').addEventListener('click', function () { if (state.src) change({ focus: [] }); });

  // Original : visible tant qu'on appuie
  var originalBtn = $('#btn-original');
  originalBtn.addEventListener('pointerdown', function (e) {
    try { originalBtn.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    wrap.classList.add('show-original');
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) {
    originalBtn.addEventListener(t, function () { wrap.classList.remove('show-original'); });
  });
  originalBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- Points de finesse ----------
  function drawPoints() {
    pointsEl.textContent = '';
    var long = Math.max(state.w, state.h);
    current().focus.forEach(function (p) {
      ['point-ring', 'point-dot'].forEach(function (cls) {
        var el = document.createElement('span');
        el.className = cls;
        el.style.left = p.x * 100 + '%';
        el.style.top = p.y * 100 + '%';
        if (cls === 'point-ring') el.style.width = 2 * p.r * long / state.w * 100 + '%';
        pointsEl.appendChild(el);
      });
    });
  }

  function onTap(px, py) {
    var f = state.fit, v = state.view, w = f.w * v.z, h = f.h * v.z;
    var x = (px - f.x - v.x) / w, y = (py - f.y - v.y) / h;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    var list = current().focus;
    for (var i = 0; i < list.length; i++) {
      if (Math.hypot((list[i].x - x) * w, (list[i].y - y) * h) < 24) { // retoucher un point l'enlève
        change({ focus: list.slice(0, i).concat(list.slice(i + 1)) });
        return;
      }
    }
    if (list.length >= MAX_POINTS) { toast(MAX_POINTS + ' points au maximum'); return; }
    // plus on est zoomé, plus la zone de finesse est petite
    change({ focus: list.concat([{ x: x, y: y, r: FOCUS_RADIUS / v.z }]) });
  }

  // ---------- Vue ----------
  function layout() {
    var top = $('#topbar').offsetHeight, bottom = bottomBars.hidden ? 0 : bottomBars.offsetHeight;
    document.documentElement.style.setProperty('--top-h', top + 'px');
    document.documentElement.style.setProperty('--bottom-h', bottom + 'px');
    if (!state.src) return;
    var W = stage.clientWidth, H = stage.clientHeight, ah = Math.max(1, H - top - bottom);
    var k = Math.min(W / state.w, ah / state.h), w = state.w * k, h = state.h * k;
    var old = state.fit.w;
    state.fit = { x: (W - w) / 2, y: top + (ah - h) / 2, w: w, h: h };
    state.view.x *= w / old; state.view.y *= w / old;
    wrap.style.left = state.fit.x + 'px';
    wrap.style.top = state.fit.y + 'px';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    applyView();
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });

  function applyView() {
    var v = state.view, f = state.fit;
    if (v.z <= 1.02) { v.z = 1; v.x = 0; v.y = 0; }
    else {
      v.x = Math.min(f.w * 0.3, Math.max(f.w * 0.7 - f.w * v.z, v.x));
      v.y = Math.min(f.h * 0.3, Math.max(f.h * 0.7 - f.h * v.z, v.y));
    }
    wrap.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.z + ')';
    pointsEl.style.setProperty('--z', v.z);
    $('#btn-zoom-reset').hidden = v.z === 1;
  }

  // Zoom : le point de l'image qui était sous (fromX, fromY) se retrouve sous (toX, toY).
  function zoomTo(z, start, fromX, fromY, toX, toY) {
    var next = Math.min(MAX_ZOOM, Math.max(1, z)), k = next / start.z, f = state.fit;
    state.view = {
      z: next,
      x: toX - f.x - (fromX - f.x - start.x) * k,
      y: toY - f.y - (fromY - f.y - start.y) * k
    };
    applyView();
  }

  var resetBtn = $('#btn-zoom-reset');
  resetBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  resetBtn.addEventListener('click', function () { state.view = { z: 1, x: 0, y: 0 }; applyView(); });

  // ---------- Gestes ----------
  // 1 doigt : toucher = point de finesse ; glisser = déplacer la vue.
  // 2 doigts : toujours zoom / déplacement, jamais de point.
  var pointers = new Map(), gesture = null;
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });

  function pair() {
    var p = Array.from(pointers.values());
    return { d: Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)), x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  }
  function copyView() { return { z: state.view.z, x: state.view.x, y: state.view.y }; }

  stage.addEventListener('pointerdown', function (e) {
    if (!state.src) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) gesture = { type: 'tap', x: e.clientX, y: e.clientY, view: copyView() };
    else if (pointers.size === 2) gesture = { type: 'pinch', start: pair(), view: copyView() };
  });
  stage.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var g = gesture;
    if (g.type === 'pinch' && pointers.size >= 2) {
      var p = pair();
      zoomTo(g.view.z * p.d / g.start.d, g.view, g.start.x, g.start.y, p.x, p.y);
      return;
    }
    var dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (g.type === 'tap' && Math.hypot(dx, dy) > 9) g.type = 'pan';
    if (g.type === 'pan') {
      state.view = { z: g.view.z, x: g.view.x + dx, y: g.view.y + dy };
      applyView();
    }
  });
  function endPointer(e) {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size) { gesture = { type: 'settle' }; return; }
    var g = gesture;
    gesture = null;
    if (g && g.type === 'tap' && e.type === 'pointerup') onTap(g.x, g.y);
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('wheel', function (e) {
    if (!state.src) return;
    e.preventDefault();
    zoomTo(state.view.z * Math.exp(-e.deltaY * 0.0015), copyView(), e.clientX, e.clientY, e.clientX, e.clientY);
  }, { passive: false });

  // ---------- Export ----------
  var sheet = $('#save-sheet'), shareBtn = $('#btn-share'), downloadBtn = $('#btn-download');
  var exportFile = null, exportUrl = null, exported = null;

  $('#btn-save').addEventListener('click', function () {
    var entry = current();
    if (!entry || !entry.blob) return;
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exported = entry;
    var name = 'tableau-' + timestamp() + '.jpg';
    exportUrl = URL.createObjectURL(entry.blob);
    try { exportFile = new File([entry.blob], name, { type: 'image/jpeg' }); } catch (e) { exportFile = null; }
    $('#save-preview').src = exportUrl;
    downloadBtn.href = exportUrl;
    downloadBtn.download = name;
    var canShare = !!(exportFile && navigator.canShare && navigator.canShare({ files: [exportFile] }));
    shareBtn.hidden = !canShare;
    $('#save-hint').textContent = canShare
      ? 'Touchez « Enregistrer dans Photos » puis « Enregistrer l’image ». Vous pouvez aussi faire un appui long sur l’aperçu.'
      : 'Téléchargez le fichier, ou faites un appui long sur l’aperçu pour l’enregistrer.';
    sheet.hidden = false;
  });
  shareBtn.addEventListener('click', function () {
    if (!exportFile) return;
    navigator.share({ files: [exportFile] }).then(function () {
      state.saved = exported;
      closeSheet();
      toast('Tableau enregistré');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      downloadBtn.click();
    });
  });
  downloadBtn.addEventListener('click', function () { state.saved = exported; });
  function closeSheet() { sheet.hidden = true; }
  $('#btn-close-sheet').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });

  function timestamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function unsaved() { return !!state.src && state.saved !== current(); }
  window.addEventListener('beforeunload', function (e) {
    if (unsaved()) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Interface ----------
  function updateUI() {
    var c = current();
    $('#btn-undo').disabled = state.idx <= 0;
    $('#btn-redo').disabled = state.idx >= state.hist.length - 1;
    $('#btn-clear').disabled = !c || !c.focus.length;
    $('#btn-save').disabled = !c || !c.blob;
  }

  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 1800);
  }

  updateUI();
  layout();
})();
