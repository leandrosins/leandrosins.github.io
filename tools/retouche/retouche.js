/* Easy Retouche-moi — retouche photo 100 % locale.
 * Tout se passe dans des <canvas> du navigateur : aucune donnée ne sort de l'appareil.
 *
 * Historique : la photo d'origine est conservée ; chaque retouche validée devient une
 * « opération » (flou, émoji, tampon). « Précédent » rejoue les opérations depuis l'original,
 * « Suivant » réapplique l'opération suivante.
 */
(function () {
  'use strict';

  // Côté le plus long de l'image de travail (limite mémoire des canvas sur iOS).
  var MAX_SIDE = 2560;
  var JPEG_QUALITY = 0.92;
  var STORAGE_KEY = 'retouche.stamp.v1';

  var EMOJIS = [
    '😎', '😀', '😂', '😍', '🥰', '😘', '🤩', '😇', '🥳', '😜', '🤪', '😏',
    '🙈', '🙉', '🙊', '🤫', '😴', '🤔', '😱', '🤡', '👻', '💀', '👽', '🤖',
    '🐶', '🐱', '🦊', '🐼', '🐵', '🐸', '🐷', '🦄', '🐻', '🐰', '🐥', '🦋',
    '❤️', '💖', '💯', '⭐', '🌟', '✨', '🔥', '⚡', '🌈', '☀️', '🌙', '☁️',
    '🌸', '🌹', '🌻', '🍀', '🍕', '🍩', '🍓', '🍒', '🎉', '🎈', '🎁', '👑',
    '💎', '🕶️', '🎀', '💋', '👍', '👌', '✌️', '🤘', '👏', '🙏', '👀', '💬',
    '⛔', '🚫', '❌', '✅', '📵', '🔞', '⚠️', '❓'
  ];

  var FONTS = [
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

  var EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

  // ---------- Éléments ----------
  var $ = function (s) { return document.querySelector(s); };
  var stage = $('#stage');
  var wrap = $('#canvas-wrap');
  var photo = $('#photo');
  var overlay = $('#overlay');
  var pctx = photo.getContext('2d');
  var octx = overlay.getContext('2d');
  var fileInput = $('#file-input');
  var panel = $('#panel');
  var toastEl = $('#toast');
  var undoBtn = $('#btn-undo');
  var redoBtn = $('#btn-redo');
  var zoomResetBtn = $('#btn-zoom-reset');
  var measureCtx = document.createElement('canvas').getContext('2d');

  // ---------- État ----------
  var state = {
    loaded: false,
    iw: 0,
    ih: 0,
    base: null,         // canvas de la photo d'origine
    ops: [],            // opérations validées
    idx: 0,             // nombre d'opérations appliquées
    tool: null,         // 'blur' | 'patch' | 'stamp'
    pending: null,      // émoji / tampon en cours de placement
    stroke: null,       // trait de flou en cours
    brushPreview: null, // {x, y, r} en coordonnées image
    savedIdx: 0,
    blur: { mode: 'blur', grain: 5, size: 30 },
    patch: { emoji: null, size: 22 },   // taille en % du grand côté
    stamp: loadStampPrefs(),
    view: { s: 1, tx: 0, ty: 0 },
    fit: { left: 0, top: 0, w: 0, h: 0 }
  };

  function loadStampPrefs() {
    var d = { text: '', font: 'script', color: '#ffffff', style: 'outline', size: 8, opacity: 100 };
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (s && typeof s === 'object') {
        for (var k in d) if (k in s && typeof s[k] === typeof d[k]) d[k] = s[k];
      }
    } catch (e) { /* stockage indisponible */ }
    return d;
  }
  function saveStampPrefs() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.stamp)); } catch (e) { /* ignoré */ }
  }

  // ---------- Utilitaires canvas ----------
  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function freeCanvas(c) { if (c) { c.width = 0; c.height = 0; } }
  function cloneCanvas(src) {
    var c = newCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }
  function longSide() { return Math.max(state.iw, state.ih); }

  var FILTER_OK = (function () {
    try {
      var x = document.createElement('canvas').getContext('2d');
      x.filter = 'blur(2px)';
      return x.filter === 'blur(2px)';
    } catch (e) { return false; }
  })();

  function smoothCtx(c) {
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    return x;
  }

  // Réduction progressive (moyenne correcte des couleurs).
  function downscale(src, tw, th) {
    var cur = src, cw = src.width, ch = src.height;
    while (cw / 2 > tw && ch / 2 > th) {
      cw = Math.round(cw / 2); ch = Math.round(ch / 2);
      var c = newCanvas(cw, ch);
      smoothCtx(c).drawImage(cur, 0, 0, cw, ch);
      if (cur !== src) freeCanvas(cur);
      cur = c;
    }
    var out = newCanvas(tw, th);
    smoothCtx(out).drawImage(cur, 0, 0, out.width, out.height);
    if (cur !== src) freeCanvas(cur);
    return out;
  }

  // Agrandissement progressif (lissage doux, sert de flou de secours).
  function upscaleInto(small, out) {
    var cur = small, cw = small.width, ch = small.height;
    while (cw * 2 < out.width && ch * 2 < out.height) {
      cw *= 2; ch *= 2;
      var c = newCanvas(cw, ch);
      smoothCtx(c).drawImage(cur, 0, 0, cw, ch);
      if (cur !== small) freeCanvas(cur);
      cur = c;
    }
    smoothCtx(out).drawImage(cur, 0, 0, out.width, out.height);
    if (cur !== small) freeCanvas(cur);
  }

  // Version entièrement floutée / pixelisée de l'image source.
  function makeEffect(src, mode, grain) {
    var w = src.width, h = src.height, L = Math.max(w, h);
    var out = newCanvas(w, h);
    var o = out.getContext('2d');
    if (mode === 'pixel') {
      var b = Math.max(3, Math.round(L * (0.004 + 0.0045 * grain)));
      var sw = Math.ceil(w / b), sh = Math.ceil(h / b);
      var small = downscale(src, sw, sh);
      o.imageSmoothingEnabled = false;
      o.drawImage(small, 0, 0, sw * b, sh * b);
      freeCanvas(small);
    } else {
      var r = L * (0.002 + 0.0028 * grain);
      if (FILTER_OK) {
        o.drawImage(src, 0, 0);
        o.filter = 'blur(' + r.toFixed(1) + 'px)';
        o.drawImage(src, 0, 0);
        o.filter = 'none';
      } else {
        var f = Math.max(1.5, r / 2.2);
        var s2 = downscale(src, Math.max(1, Math.round(w / f)), Math.max(1, Math.round(h / f)));
        upscaleInto(s2, out);
        freeCanvas(s2);
      }
    }
    return out;
  }

  // ---------- Trait de flou ----------
  // On calcule une fois l'image floutée, puis on la révèle à travers un masque
  // peint au doigt : le flou ne s'accumule pas et reste homogène.
  function createStroke(mode, grain, radius) {
    var w = photo.width, h = photo.height;
    var s = {
      mode: mode, grain: grain, radius: radius, points: [], last: null,
      snap: cloneCanvas(photo),
      mask: newCanvas(Math.ceil(w / 2), Math.ceil(h / 2)),
      temp: newCanvas(w, h)
    };
    s.effect = makeEffect(s.snap, mode, grain);
    return s;
  }

  function freeStroke(s) {
    if (!s) return;
    freeCanvas(s.snap); freeCanvas(s.mask); freeCanvas(s.temp); freeCanvas(s.effect);
  }

  function maskDab(s, x, y) {
    var m = s.mask.getContext('2d');
    var cx = x / 2, cy = y / 2, r = s.radius / 2;
    var g = m.createRadialGradient(cx, cy, 0, cx, cy, r);
    var inner = s.mode === 'pixel' ? 0.82 : 0.55;
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(inner, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    m.fillStyle = g;
    m.beginPath();
    m.arc(cx, cy, r, 0, Math.PI * 2);
    m.fill();
  }

  function compositeStroke(s, x0, y0, x1, y1) {
    var W = photo.width, H = photo.height;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    var w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    var t = s.temp.getContext('2d');
    t.clearRect(x0, y0, w, h);
    t.drawImage(s.effect, x0, y0, w, h, x0, y0, w, h);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(s.mask, x0 / 2, y0 / 2, w / 2, h / 2, x0, y0, w, h);
    t.globalCompositeOperation = 'source-over';
    pctx.clearRect(x0, y0, w, h);
    pctx.drawImage(s.snap, x0, y0, w, h, x0, y0, w, h);
    pctx.drawImage(s.temp, x0, y0, w, h, x0, y0, w, h);
  }

  function strokeAdd(s, x, y) {
    var pts = [];
    if (!s.last) {
      pts.push([x, y]);
    } else {
      var dx = x - s.last[0], dy = y - s.last[1];
      var d = Math.sqrt(dx * dx + dy * dy);
      var step = Math.max(1, s.radius * 0.25);
      var n = Math.floor(d / step);
      for (var i = 1; i <= n; i++) {
        pts.push([s.last[0] + dx / d * step * i, s.last[1] + dy / d * step * i]);
      }
    }
    if (!pts.length) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var j = 0; j < pts.length; j++) {
      var p = [Math.round(pts[j][0] * 10) / 10, Math.round(pts[j][1] * 10) / 10];
      s.points.push(p);
      maskDab(s, p[0], p[1]);
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    s.last = pts[pts.length - 1];
    var pad = s.radius + 2;
    compositeStroke(s, x0 - pad, y0 - pad, x1 + pad, y1 + pad);
  }

  // ---------- Émojis et tampons ----------
  function fontById(id) {
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i];
    return FONTS[0];
  }

  function itemFont(it) {
    if (it.type === 'emoji') return it.size + 'px ' + EMOJI_FONT;
    var f = fontById(it.font);
    return f.weight + ' ' + it.size + 'px ' + f.css;
  }

  // Dimensions (non tournées) de l'élément, en pixels image.
  function itemBox(it) {
    if (it.type === 'emoji') return { w: it.size * 1.2, h: it.size * 1.2 };
    measureCtx.font = itemFont(it);
    var tw = measureCtx.measureText(it.text).width;
    if (it.style === 'stamp') return { w: tw + it.size * 1.1, h: it.size * 1.9 };
    return { w: tw + it.size * 0.4, h: it.size * 1.35 };
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

  function drawItem(ctx, it) {
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot || 0);
    ctx.globalAlpha = it.opacity == null ? 1 : it.opacity;
    ctx.font = itemFont(it);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (it.type === 'emoji') {
      ctx.fillText(it.emoji, 0, it.size * 0.06);
    } else {
      var s = it.size;
      if (it.style === 'plain') {
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = s * 0.15;
        ctx.shadowOffsetY = s * 0.04;
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, 0, 0);
      } else if (it.style === 'outline') {
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = s * 0.14;
        ctx.strokeStyle = contrastOf(it.color);
        ctx.strokeText(it.text, 0, 0);
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, 0, 0);
      } else {
        var box = itemBox(it);
        var lw = Math.max(1, s * 0.09);
        ctx.strokeStyle = it.color;
        ctx.fillStyle = it.color;
        ctx.lineWidth = lw;
        roundRect(ctx, -box.w / 2 + lw / 2, -box.h / 2 + lw / 2, box.w - lw, box.h - lw, s * 0.22);
        ctx.stroke();
        var inset = lw * 2.1;
        ctx.lineWidth = Math.max(1, s * 0.03);
        roundRect(ctx, -box.w / 2 + inset, -box.h / 2 + inset, box.w - inset * 2, box.h - inset * 2, s * 0.14);
        ctx.stroke();
        ctx.fillText(it.text, 0, 0);
      }
    }
    ctx.restore();
  }

  function itemCorners(it) {
    var b = itemBox(it), c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (k) {
      var lx = k[0] * b.w / 2, ly = k[1] * b.h / 2;
      return [it.x + lx * c - ly * s, it.y + lx * s + ly * c];
    });
  }

  // ---------- Opérations / historique ----------
  function applyOp(op) {
    if (op.type === 'blur') {
      var s = createStroke(op.mode, op.grain, op.radius);
      var pad = op.radius + 2;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (var i = 0; i < op.points.length; i++) {
        var p = op.points[i];
        maskDab(s, p[0], p[1]);
        x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
        x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
      }
      compositeStroke(s, x0 - pad, y0 - pad, x1 + pad, y1 + pad);
      freeStroke(s);
    } else if (op.type === 'item') {
      drawItem(pctx, op.item);
    }
  }

  function pushOp(op) {
    state.ops.length = state.idx;
    state.ops.push(op);
    state.idx++;
    if (state.savedIdx > state.idx - 1) state.savedIdx = -1;
    updateHistoryUI();
  }

  function rerender() {
    pctx.clearRect(0, 0, photo.width, photo.height);
    pctx.drawImage(state.base, 0, 0);
    for (var i = 0; i < state.idx; i++) applyOp(state.ops[i]);
  }

  function undo() {
    if (state.pending) { discardPending(); return; }
    if (state.idx === 0) return;
    state.idx--;
    rerender();
    updateHistoryUI();
    toast('Retouche annulée');
  }

  function redo() {
    if (state.pending) commitPending();
    if (state.idx >= state.ops.length) return;
    applyOp(state.ops[state.idx]);
    state.idx++;
    updateHistoryUI();
    toast('Retouche rétablie');
  }

  function updateHistoryUI() {
    undoBtn.disabled = !state.loaded || (state.idx === 0 && !state.pending);
    redoBtn.disabled = !state.loaded || state.idx >= state.ops.length;
  }

  // ---------- Chargement ----------
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (state.loaded && state.idx > 0 && state.savedIdx !== state.idx &&
        !window.confirm('Remplacer la photo en cours ? Les retouches non sauvegardées seront perdues.')) return;
    loadFile(file);
  });

  function loadFile(file) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight;
      var k = Math.min(1, MAX_SIDE / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      freeCanvas(state.base);
      var base = newCanvas(w, h);
      var bx = smoothCtx(base);
      bx.fillStyle = '#ffffff';
      bx.fillRect(0, 0, w, h);
      if (k < 1) {
        var d = downscale(img, w, h);
        bx.drawImage(d, 0, 0);
        freeCanvas(d);
      } else {
        bx.drawImage(img, 0, 0, w, h);
      }
      URL.revokeObjectURL(url);

      state.base = base;
      state.iw = w; state.ih = h;
      state.ops = []; state.idx = 0; state.savedIdx = 0;
      state.pending = null;
      cancelStroke();
      photo.width = w; photo.height = h;
      pctx.drawImage(base, 0, 0);
      state.loaded = true;
      state.view = { s: 1, tx: 0, ty: 0 };

      $('#empty').hidden = true;
      wrap.hidden = false;
      $('#btn-new').hidden = false;
      document.querySelectorAll('.tool, #btn-save').forEach(function (b) { b.disabled = false; });
      updateHistoryUI();
      layout();
      if (state.tool === 'stamp') ensureStampPending();
      toast('Photo chargée');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      toast('Impossible de lire cette image');
    };
    img.src = url;
  }

  // ---------- Mise en page / zoom ----------
  function layout() {
    if (!state.loaded) return;
    var sw = stage.clientWidth, sh = stage.clientHeight, m = 12;
    var k = Math.min((sw - m * 2) / state.iw, (sh - m * 2) / state.ih);
    var w = Math.max(1, Math.floor(state.iw * k)), h = Math.max(1, Math.floor(state.ih * k));
    state.fit = { left: Math.round((sw - w) / 2), top: Math.round((sh - h) / 2), w: w, h: h };
    wrap.style.left = state.fit.left + 'px';
    wrap.style.top = state.fit.top + 'px';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    clampView();
    applyView();
    resizeOverlay();
  }

  function resizeOverlay() {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var z = Math.min(state.view.s, 3);
    var ow = Math.round(state.fit.w * dpr * z), oh = Math.round(state.fit.h * dpr * z);
    // Pas besoin de plus de pixels que l'image elle-même.
    var cap = Math.min(1, state.iw / ow);
    ow = Math.max(1, Math.round(ow * cap)); oh = Math.max(1, Math.round(oh * cap));
    if (overlay.width !== ow || overlay.height !== oh) { overlay.width = ow; overlay.height = oh; }
    drawOverlay();
  }

  function clampView() {
    var v = state.view, f = state.fit, sw = stage.clientWidth, sh = stage.clientHeight;
    v.s = Math.min(8, Math.max(1, v.s));
    if (v.s <= 1.001) { v.s = 1; v.tx = 0; v.ty = 0; return; }
    function axis(t, left, size, avail) {
      var scaled = size * v.s;
      if (scaled <= avail) return (avail - scaled) / 2 - left;
      return Math.min(-left, Math.max(avail - scaled - left, t));
    }
    v.tx = axis(v.tx, f.left, f.w, sw);
    v.ty = axis(v.ty, f.top, f.h, sh);
  }

  function applyView() {
    var v = state.view;
    wrap.style.transform = 'translate(' + v.tx + 'px,' + v.ty + 'px) scale(' + v.s + ')';
    zoomResetBtn.hidden = v.s <= 1;
  }

  zoomResetBtn.addEventListener('click', function () {
    state.view = { s: 1, tx: 0, ty: 0 };
    applyView();
    resizeOverlay();
  });

  if (window.ResizeObserver) {
    new ResizeObserver(function () { layout(); }).observe(stage);
  } else {
    window.addEventListener('resize', layout);
  }

  // Coordonnées écran → coordonnées image.
  function toImage(cx, cy) {
    var r = photo.getBoundingClientRect();
    return { x: (cx - r.left) * state.iw / r.width, y: (cy - r.top) * state.ih / r.height };
  }
  // Pixels image par pixel écran (tient compte du zoom).
  function imgPerCss() {
    return state.iw / photo.getBoundingClientRect().width;
  }

  // ---------- Calque d'aperçu ----------
  var rafPending = false;
  function requestOverlay() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; drawOverlay(); });
  }

  function drawOverlay() {
    var ctx = octx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!state.loaded) return;
    var sc = overlay.width / state.iw;
    var cssPx = overlay.width / (state.fit.w * state.view.s); // pixels du calque par pixel écran

    var it = state.pending;
    if (it) {
      ctx.setTransform(sc, 0, 0, sc, 0, 0);
      drawItem(ctx, it);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      var pts = itemCorners(it).map(function (p) { return [p[0] * sc, p[1] * sc]; });
      ctx.beginPath();
      pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      ctx.lineWidth = 1.5 * cssPx;
      ctx.setLineDash([6 * cssPx, 5 * cssPx]);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
      ctx.lineDashOffset = 5.5 * cssPx;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      // Poignée (agrandir / tourner)
      var hp = pts[2], hr = 13 * cssPx;
      ctx.beginPath();
      ctx.arc(hp[0], hp[1], hr, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6 * cssPx;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#7c9cff';
      ctx.lineWidth = 2 * cssPx;
      ctx.beginPath();
      var a = hr * 0.45;
      ctx.moveTo(hp[0] - a, hp[1] - a); ctx.lineTo(hp[0] + a, hp[1] + a);
      ctx.moveTo(hp[0] + a * 0.1, hp[1] + a); ctx.lineTo(hp[0] + a, hp[1] + a); ctx.lineTo(hp[0] + a, hp[1] + a * 0.1);
      ctx.moveTo(hp[0] - a * 0.1, hp[1] - a); ctx.lineTo(hp[0] - a, hp[1] - a); ctx.lineTo(hp[0] - a, hp[1] - a * 0.1);
      ctx.stroke();
    }

    var bp = state.brushPreview;
    if (bp) {
      ctx.beginPath();
      ctx.arc(bp.x * sc, bp.y * sc, bp.r * sc, 0, Math.PI * 2);
      ctx.lineWidth = 3 * cssPx;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
      ctx.lineWidth = 1.5 * cssPx;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
    }
  }

  var brushTimer = 0;
  function flashBrush() {
    var r = photo.getBoundingClientRect();
    var c = toImage(r.left + r.width / 2, r.top + r.height / 2);
    var sr = stage.getBoundingClientRect();
    var vis = toImage(sr.left + sr.width / 2, sr.top + sr.height / 2);
    var x = Math.min(state.iw, Math.max(0, vis.x || c.x)), y = Math.min(state.ih, Math.max(0, vis.y || c.y));
    state.brushPreview = { x: x, y: y, r: state.blur.size * imgPerCss() };
    requestOverlay();
    clearTimeout(brushTimer);
    brushTimer = setTimeout(function () { state.brushPreview = null; requestOverlay(); }, 700);
  }

  // ---------- Élément en cours de placement ----------
  function sizeLimits(it) {
    var L = longSide();
    return it.type === 'emoji' ? [L * 0.03, L * 1.2] : [L * 0.015, L * 0.4];
  }
  function clampSize(it) {
    var lim = sizeLimits(it);
    it.size = Math.min(lim[1], Math.max(lim[0], it.size));
  }

  function defaultCenter() {
    // Centre de la partie visible de la photo.
    var sr = stage.getBoundingClientRect();
    var p = toImage(sr.left + sr.width / 2, sr.top + sr.height / 2);
    return { x: Math.min(state.iw * 0.95, Math.max(state.iw * 0.05, p.x)), y: Math.min(state.ih * 0.95, Math.max(state.ih * 0.05, p.y)) };
  }

  function makeEmojiItem(x, y) {
    return { type: 'emoji', emoji: state.patch.emoji, x: x, y: y, size: longSide() * state.patch.size / 100, rot: 0 };
  }

  function makeStampItem(x, y) {
    var s = state.stamp;
    return {
      type: 'text', text: s.text.trim(), font: s.font, color: s.color, style: s.style,
      opacity: s.opacity / 100, x: x, y: y, size: longSide() * s.size / 100, rot: 0
    };
  }

  function setPending(it) {
    state.pending = it;
    document.querySelectorAll('[data-item-actions]').forEach(function (el) { el.hidden = !it; });
    var hint = $('#patch-hint');
    if (hint) hint.hidden = !!it;
    updateHistoryUI();
    requestOverlay();
  }

  function commitPending() {
    var it = state.pending;
    if (!it) return false;
    if (it.type === 'text' && !it.text) { setPending(null); return false; }
    drawItem(pctx, it);
    pushOp({ type: 'item', item: it });
    setPending(null);
    toast(it.type === 'emoji' ? 'Émoji appliqué' : 'Tampon appliqué');
    return true;
  }

  function discardPending() {
    setPending(null);
  }

  function ensureStampPending() {
    if (!state.loaded || state.pending || !state.stamp.text.trim()) return;
    // Par défaut : en bas de la photo (place habituelle d'une signature),
    // ou au centre de la zone visible si l'on est zoomé.
    var c = state.view.s > 1 ? defaultCenter() : { x: state.iw / 2, y: state.ih * 0.86 };
    setPending(makeStampItem(c.x, c.y));
  }

  function syncPendingFromStamp() {
    var it = state.pending;
    if (it && it.type === 'text') {
      var n = makeStampItem(it.x, it.y);
      n.rot = it.rot;
      if (!n.text) { setPending(null); return; }
      setPending(n);
    } else if (state.tool === 'stamp') {
      ensureStampPending();
    }
  }

  // ---------- Gestes ----------
  var pointers = new Map();
  var gesture = null;

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('lostpointercapture', onUp);

  function isOnUi(e) {
    return e.target.closest && e.target.closest('button, label, a, input');
  }

  function onDown(e) {
    if (!state.loaded || isOnUi(e)) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    if (pointers.size === 1) {
      startSingle(e);
    } else if (pointers.size === 2) {
      if (gesture && gesture.type === 'stroke') cancelStroke();
      startPinch();
    }
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.type === 'pinch-view' || gesture.type === 'pinch-item') {
      movePinch();
    } else {
      moveSingle(e);
    }
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture && gesture.type === 'stroke') {
      endStroke();
    }
    if (pointers.size === 0) {
      if (gesture && gesture.type === 'pinch-view') resizeOverlay();
      if (gesture && (gesture.type === 'pinch-item' || gesture.type === 'handle')) syncSizeSliders();
      gesture = null;
      state.brushPreview = null;
      requestOverlay();
    } else if (gesture && gesture.type !== 'none' && pointers.size === 1) {
      // Fin d'un pincement avec un doigt encore posé : on ne démarre rien.
      if (gesture.type === 'pinch-view') resizeOverlay();
      if (gesture.type === 'pinch-item') syncSizeSliders();
      gesture = { type: 'none' };
    }
  }

  function startSingle(e) {
    var p = toImage(e.clientX, e.clientY);
    var k = imgPerCss();

    if (state.tool === 'blur') {
      var radius = state.blur.size * k;
      state.stroke = createStroke(state.blur.mode, state.blur.grain, radius);
      gesture = { type: 'stroke' };
      strokeAdd(state.stroke, p.x, p.y);
      state.brushPreview = { x: p.x, y: p.y, r: radius };
      requestOverlay();
      return;
    }

    if (state.tool === 'patch' || state.tool === 'stamp') {
      var it = state.pending;
      if (it) {
        var corners = itemCorners(it);
        var h = corners[2];
        var dh = Math.hypot(p.x - h[0], p.y - h[1]);
        if (dh < 26 * k) {
          gesture = {
            type: 'handle',
            d0: Math.max(1, Math.hypot(p.x - it.x, p.y - it.y)),
            a0: Math.atan2(p.y - it.y, p.x - it.x),
            size0: it.size, rot0: it.rot
          };
          return;
        }
        if (hitItem(it, p, 14 * k)) {
          gesture = { type: 'move', dx: it.x - p.x, dy: it.y - p.y };
          return;
        }
        it.x = p.x; it.y = p.y;
        gesture = { type: 'move', dx: 0, dy: 0 };
        requestOverlay();
        return;
      }
      // Pas d'élément : on en pose un là où l'utilisateur touche.
      if (state.tool === 'patch') {
        if (!state.patch.emoji) { toast('Choisissez d’abord un émoji'); gesture = { type: 'none' }; return; }
        setPending(makeEmojiItem(p.x, p.y));
      } else {
        if (!state.stamp.text.trim()) {
          toast('Écrivez d’abord votre texte');
          $('#stamp-text').focus();
          gesture = { type: 'none' };
          return;
        }
        setPending(makeStampItem(p.x, p.y));
      }
      gesture = { type: 'move', dx: 0, dy: 0 };
      return;
    }

    // Aucun outil : un doigt fait glisser la photo si elle est zoomée.
    gesture = { type: 'pan', x: e.clientX, y: e.clientY, tx: state.view.tx, ty: state.view.ty };
  }

  function moveSingle(e) {
    var g = gesture, it = state.pending;
    if (g.type === 'stroke' && state.stroke) {
      var p = toImage(e.clientX, e.clientY);
      strokeAdd(state.stroke, p.x, p.y);
      state.brushPreview = { x: p.x, y: p.y, r: state.stroke.radius };
      requestOverlay();
    } else if (g.type === 'move' && it) {
      var q = toImage(e.clientX, e.clientY);
      it.x = Math.min(state.iw, Math.max(0, q.x + g.dx));
      it.y = Math.min(state.ih, Math.max(0, q.y + g.dy));
      requestOverlay();
    } else if (g.type === 'handle' && it) {
      var r = toImage(e.clientX, e.clientY);
      var d = Math.hypot(r.x - it.x, r.y - it.y);
      var a = Math.atan2(r.y - it.y, r.x - it.x);
      it.size = g.size0 * d / g.d0;
      clampSize(it);
      it.rot = snapAngle(g.rot0 + a - g.a0);
      requestOverlay();
    } else if (g.type === 'pan' && state.view.s > 1) {
      state.view.tx = g.tx + e.clientX - g.x;
      state.view.ty = g.ty + e.clientY - g.y;
      clampView();
      applyView();
    }
  }

  function snapAngle(a) {
    var deg = a * 180 / Math.PI;
    var near = Math.round(deg / 90) * 90;
    if (Math.abs(deg - near) < 4) deg = near;
    return deg * Math.PI / 180;
  }

  function hitItem(it, p, pad) {
    var b = itemBox(it), c = Math.cos(-it.rot), s = Math.sin(-it.rot);
    var dx = p.x - it.x, dy = p.y - it.y;
    var lx = dx * c - dy * s, ly = dx * s + dy * c;
    return Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad;
  }

  function twoPointers() {
    var it = pointers.values();
    var a = it.next().value, b = it.next().value;
    return {
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
      d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      a: Math.atan2(b.y - a.y, b.x - a.x)
    };
  }

  function startPinch() {
    var t = twoPointers();
    var it = state.pending;
    if (it && (state.tool === 'patch' || state.tool === 'stamp')) {
      var m = toImage(t.mx, t.my);
      gesture = { type: 'pinch-item', t0: t, size0: it.size, rot0: it.rot, x0: it.x, y0: it.y, m0: m };
    } else {
      var sr = stage.getBoundingClientRect();
      var v = state.view, f = state.fit;
      // point local (non zoomé) sous le centre des doigts
      var lx = (t.mx - sr.left - f.left - v.tx) / v.s;
      var ly = (t.my - sr.top - f.top - v.ty) / v.s;
      gesture = { type: 'pinch-view', t0: t, s0: v.s, lx: lx, ly: ly };
    }
  }

  function movePinch() {
    if (pointers.size < 2) return;
    var t = twoPointers(), g = gesture;
    if (g.type === 'pinch-item' && state.pending) {
      var it = state.pending;
      it.size = g.size0 * t.d / g.t0.d;
      clampSize(it);
      it.rot = snapAngle(g.rot0 + t.a - g.t0.a);
      var m = toImage(t.mx, t.my);
      it.x = Math.min(state.iw, Math.max(0, g.x0 + m.x - g.m0.x));
      it.y = Math.min(state.ih, Math.max(0, g.y0 + m.y - g.m0.y));
      requestOverlay();
    } else if (g.type === 'pinch-view') {
      var sr = stage.getBoundingClientRect();
      var v = state.view, f = state.fit;
      v.s = Math.min(8, Math.max(1, g.s0 * t.d / g.t0.d));
      v.tx = t.mx - sr.left - f.left - g.lx * v.s;
      v.ty = t.my - sr.top - f.top - g.ly * v.s;
      clampView();
      applyView();
    }
  }

  // Molette / trackpad (ordinateur) : zoom.
  stage.addEventListener('wheel', function (e) {
    if (!state.loaded) return;
    e.preventDefault();
    var sr = stage.getBoundingClientRect();
    var v = state.view, f = state.fit;
    var lx = (e.clientX - sr.left - f.left - v.tx) / v.s;
    var ly = (e.clientY - sr.top - f.top - v.ty) / v.s;
    v.s = Math.min(8, Math.max(1, v.s * Math.exp(-e.deltaY * 0.0025)));
    v.tx = e.clientX - sr.left - f.left - lx * v.s;
    v.ty = e.clientY - sr.top - f.top - ly * v.s;
    clampView();
    applyView();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(resizeOverlay, 150);
  }, { passive: false });
  var wheelTimer = 0;

  function endStroke() {
    var s = state.stroke;
    if (!s) return;
    state.stroke = null;
    if (s.points.length) {
      pushOp({ type: 'blur', mode: s.mode, grain: s.grain, radius: s.radius, points: s.points });
    }
    freeStroke(s);
  }

  function cancelStroke() {
    var s = state.stroke;
    if (!s) return;
    state.stroke = null;
    pctx.clearRect(0, 0, photo.width, photo.height);
    pctx.drawImage(s.snap, 0, 0);
    freeStroke(s);
  }

  // Bloque le zoom natif de Safari (on gère le pincement nous-mêmes).
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });

  // ---------- Outils ----------
  var toolButtons = document.querySelectorAll('.tool[data-tool]');
  toolButtons.forEach(function (b) {
    b.addEventListener('click', function () { selectTool(b.dataset.tool); });
  });

  function selectTool(t) {
    if (state.stroke) cancelStroke();
    if (state.pending) commitPending();
    state.tool = state.tool === t ? null : t;
    toolButtons.forEach(function (b) { b.classList.toggle('is-active', b.dataset.tool === state.tool); });
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== state.tool; });
    panel.classList.toggle('is-open', !!state.tool);
    if (state.tool === 'stamp') {
      ensureStampPending();
      if (!state.stamp.text.trim()) setTimeout(function () { $('#stamp-text').focus(); }, 50);
    }
    if (state.tool === 'blur') setTimeout(flashBrush, 60);
  }

  document.querySelectorAll('[data-action="apply"]').forEach(function (b) {
    b.addEventListener('click', commitPending);
  });
  document.querySelectorAll('[data-action="discard"]').forEach(function (b) {
    b.addEventListener('click', discardPending);
  });

  // Flou
  document.querySelectorAll('[data-blur-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.blur.mode = b.dataset.blurMode;
      document.querySelectorAll('[data-blur-mode]').forEach(function (x) {
        x.setAttribute('aria-checked', String(x === b));
      });
    });
  });
  bindRange('#blur-grain', '#blur-grain-out', function (v) { state.blur.grain = v; });
  bindRange('#blur-size', '#blur-size-out', function (v) { state.blur.size = v; flashBrush(); });

  function bindRange(sel, outSel, fn) {
    var input = $(sel), out = outSel ? $(outSel) : null;
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      if (out) out.textContent = Math.round(v);
      fn(v);
    });
  }

  // Patch
  var grid = $('#emoji-grid');
  EMOJIS.forEach(function (em) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', 'false');
    b.addEventListener('click', function () {
      state.patch.emoji = em;
      grid.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      if (state.pending && state.pending.type === 'emoji') {
        state.pending.emoji = em;
        requestOverlay();
      } else {
        var c = defaultCenter();
        setPending(makeEmojiItem(c.x, c.y));
      }
    });
    grid.appendChild(b);
  });
  bindRange('#patch-size', '#patch-size-out', function (v) {
    state.patch.size = v;
    var it = state.pending;
    if (it && it.type === 'emoji') { it.size = longSide() * v / 100; clampSize(it); requestOverlay(); }
  });

  // Tampon
  var stampText = $('#stamp-text');
  stampText.value = state.stamp.text;
  stampText.addEventListener('input', function () {
    state.stamp.text = stampText.value;
    saveStampPrefs();
    syncPendingFromStamp();
  });
  stampText.addEventListener('keydown', function (e) { if (e.key === 'Enter') stampText.blur(); });

  var fontsEl = $('#stamp-fonts');
  FONTS.forEach(function (f) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = f.label;
    b.style.fontFamily = f.css;
    b.style.fontWeight = f.weight;
    b.dataset.font = f.id;
    b.addEventListener('click', function () {
      state.stamp.font = f.id;
      saveStampPrefs();
      markChecked(fontsEl, 'font', f.id);
      syncPendingFromStamp();
    });
    fontsEl.appendChild(b);
  });
  markChecked(fontsEl, 'font', state.stamp.font);

  var colorsEl = $('#stamp-colors');
  COLORS.forEach(function (c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', 'Couleur ' + c);
    b.style.background = c;
    b.dataset.color = c;
    b.addEventListener('click', function () {
      state.stamp.color = c;
      saveStampPrefs();
      markChecked(colorsEl, 'color', c);
      syncPendingFromStamp();
    });
    colorsEl.appendChild(b);
  });
  markChecked(colorsEl, 'color', state.stamp.color);

  var stylesEl = $('#stamp-styles');
  STYLES.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = s.label;
    b.dataset.style = s.id;
    b.addEventListener('click', function () {
      state.stamp.style = s.id;
      saveStampPrefs();
      markChecked(stylesEl, 'style', s.id);
      syncPendingFromStamp();
    });
    stylesEl.appendChild(b);
  });
  markChecked(stylesEl, 'style', state.stamp.style);

  $('#stamp-size').value = state.stamp.size;
  $('#stamp-opacity').value = state.stamp.opacity;
  bindRange('#stamp-size', null, function (v) {
    state.stamp.size = v;
    saveStampPrefs();
    var it = state.pending;
    if (it && it.type === 'text') { it.size = longSide() * v / 100; clampSize(it); requestOverlay(); }
  });
  bindRange('#stamp-opacity', null, function (v) {
    state.stamp.opacity = v;
    saveStampPrefs();
    var it = state.pending;
    if (it && it.type === 'text') { it.opacity = v / 100; requestOverlay(); }
  });

  function markChecked(container, key, val) {
    container.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset[key] === val));
    });
  }

  // Après un pincement, les curseurs de taille reflètent la nouvelle taille.
  function syncSizeSliders() {
    var it = state.pending;
    if (!it) return;
    var pct = it.size / longSide() * 100;
    if (it.type === 'emoji') {
      state.patch.size = pct;
      $('#patch-size').value = pct;
      $('#patch-size-out').textContent = Math.round(pct);
    } else {
      state.stamp.size = pct;
      $('#stamp-size').value = pct;
      saveStampPrefs();
    }
  }

  // ---------- Historique ----------
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    var mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  });

  // ---------- Sauvegarde ----------
  var sheet = $('#save-sheet');
  var shareBtn = $('#btn-share');
  var downloadBtn = $('#btn-download');
  var preview = $('#save-preview');
  var exportFile = null, exportUrl = null;

  $('#btn-save').addEventListener('click', function () {
    if (!state.loaded) return;
    if (state.stroke) endStroke();
    commitPending();
    // L'export est préparé ici ; le partage se fait sur un second appui
    // (Safari exige que navigator.share soit appelé directement par un geste).
    photo.toBlob(function (blob) {
      if (!blob) { toast('Export impossible'); return; }
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      var name = 'retouche-' + timestamp() + '.jpg';
      exportUrl = URL.createObjectURL(blob);
      try { exportFile = new File([blob], name, { type: 'image/jpeg' }); } catch (e) { exportFile = null; }
      preview.src = exportUrl;
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
      state.savedIdx = state.idx;
      closeSheet();
      toast('Photo enregistrée');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      downloadBtn.click();
    });
  });

  downloadBtn.addEventListener('click', function () { state.savedIdx = state.idx; });

  function closeSheet() { sheet.hidden = true; }
  $('#btn-close-sheet').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });

  function timestamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  window.addEventListener('beforeunload', function (e) {
    if (state.loaded && state.idx > 0 && state.savedIdx !== state.idx) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- Toast ----------
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 1600);
  }

  updateHistoryUI();
})();
