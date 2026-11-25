/* Pixelle-moi le cul : interface. 100 % local (aucune ressource externe). */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var MAX_SIDE = 2048;        // grand côté de l'image traitée
  var MAX_ZOOM = 8;
  var HIST_MAX = 30;
  var JPEG_QUALITY = 0.95;
  // Curseur 0 → 100 : nombre de pixels sur le grand côté, de 160 (fins) à 8 (énormes).
  // Échelle géométrique : chaque cran change la taille d'autant, en fin comme en gros.
  var FINE = 160, COARSE = 8;

  // ---------- État ----------
  // Une étape d'historique = { level } : le rendu est instantané, rien à garder en mémoire.
  var state = {
    w: 0, h: 0,
    src: null,              // ImageData de la photo
    hist: [], idx: -1,
    saved: null,            // étape exportée
    view: { z: 1, x: 0, y: 0 },
    fit: { x: 0, y: 0, w: 1, h: 1 }
  };
  var loadJob = 0;

  var stage = $('#stage'), wrap = $('#canvas-wrap');
  var painting = $('#painting'), pctx = painting.getContext('2d');
  var original = $('#original');
  var slider = $('#level'), bottomBars = $('#bottom-bars');
  var fileInput = $('#file-input'), toastEl = $('#toast');

  function current() { return state.hist[state.idx]; }

  // ---------- Chargement ----------
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (unsaved() && !window.confirm('Remplacer l’image en cours ? Elle n’a pas été exportée.')) return;
    loadFile(file);
  });

  function loadFile(file) {
    var id = ++loadJob, url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      if (id !== loadJob) { URL.revokeObjectURL(url); return; }
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
      state.out = pctx.createImageData(w, h);

      state.hist = [{ level: 0.4 }];
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

  // ---------- Pixelisation ----------
  // Blocs carrés, couleur = moyenne du bloc. La grille est centrée : les blocs
  // coupés par les bords sont répartis des deux côtés.
  function pixelate(level) {
    var w = state.w, h = state.h, s = state.src.data, o = state.out.data;
    var n = FINE * Math.pow(COARSE / FINE, level);
    var size = Math.max(1, Math.round(Math.max(w, h) / n));
    var ox = Math.floor(((Math.ceil(w / size) * size) - w) / 2);
    var oy = Math.floor(((Math.ceil(h / size) * size) - h) / 2);
    for (var by = -oy; by < h; by += size) {
      var y0 = Math.max(0, by), y1 = Math.min(h, by + size);
      for (var bx = -ox; bx < w; bx += size) {
        var x0 = Math.max(0, bx), x1 = Math.min(w, bx + size);
        var r = 0, g = 0, b = 0, c = (x1 - x0) * (y1 - y0), x, y, i;
        for (y = y0; y < y1; y++) {
          for (i = (y * w + x0) * 4, x = x0; x < x1; x++, i += 4) { r += s[i]; g += s[i + 1]; b += s[i + 2]; }
        }
        r = r / c + 0.5 | 0; g = g / c + 0.5 | 0; b = b / c + 0.5 | 0;
        for (y = y0; y < y1; y++) {
          for (i = (y * w + x0) * 4, x = x0; x < x1; x++, i += 4) { o[i] = r; o[i + 1] = g; o[i + 2] = b; o[i + 3] = 255; }
        }
      }
    }
    pctx.putImageData(state.out, 0, 0);
  }

  // Pendant le glissé, un seul rendu par image affichée
  var pending = -1;
  function preview(level) {
    if (pending < 0) requestAnimationFrame(function () { pixelate(pending); pending = -1; });
    pending = level;
  }

  function showState() {
    slider.value = Math.round(current().level * 100);
    pixelate(current().level);
    updateUI();
  }

  function change(level) {
    state.hist = state.hist.slice(0, state.idx + 1);
    state.hist.push({ level: level });
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

  // L'image suit le doigt ; l'historique retient la valeur au relâcher
  slider.addEventListener('input', function () { if (state.src) preview(slider.value / 100); });
  slider.addEventListener('change', function () {
    if (!state.src) return;
    if (Math.round(current().level * 100) !== +slider.value) change(slider.value / 100);
    else preview(current().level);
  });

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
  // 1 doigt : déplacer la vue ; 2 doigts : zoom / déplacement.
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
    if (pointers.size === 1) gesture = { type: 'pan', x: e.clientX, y: e.clientY, view: copyView() };
    else if (pointers.size === 2) gesture = { type: 'pinch', start: pair(), view: copyView() };
  });
  stage.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var g = gesture;
    if (g.type === 'pinch' && pointers.size >= 2) {
      var p = pair();
      zoomTo(g.view.z * p.d / g.start.d, g.view, g.start.x, g.start.y, p.x, p.y);
    } else if (g.type === 'pan') {
      state.view = { z: g.view.z, x: g.view.x + e.clientX - g.x, y: g.view.y + e.clientY - g.y };
      applyView();
    }
  });
  function endPointer(e) {
    if (!pointers.delete(e.pointerId)) return;
    gesture = pointers.size ? { type: 'settle' } : null;
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
    if (!entry) return;
    pixelate(entry.level); // au cas où un aperçu du curseur serait encore affiché
    painting.toBlob(function (blob) {
      if (!blob) { toast('Export impossible'); return; }
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      exported = entry;
      var name = 'pixel-' + timestamp() + '.jpg';
      exportUrl = URL.createObjectURL(blob);
      try { exportFile = new File([blob], name, { type: 'image/jpeg' }); } catch (e) { exportFile = null; }
      $('#save-preview').src = exportUrl;
      downloadBtn.href = exportUrl;
      downloadBtn.download = name;
      var canShare = !!(exportFile && navigator.canShare && navigator.canShare({ files: [exportFile] }));
      shareBtn.hidden = !canShare;
      $('#save-hint').textContent = canShare
        ? 'Touchez « Enregistrer dans Photos » puis « Enregistrer l’image ». Vous pouvez aussi faire un appui long sur l’aperçu.'
        : 'Téléchargez le fichier, ou faites un appui long sur l’aperçu pour l’enregistrer.';
      sheet.hidden = false;
    }, 'image/jpeg', JPEG_QUALITY);
  });
  shareBtn.addEventListener('click', function () {
    if (!exportFile) return;
    navigator.share({ files: [exportFile] }).then(function () {
      state.saved = exported;
      closeSheet();
      toast('Image enregistrée');
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
    $('#btn-undo').disabled = state.idx <= 0;
    $('#btn-redo').disabled = state.idx >= state.hist.length - 1;
    $('#btn-save').disabled = !current();
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
