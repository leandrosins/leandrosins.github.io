/* Gif Maker — vidéo → GIF animé, 100 % local (aucune ressource externe). */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  // ---------- Réglages fixes ----------
  var GIF_MAX_SEC = 10;              // durée maximale du GIF produit
  var FPS = 10;                      // images par seconde du GIF
  var SLOW = 3;                      // Erotic mod : ralenti ×3 (non modifiable)
  var MAX_BYTES = 8 * 1024 * 1024;   // poids maximal du GIF
  var LONG_SIDE = 480;               // grand côté du GIF (réduit si besoin pour tenir le poids)
  var MIN_WIN = 0.3;                 // s : extrait minimal
  var TEXT_KEY = 'gif.text.v1';

  var FONTS = [
    { id: 'bold', label: 'Gras', css: '"Avenir Next Condensed", "Arial Narrow", "Arial Black", Impact, sans-serif', weight: '800' },
    { id: 'script', label: 'Signature', css: '"Snell Roundhand", "Apple Chancery", "Segoe Script", "Brush Script MT", cursive', weight: '600' },
    { id: 'serif', label: 'Classique', css: 'Didot, "Bodoni 72", Georgia, "Times New Roman", serif', weight: '700' },
    { id: 'type', label: 'Machine', css: '"American Typewriter", "Courier New", Courier, monospace', weight: '700' },
    { id: 'marker', label: 'Feutre', css: '"Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive', weight: '700' }
  ];
  var COLORS = ['#ffffff', '#111111', '#e5332a', '#ffd23f', '#2f7bff', '#ff5fa2', '#3ecf8e'];
  var STYLES = [
    { id: 'plain', label: 'Simple' },
    { id: 'outline', label: 'Contour' },
    { id: 'stamp', label: 'Cachet' }
  ];

  // ---------- État ----------
  var state = {
    loaded: false,
    url: null,
    duration: 0,
    vw: 0, vh: 0,
    start: 0, end: 0,
    erotic: false,
    textOpen: false,
    busy: false,
    text: loadTextPrefs()
  };

  function loadTextPrefs() {
    var d = { text: '', font: 'bold', color: '#ffffff', style: 'outline', size: 9, x: 0.5, y: 0.84 };
    try {
      var s = JSON.parse(localStorage.getItem(TEXT_KEY) || 'null');
      if (s && typeof s === 'object') {
        ['text', 'font', 'color', 'style', 'size', 'x', 'y'].forEach(function (k) { if (s[k] != null) d[k] = s[k]; });
      }
    } catch (e) { /* stockage indisponible */ }
    return d;
  }
  function saveTextPrefs() {
    try { localStorage.setItem(TEXT_KEY, JSON.stringify(state.text)); } catch (e) { /* ignoré */ }
  }

  var video = $('#video'), player = $('#player'), overlay = $('#overlay'), octx = overlay.getContext('2d');
  var stage = $('#stage'), bottomBars = $('#bottom-bars'), fileInput = $('#file-input');
  var track = $('#track'), trackSel = $('#track-sel'), playhead = $('#playhead');
  var toastEl = $('#toast');
  var dpr = 1, disp = { x: 0, y: 0, w: 0, h: 0 };

  // ---------- Chargement de la vidéo ----------
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file || state.busy) return;
    if (file.type && file.type.indexOf('video/') !== 0) { toast('Choisissez une vidéo'); return; }
    loadVideo(file);
  });

  function loadVideo(file) {
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);
    state.loaded = false;
    video.pause();
    video.src = state.url;
    video.load();
  }

  video.addEventListener('loadedmetadata', function () {
    if (!video.videoWidth || !video.videoHeight) { toast('Vidéo illisible'); return; }
    if (!isFinite(video.duration)) {
      // certaines vidéos n'annoncent leur durée qu'après un saut à la fin
      video.currentTime = 1e9;
      video.addEventListener('durationchange', function once() {
        if (!isFinite(video.duration)) return;
        video.removeEventListener('durationchange', once);
        video.currentTime = 0;
        ready();
      });
      return;
    }
    ready();
  });
  video.addEventListener('error', function () {
    if (video.src) toast('Format vidéo non pris en charge par ce navigateur');
  });

  function ready() {
    state.loaded = true;
    state.duration = video.duration;
    state.vw = video.videoWidth;
    state.vh = video.videoHeight;
    state.start = 0;
    state.end = Math.min(state.duration, maxWin());
    $('#empty').hidden = true;
    player.hidden = false;
    bottomBars.hidden = false;
    $('#btn-new').hidden = false;
    applyErotic();
    layout();
    video.currentTime = 0;
    play();
    if (state.duration > maxWin() + 0.05) {
      toast('Faites glisser la zone jaune pour choisir l’extrait', 2600);
    }
  }

  function play() {
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* lecture refusée : on reste en pause */ });
  }

  // ---------- Mise en page ----------
  function layout() {
    var topH = $('#topbar').offsetHeight, botH = bottomBars.hidden ? 0 : bottomBars.offsetHeight;
    document.documentElement.style.setProperty('--top-h', topH + 'px');
    document.documentElement.style.setProperty('--bottom-h', botH + 'px');
    if (!state.loaded) return;
    var W = stage.clientWidth, H = stage.clientHeight, pad = 12;
    var aw = W - pad * 2, ah = H - topH - botH - pad * 2;
    var k = Math.min(aw / state.vw, ah / state.vh);
    var w = Math.max(1, Math.round(state.vw * k)), h = Math.max(1, Math.round(state.vh * k));
    disp = { x: Math.round((W - w) / 2), y: Math.round(topH + pad + (ah - h) / 2), w: w, h: h };
    player.style.left = disp.x + 'px';
    player.style.top = disp.y + 'px';
    player.style.width = w + 'px';
    player.style.height = h + 'px';
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    overlay.width = Math.round(w * dpr);
    overlay.height = Math.round(h * dpr);
    updateTrim();
    drawOverlay();
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });

  // ---------- Lecture en boucle de l'extrait ----------
  (function tick() {
    if (state.loaded && !state.busy && !trimDrag) {
      var t = video.currentTime;
      if (t >= state.end - 0.03 || t < state.start - 0.1) {
        video.currentTime = state.start;
        if (video.paused && !userPaused) play();
      }
      setPlayhead(video.currentTime);
    }
    requestAnimationFrame(tick);
  })();
  var userPaused = false;

  // ---------- Découpe ----------
  var EDGE = 16; // px : largeur des poignées
  function maxWin() { return GIF_MAX_SEC / (state.erotic ? SLOW : 1); }
  function trackW() { return Math.max(1, track.clientWidth - EDGE * 2); }
  function xOf(t) { return EDGE + t / state.duration * trackW(); }
  function tOf(x) { return Math.min(state.duration, Math.max(0, (x - EDGE) / trackW() * state.duration)); }

  function updateTrim() {
    if (!state.loaded) return;
    var a = xOf(state.start), b = xOf(state.end);
    trackSel.style.left = (a - EDGE) + 'px';
    trackSel.style.width = (b - a + EDGE * 2) + 'px';
    var len = state.end - state.start, out = len * (state.erotic ? SLOW : 1);
    $('#trim-range').textContent = fmtTime(state.start) + ' → ' + fmtTime(state.end);
    var o = $('#trim-out');
    o.textContent = 'GIF de ' + fmtNum(out, 1) + ' s' + (state.erotic ? ' (×' + SLOW + ')' : '');
    o.classList.toggle('is-erotic', state.erotic);
    track.classList.toggle('is-erotic', state.erotic);
  }
  function setPlayhead(t) {
    playhead.style.left = xOf(t) + 'px';
  }

  var trimDrag = null;
  track.addEventListener('pointerdown', function (e) {
    if (!state.loaded || state.busy) return;
    e.preventDefault();
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    var r = track.getBoundingClientRect(), x = e.clientX - r.left;
    var a = xOf(state.start), b = xOf(state.end);
    var ds = Math.abs(x - (a - EDGE / 2)), de = Math.abs(x - (b + EDGE / 2));
    var mode;
    if (Math.min(ds, de) <= 22) mode = ds < de || (ds === de && x < (a + b) / 2) ? 'start' : 'end';
    else if (x > a && x < b) mode = 'move';
    else {
      // toucher hors de la sélection : on y centre l'extrait
      var len = state.end - state.start;
      state.start = Math.min(state.duration - len, Math.max(0, tOf(x) - len / 2));
      state.end = state.start + len;
      mode = 'move';
      updateTrim();
    }
    trimDrag = { id: e.pointerId, mode: mode, x0: x, s0: state.start, e0: state.end, wasPaused: video.paused };
    video.pause();
    seekPreview(mode === 'end' ? state.end : state.start);
  });
  track.addEventListener('pointermove', function (e) {
    var g = trimDrag;
    if (!g || e.pointerId !== g.id) return;
    var r = track.getBoundingClientRect(), x = e.clientX - r.left;
    var dt = (x - g.x0) / trackW() * state.duration, mw = maxWin(), d = state.duration;
    if (g.mode === 'start') {
      state.start = Math.min(g.e0 - MIN_WIN, Math.max(0, g.s0 + dt));
      state.end = g.e0;
      if (state.end - state.start > mw) state.end = state.start + mw;
      seekPreview(state.start);
    } else if (g.mode === 'end') {
      state.end = Math.max(g.s0 + MIN_WIN, Math.min(d, g.e0 + dt));
      state.start = g.s0;
      if (state.end - state.start > mw) state.start = state.end - mw;
      seekPreview(state.end);
    } else {
      var len = g.e0 - g.s0;
      state.start = Math.min(d - len, Math.max(0, g.s0 + dt));
      state.end = state.start + len;
      seekPreview(state.start);
    }
    updateTrim();
  });
  function endTrim(e) {
    var g = trimDrag;
    if (!g || e.pointerId !== g.id) return;
    trimDrag = null;
    video.currentTime = state.start;
    setPlayhead(state.start);
    if (!userPaused) play();
  }
  track.addEventListener('pointerup', endTrim);
  track.addEventListener('pointercancel', endTrim);

  // Aperçu pendant la découpe : un seul saut à la fois (sinon Safari s'emmêle).
  var seekWanted = null;
  function seekPreview(t) {
    setPlayhead(t);
    if (video.seeking) { seekWanted = t; return; }
    video.currentTime = t;
  }
  video.addEventListener('seeked', function () {
    if (seekWanted != null) { var t = seekWanted; seekWanted = null; video.currentTime = t; }
  });

  function fmtNum(v, d) { return v.toFixed(d).replace('.', ','); }
  function fmtTime(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + fmtNum(Math.floor(s * 10) / 10, 1);
  }

  // ---------- Erotic mod ----------
  var eroticBtn = $('#btn-erotic');
  eroticBtn.addEventListener('click', function () {
    if (!state.loaded || state.busy) return;
    state.erotic = !state.erotic;
    if (state.end - state.start > maxWin()) state.end = state.start + maxWin();
    applyErotic();
    updateTrim();
    video.currentTime = state.start;
    toast(state.erotic ? 'Erotic mod : ralenti ×' + SLOW + ', noir & blanc' : 'Erotic mod désactivé');
  });
  function applyErotic() {
    eroticBtn.setAttribute('aria-pressed', String(state.erotic));
    player.classList.toggle('is-erotic', state.erotic);
    $('#badge-erotic').hidden = !state.erotic;
    video.playbackRate = state.erotic ? 1 / SLOW : 1;
    video.defaultPlaybackRate = video.playbackRate;
  }
  // Safari remet parfois la vitesse à 1 après un changement de source
  video.addEventListener('play', function () {
    var want = state.erotic ? 1 / SLOW : 1;
    if (Math.abs(video.playbackRate - want) > 0.01) video.playbackRate = want;
  });

  // ---------- Texte ----------
  function fontById(id) {
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i];
    return FONTS[0];
  }
  function textFont(t, px) {
    var f = fontById(t.font);
    return f.weight + ' ' + px + 'px ' + f.css;
  }
  function contrastOf(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111111' : '#ffffff';
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Boîte du texte (centrée sur x, y) dans une image W × H
  function textBox(ctx, t, W, H) {
    var s = t.size / 100 * Math.max(W, H);
    ctx.font = textFont(t, s);
    var tw = ctx.measureText(t.text).width;
    var bw = t.style === 'stamp' ? tw + s * 1.1 : tw + s * 0.4, bh = t.style === 'stamp' ? s * 1.9 : s * 1.35;
    return { cx: t.x * W, cy: t.y * H, w: bw, h: bh, s: s };
  }
  // Dessine le texte dans une image W × H (identique pour l'aperçu et le GIF).
  function drawText(ctx, t, W, H) {
    if (!t.text.trim()) return;
    var b = textBox(ctx, t, W, H), s = b.s;
    ctx.save();
    ctx.translate(b.cx, b.cy);
    ctx.font = textFont(t, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (t.style === 'plain') {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = s * 0.15;
      ctx.shadowOffsetY = s * 0.04;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
    } else if (t.style === 'outline') {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = s * 0.16;
      ctx.strokeStyle = contrastOf(t.color);
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
    } else {
      var lw = Math.max(1, s * 0.09);
      ctx.strokeStyle = t.color;
      ctx.fillStyle = t.color;
      ctx.lineWidth = lw;
      roundRect(ctx, -b.w / 2 + lw / 2, -b.h / 2 + lw / 2, b.w - lw, b.h - lw, s * 0.22);
      ctx.stroke();
      var inset = lw * 2.1;
      ctx.lineWidth = Math.max(1, s * 0.03);
      roundRect(ctx, -b.w / 2 + inset, -b.h / 2 + inset, b.w - inset * 2, b.h - inset * 2, s * 0.14);
      ctx.stroke();
      ctx.fillText(t.text, 0, 0);
    }
    ctx.restore();
  }

  function drawOverlay() {
    var c = octx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, overlay.width, overlay.height);
    if (!state.loaded || !state.text.text.trim()) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawText(c, state.text, disp.w, disp.h);
    if (state.textOpen) {
      var b = textBox(c, state.text, disp.w, disp.h);
      c.save();
      c.setLineDash([5, 4]);
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.lineWidth = 1.2;
      c.strokeRect(b.cx - b.w / 2 - 6, b.cy - b.h / 2 - 4, b.w + 12, b.h + 8);
      c.restore();
    }
  }

  // Panneau Texte
  var textBtn = $('#btn-text'), textPanel = $('#text-panel'), textInput = $('#text-input');
  function setTextOpen(open) {
    state.textOpen = open;
    textBtn.setAttribute('aria-pressed', String(open));
    textPanel.hidden = !open;
    layout();
    if (open && !state.text.text.trim()) setTimeout(function () { textInput.focus(); }, 60);
  }
  textBtn.addEventListener('click', function () { if (state.loaded) setTextOpen(!state.textOpen); });

  textInput.value = state.text.text;
  textInput.addEventListener('input', function () {
    state.text.text = textInput.value;
    saveTextPrefs();
    drawOverlay();
  });
  textInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') textInput.blur(); });
  textInput.addEventListener('blur', function () { setTimeout(layout, 300); });
  $('#text-clear').addEventListener('click', function () {
    state.text.text = '';
    textInput.value = '';
    saveTextPrefs();
    drawOverlay();
    textInput.focus();
  });

  function buildChoices(el, items, key, render) {
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      render(b, it);
      b.dataset[key] = it.id || it;
      b.addEventListener('click', function () {
        state.text[key] = it.id || it;
        saveTextPrefs();
        markChecked(el, key, state.text[key]);
        drawOverlay();
      });
      el.appendChild(b);
    });
    markChecked(el, key, state.text[key]);
  }
  function markChecked(el, key, val) {
    el.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset[key] === val)); });
  }
  buildChoices($('#text-fonts'), FONTS, 'font', function (b, f) {
    b.textContent = f.label; b.style.fontFamily = f.css; b.style.fontWeight = f.weight;
  });
  buildChoices($('#text-colors'), COLORS, 'color', function (b, c) {
    b.style.background = c; b.setAttribute('aria-label', 'Couleur ' + c);
  });
  buildChoices($('#text-styles'), STYLES, 'style', function (b, s) { b.textContent = s.label; });

  var sizeInput = $('#text-size');
  sizeInput.value = state.text.size;
  sizeInput.addEventListener('input', function () {
    state.text.size = parseFloat(sizeInput.value);
    saveTextPrefs();
    drawOverlay();
  });

  // Gestes sur la vidéo : panneau Texte ouvert → glisser = déplacer, pincer = taille.
  // Sinon : toucher le texte ouvre le panneau, toucher ailleurs = lecture / pause.
  var pointers = new Map(), gesture = null;
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });

  stage.addEventListener('pointerdown', function (e) {
    if (!state.loaded || state.busy) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      gesture = { type: 'tap', x: e.clientX, y: e.clientY, tx: state.text.x, ty: state.text.y };
    } else if (pointers.size === 2 && state.textOpen) {
      var p = Array.from(pointers.values());
      gesture = { type: 'pinch', d0: Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)), s0: state.text.size };
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var g = gesture;
    if (!g) return;
    if (g.type === 'tap' && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6) {
      g.type = state.textOpen ? 'move' : 'none';
    }
    if (g.type === 'move') {
      state.text.x = Math.min(1, Math.max(0, g.tx + (e.clientX - g.x) / disp.w));
      state.text.y = Math.min(1, Math.max(0, g.ty + (e.clientY - g.y) / disp.h));
      drawOverlay();
    } else if (g.type === 'pinch' && pointers.size >= 2) {
      var p = Array.from(pointers.values());
      var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      state.text.size = Math.min(30, Math.max(3, g.s0 * d / g.d0));
      sizeInput.value = state.text.size;
      drawOverlay();
    }
  });
  function endStagePointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    var g = gesture;
    if (pointers.size > 0) { if (g && g.type === 'pinch') gesture = { type: 'none' }; return; }
    gesture = null;
    if (!g) return;
    if (g.type === 'move' || g.type === 'pinch') { saveTextPrefs(); return; }
    if (g.type !== 'tap' || e.type === 'pointercancel') return;
    var x = g.x - disp.x, y = g.y - disp.y;
    if (x < 0 || y < 0 || x > disp.w || y > disp.h) return;
    if (state.text.text.trim()) {
      var b = textBox(octx, state.text, disp.w, disp.h);
      if (Math.abs(x - b.cx) <= b.w / 2 + 12 && Math.abs(y - b.cy) <= b.h / 2 + 12) {
        if (!state.textOpen) setTextOpen(true);
        return;
      }
    }
    if (state.textOpen) {
      // panneau ouvert : un simple toucher place le texte à cet endroit
      state.text.x = x / disp.w;
      state.text.y = y / disp.h;
      saveTextPrefs();
      drawOverlay();
      return;
    }
    if (video.paused) { userPaused = false; play(); } else { userPaused = true; video.pause(); }
  }
  stage.addEventListener('pointerup', endStagePointer);
  stage.addEventListener('pointercancel', endStagePointer);

  // ---------- Création du GIF ----------
  var busyEl = $('#busy'), bar = $('#progress-bar'), stepEl = $('#busy-step');
  var cancelled = false, worker = null;

  $('#btn-make').addEventListener('click', makeGif);
  $('#btn-cancel').addEventListener('click', function () {
    cancelled = true;
    if (worker) { worker.terminate(); worker = null; }
    finishBusy();
  });

  function setProgress(p, label) {
    bar.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
    if (label != null) stepEl.textContent = label;
  }

  function makeGif() {
    if (!state.loaded || state.busy) return;
    textInput.blur();
    state.busy = true;
    cancelled = false;
    video.pause();
    busyEl.hidden = false;
    setProgress(0, 'Préparation…');

    var slow = state.erotic ? SLOW : 1;
    var step = 1 / (FPS * slow);                 // pas dans la vidéo source
    var delay = Math.round(100 / FPS);           // centièmes de s par image du GIF
    var n = Math.max(1, Math.min(GIF_MAX_SEC * FPS, Math.floor((state.end - state.start) / step + 1e-6)));

    // Dimensions : grand côté 480 px, réduit d'emblée si le poids estimé dépasse la limite.
    var k = Math.min(1, LONG_SIDE / Math.max(state.vw, state.vh));
    var w = Math.max(2, Math.round(state.vw * k)), h = Math.max(2, Math.round(state.vh * k));
    var est = n * w * h * (state.erotic ? 0.32 : 0.55);
    if (est > MAX_BYTES * 0.85) {
      var f = Math.max(0.45, Math.sqrt(MAX_BYTES * 0.85 / est));
      w = Math.max(2, Math.round(w * f)); h = Math.max(2, Math.round(h * f));
    }

    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var cx = c.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    // étape intermédiaire ×2 : réduction plus nette depuis une vidéo HD
    var mid = null, mx = null;
    if (state.vw > w * 3) {
      mid = document.createElement('canvas');
      mid.width = w * 2; mid.height = h * 2;
      mx = mid.getContext('2d');
      mx.imageSmoothingEnabled = true;
      mx.imageSmoothingQuality = 'high';
    }
    var frames = [], t0 = state.start, text = JSON.parse(JSON.stringify(state.text)), gray = state.erotic;

    (function grab(i) {
      if (cancelled) return;
      if (i >= n) { encode(frames, w, h, delay, gray); return; }
      seekTo(t0 + i * step).then(function () {
        if (cancelled) return;
        if (mid) {
          mx.drawImage(video, 0, 0, mid.width, mid.height);
          cx.drawImage(mid, 0, 0, w, h);
        } else {
          cx.drawImage(video, 0, 0, w, h);
        }
        if (gray) toGray(cx, w, h);
        drawText(cx, text, w, h);
        frames.push(cx.getImageData(0, 0, w, h).data.buffer);
        setProgress((i + 1) / n * 0.5, 'Images ' + (i + 1) + ' / ' + n);
        grab(i + 1);
      });
    })(0);
  }

  // Noir & blanc identique à l'aperçu (filtre CSS grayscale(1) contrast(1.08))
  function toGray(cx, w, h) {
    var id = cx.getImageData(0, 0, w, h), d = id.data;
    for (var i = 0; i < d.length; i += 4) {
      var y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      y = (y - 127.5) * 1.08 + 127.5;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    cx.putImageData(id, 0, 0);
  }

  // Saut précis à un instant de la vidéo : on attend l'événement « seeked » et,
  // si le navigateur le permet, l'affichage effectif de la nouvelle image.
  function seekTo(t) {
    return new Promise(function (resolve) {
      var done = false, gotSeek = false, gotFrame = !video.requestVideoFrameCallback;
      function finish(force) {
        if (done || (!force && !(gotSeek && gotFrame))) return;
        done = true;
        clearTimeout(guard);
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }
      function onSeeked() {
        gotSeek = true;
        finish();
        setTimeout(function () { gotFrame = true; finish(); }, 90);
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(function () { gotFrame = true; finish(); });
      video.addEventListener('seeked', onSeeked);
      var guard = setTimeout(function () { finish(true); }, 3000);
      t = Math.min(state.duration - 0.001, Math.max(0, t));
      if (Math.abs(video.currentTime - t) < 1e-4) t += 1e-4;
      video.currentTime = t;
    });
  }

  function encode(frames, w, h, delay, gray) {
    setProgress(0.5, 'Encodage du GIF…');
    worker = new Worker('gif-worker.js');
    worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'progress') {
        setProgress(0.5 + m.p * 0.5, m.attempt ? 'Encodage (version plus légère)…' : 'Encodage du GIF…');
      } else if (m.type === 'done') {
        worker.terminate(); worker = null;
        var blob = new Blob([m.buffer], { type: 'image/gif' });
        finishBusy();
        showResult(blob, m.w, m.h, frames.length * delay / 100);
      } else {
        worker.terminate(); worker = null;
        finishBusy();
        toast('Création du GIF impossible');
      }
    };
    worker.onerror = function () {
      if (worker) { worker.terminate(); worker = null; }
      finishBusy();
      toast('Création du GIF impossible');
    };
    worker.postMessage({ frames: frames, w: w, h: h, delay: delay, maxBytes: MAX_BYTES, gray: gray }, frames);
  }

  function finishBusy() {
    state.busy = false;
    busyEl.hidden = true;
    video.currentTime = state.start;
    if (!userPaused) play();
  }

  // ---------- Résultat ----------
  var sheet = $('#save-sheet'), shareBtn = $('#btn-share'), downloadBtn = $('#btn-download');
  var preview = $('#save-preview');
  var exportFile = null, exportUrl = null;

  function showResult(blob, w, h, secs) {
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    var name = 'gif-' + timestamp() + '.gif';
    exportUrl = URL.createObjectURL(blob);
    try { exportFile = new File([blob], name, { type: 'image/gif' }); } catch (e) { exportFile = null; }
    preview.src = exportUrl;
    downloadBtn.href = exportUrl;
    downloadBtn.download = name;
    $('#save-info').textContent = w + ' × ' + h + ' px · ' + fmtNum(secs, 1) + ' s · ' + fmtSize(blob.size);
    var canShare = !!(exportFile && navigator.canShare && navigator.canShare({ files: [exportFile] }));
    shareBtn.hidden = !canShare;
    $('#save-hint').textContent = canShare
      ? 'Touchez « Enregistrer dans Photos » puis « Enregistrer l’image ». Le GIF reste animé dans Photos.'
      : 'Téléchargez le fichier, ou faites un appui long sur l’aperçu pour l’enregistrer.';
    sheet.hidden = false;
  }
  function fmtSize(b) {
    return b >= 1048576 ? fmtNum(b / 1048576, 1) + ' Mo' : Math.max(1, Math.round(b / 1024)) + ' Ko';
  }

  shareBtn.addEventListener('click', function () {
    if (!exportFile) return;
    navigator.share({ files: [exportFile] }).then(function () {
      closeSheet();
      toast('GIF enregistré');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      downloadBtn.click();
    });
  });
  function closeSheet() { sheet.hidden = true; }
  $('#btn-close-sheet').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });

  function timestamp() {
    var d = new Date();
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  // ---------- Toast ----------
  var toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, ms || 1800);
  }

  layout();
})();
