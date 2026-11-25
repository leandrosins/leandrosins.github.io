/* Enigme-moi sur le visage : interface. 100 % local (aucune ressource externe).
   Rien n'est stocké : ni la photo, ni le code. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var MAX_SIDE = 2048;        // grand côté traité (une photo plus grande est réduite : le brouillage le supporte)
  var MAX_ZOOM = 8;
  var JPEG_QUALITY = 0.95;
  var HINTS = {
    encode: 'Retenez bien le code : sans lui, la photo ne peut pas être retrouvée.',
    decode: 'Chargez la photo brouillée telle quelle (sans la recadrer) et tapez le même code.'
  };

  var state = {
    w: 0, h: 0,
    src: null,              // ImageData de la photo chargée
    mode: 'encode',
    result: null,           // { mode, blob } : la dernière transformation
    saved: null,
    view: { z: 1, x: 0, y: 0 },
    fit: { x: 0, y: 0, w: 1, h: 1 }
  };
  var worker = null, job = 0, loadJob = 0;

  var stage = $('#stage'), wrap = $('#canvas-wrap');
  var painting = $('#painting'), pctx = painting.getContext('2d');
  var original = $('#original');
  var bottomBars = $('#bottom-bars'), codeInput = $('#code'), okBtn = $('#btn-ok');
  var statusEl = $('#status'), fileInput = $('#file-input'), toastEl = $('#toast');

  // ---------- Chargement ----------
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (unsaved() && !window.confirm('Remplacer la photo en cours ? Le résultat n’a pas été exporté.')) return;
    loadFile(file);
  });

  function loadFile(file) {
    var id = ++loadJob, url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      if (id !== loadJob) { URL.revokeObjectURL(url); return; }
      stopWork();
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
      state.result = null;
      state.saved = null;
      state.view = { z: 1, x: 0, y: 0 };
      $('#empty').hidden = true;
      wrap.hidden = false;
      bottomBars.hidden = false;
      $('#btn-new').hidden = false;
      updateUI();
      layout();
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Photo illisible'); };
    img.src = url;
  }

  // ---------- Encoder / Décoder ----------
  function setMode(mode) {
    state.mode = mode;
    ['encode', 'decode'].forEach(function (m) {
      var b = $('#mode-' + m);
      b.classList.toggle('is-active', m === mode);
      b.setAttribute('aria-pressed', m === mode ? 'true' : 'false');
    });
    $('#hint').textContent = HINTS[mode];
  }
  $('#mode-encode').addEventListener('click', function () { setMode('encode'); });
  $('#mode-decode').addEventListener('click', function () { setMode('decode'); });

  var eye = $('#btn-eye');
  eye.addEventListener('click', function () {
    var show = codeInput.classList.toggle('is-masked') === false;
    eye.setAttribute('aria-pressed', show ? 'true' : 'false');
    eye.setAttribute('aria-label', show ? 'Masquer le code' : 'Afficher le code');
  });
  codeInput.addEventListener('input', updateUI);

  // espaces au début / à la fin ignorés : le piège classique du copier-coller
  function code() { return codeInput.value.trim(); }

  $('#code-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!state.src || !code()) return;
    codeInput.blur(); // referme le clavier pour voir la photo
    run(state.mode, code());
  });

  function stopWork() {
    job++;
    if (worker) { worker.terminate(); worker = null; }
    statusEl.hidden = true;
  }

  function run(mode, key) {
    stopWork();
    var id = job;
    statusEl.hidden = false;
    $('#status-text').textContent = mode === 'encode' ? 'Brouillage…' : 'Décodage…';
    $('#progress-bar').style.width = '8%';
    okBtn.disabled = true;
    worker = new Worker('secret-worker.js');
    function fail() {
      if (id !== job) return;
      stopWork();
      updateUI();
      toast('Traitement impossible');
    }
    worker.onerror = fail;
    worker.onmessage = function (e) {
      if (id !== job) return;
      var m = e.data;
      if (m.type === 'error') { fail(); return; }
      if (m.type === 'step') { $('#progress-bar').style.width = Math.round(8 + 92 * m.index / m.count) + '%'; return; }
      stopWork();
      pctx.putImageData(new ImageData(new Uint8ClampedArray(m.buffer), state.w, state.h), 0, 0);
      painting.toBlob(function (blob) {
        if (!blob) { toast('Export impossible'); updateUI(); return; }
        state.result = { mode: mode, blob: blob };
        updateUI();
        toast(mode === 'encode' ? 'Photo brouillée' : 'Photo décodée');
      }, 'image/jpeg', JPEG_QUALITY);
    };
    var copy = state.src.data.slice().buffer;
    worker.postMessage({ buffer: copy, w: state.w, h: state.h, key: key, decode: mode === 'decode' }, [copy]);
  }

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
    if (document.activeElement === codeInput) codeInput.blur();
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
    var res = state.result;
    if (!res) return;
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exported = res;
    var name = (res.mode === 'encode' ? 'secret-' : 'decode-') + timestamp() + '.jpg';
    exportUrl = URL.createObjectURL(res.blob);
    try { exportFile = new File([res.blob], name, { type: 'image/jpeg' }); } catch (e) { exportFile = null; }
    $('#save-title').textContent = res.mode === 'encode' ? 'Votre photo est brouillée' : 'Votre photo est décodée';
    $('#save-preview').src = exportUrl;
    downloadBtn.href = exportUrl;
    downloadBtn.download = name;
    var canShare = !!(exportFile && navigator.canShare && navigator.canShare({ files: [exportFile] }));
    shareBtn.hidden = !canShare;
    $('#save-hint').textContent = (canShare
      ? 'Touchez « Enregistrer dans Photos » puis « Enregistrer l’image ». Vous pouvez aussi faire un appui long sur l’aperçu.'
      : 'Téléchargez le fichier, ou faites un appui long sur l’aperçu pour l’enregistrer.')
      + (res.mode === 'encode' ? ' Envoyez-la sans la recadrer.' : '');
    sheet.hidden = false;
  });
  shareBtn.addEventListener('click', function () {
    if (!exportFile) return;
    navigator.share({ files: [exportFile] }).then(function () {
      state.saved = exported;
      closeSheet();
      toast('Photo enregistrée');
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
  function unsaved() { return !!state.result && state.saved !== state.result; }
  window.addEventListener('beforeunload', function (e) {
    if (unsaved()) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Interface ----------
  function updateUI() {
    okBtn.disabled = !state.src || !code() || !!worker;
    $('#btn-save').disabled = !state.result;
  }

  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 1800);
  }

  setMode('encode');
  updateUI();
  layout();
})();
