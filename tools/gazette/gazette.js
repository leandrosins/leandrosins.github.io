/* Gazette-moi : une page de journal fixe, une photo animée incrustée dedans.
   100 % local (aucune ressource externe). */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var PAGE_LONG = 1080;              // grand côté de la page (le texte du journal doit rester lisible)
  var ANIM_LONG = 420;               // grand côté de l'animation gardée en mémoire
  var MAX_FRAMES = 80;
  var MAX_SEC = 8;                   // durée maximale de l'animation
  var VIDEO_FPS = 10;
  var MAX_BYTES = 12 * 1024 * 1024;  // X accepte jusqu'à 15 Mo
  var BOX_BUDGET = 30e6;             // pixels d'animation envoyés à l'encodeur (mémoire de l'iPhone)
  var HANDLE = 26;                   // px écran : zone du coin de redimensionnement

  var state = {
    page: null,                      // canvas de la page
    anim: null,                      // { w, h, raw: [RGBA], delay (cs), shown: [canvas] }
    effect: 'gris',
    box: null,                       // { x, y, w, h } en fractions de la page
    busy: false,
    exported: true
  };
  var scene = $('#scene'), sctx = scene.getContext('2d'), stage = $('#stage');
  var bottomBars = $('#bottom-bars'), statusEl = $('#status'), toastEl = $('#toast');
  var video = $('#video');

  // ---------- La page ----------
  $('#page-input').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || state.busy) return;
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var k = Math.min(1, PAGE_LONG / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement('canvas');
      c.width = Math.max(8, Math.round(img.naturalWidth * k));
      c.height = Math.max(8, Math.round(img.naturalHeight * k));
      var x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, c.height);
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      state.page = c;
      scene.width = c.width;
      scene.height = c.height;
      $('#empty').hidden = true;
      scene.hidden = false;
      bottomBars.hidden = false;
      if (state.anim) touched();
      syncUI();
      layout();
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Image illisible'); };
    img.src = url;
  });

  // ---------- L'animation : GIF ou vidéo ----------
  $('#anim-input').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || state.busy) return;
    if (/gif$/i.test(file.type) || /\.gif$/i.test(file.name)) loadGif(file);
    else if (/^video\//.test(file.type)) loadVideo(file);
    else if (/^image\//.test(file.type)) loadStill(file);
    else toast('Choisissez un GIF ou une vidéo');
  });

  function small(w, h) {
    var k = Math.min(1, ANIM_LONG / Math.max(w, h));
    return { w: Math.max(2, Math.round(w * k)), h: Math.max(2, Math.round(h * k)) };
  }

  function loadGif(file) {
    busy('Lecture du GIF…', 0.1);
    file.arrayBuffer().then(function (buf) {
      var g = GifDecode.decode(buf);
      // les délais d'un GIF varient : on rééchantillonne sur un pas régulier
      var delays = g.frames.map(function (f) { return f.delay; }).sort(function (a, b) { return a - b; });
      var dt = Math.min(20, Math.max(3, delays[delays.length >> 1]));
      var total = Math.min(MAX_SEC * 100, g.frames.reduce(function (s, f) { return s + f.delay; }, 0));
      var n = Math.max(1, Math.min(MAX_FRAMES, Math.round(total / dt)));
      dt = total / n;
      var S = small(g.w, g.h), full = document.createElement('canvas'), sm = document.createElement('canvas');
      full.width = g.w; full.height = g.h; sm.width = S.w; sm.height = S.h;
      var fx = full.getContext('2d'), mx = sm.getContext('2d', { willReadFrequently: true });
      mx.imageSmoothingQuality = 'high';
      var raw = [], cache = {}, t = 0, idx = 0, acc = g.frames[0].delay;
      for (var i = 0; i < n; i++) {
        var at = i * dt;
        while (at >= acc && idx < g.frames.length - 1) { idx++; acc += g.frames[idx].delay; }
        if (!cache[idx]) {
          fx.putImageData(new ImageData(g.frames[idx].data, g.w, g.h), 0, 0);
          mx.clearRect(0, 0, S.w, S.h);
          mx.drawImage(full, 0, 0, S.w, S.h);
          cache[idx] = mx.getImageData(0, 0, S.w, S.h).data;
        }
        raw.push(cache[idx]);
      }
      t = Math.round(dt);
      setAnim({ w: S.w, h: S.h, raw: raw, delay: Math.max(2, t) });
    }).catch(function () { done(); toast('GIF illisible'); });
  }

  function loadStill(file) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var S = small(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
      c.width = S.w; c.height = S.h;
      var x = c.getContext('2d');
      x.drawImage(img, 0, 0, S.w, S.h);
      URL.revokeObjectURL(url);
      toast('Image fixe : choisissez plutôt un GIF ou une vidéo pour l’animer');
      setAnim({ w: S.w, h: S.h, raw: [x.getImageData(0, 0, S.w, S.h).data], delay: 10 });
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Image illisible'); };
    img.src = url;
  }

  function loadVideo(file) {
    busy('Lecture de la vidéo…', 0.02);
    var url = URL.createObjectURL(file);
    video.onloadedmetadata = function () {
      video.onloadedmetadata = null;
      if (!video.videoWidth) { fail(); return; }
      var dur = isFinite(video.duration) && video.duration > 0 ? video.duration : MAX_SEC;
      var n = Math.max(1, Math.min(MAX_FRAMES, Math.floor(Math.min(dur, MAX_SEC) * VIDEO_FPS)));
      var S = small(video.videoWidth, video.videoHeight), c = document.createElement('canvas');
      c.width = S.w; c.height = S.h;
      var x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingQuality = 'high';
      var raw = [];
      (function grab(i) {
        if (i >= n) {
          URL.revokeObjectURL(url);
          video.removeAttribute('src');
          video.load();
          setAnim({ w: S.w, h: S.h, raw: raw, delay: Math.round(100 / VIDEO_FPS) });
          return;
        }
        seekTo(Math.min(dur - 0.001, i / VIDEO_FPS)).then(function () {
          x.drawImage(video, 0, 0, S.w, S.h);
          raw.push(x.getImageData(0, 0, S.w, S.h).data);
          progress((i + 1) / n, 'Images ' + (i + 1) + ' / ' + n);
          grab(i + 1);
        });
      })(0);
    };
    video.onerror = fail;
    function fail() { video.onerror = null; URL.revokeObjectURL(url); done(); toast('Vidéo illisible par ce navigateur'); }
    video.src = url;
    video.load();
  }

  // Saut précis dans la vidéo (comme dans GIF-moi encore)
  function seekTo(t) {
    return new Promise(function (resolve) {
      var finished = false, gotSeek = false, gotFrame = !video.requestVideoFrameCallback;
      function finish(force) {
        if (finished || (!force && !(gotSeek && gotFrame))) return;
        finished = true;
        clearTimeout(guard);
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }
      function onSeeked() { gotSeek = true; finish(); setTimeout(function () { gotFrame = true; finish(); }, 90); }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(function () { gotFrame = true; finish(); });
      video.addEventListener('seeked', onSeeked);
      var guard = setTimeout(function () { finish(true); }, 3000);
      if (Math.abs(video.currentTime - t) < 1e-4) t += 1e-4;
      video.currentTime = Math.max(0, t);
    });
  }

  function setAnim(a) {
    done();
    state.anim = a;
    applyEffect();
    // emplacement par défaut : centré, la moitié de la largeur de la page
    var P = state.page, ar = a.w / a.h, w = 0.5, h = w * P.width / ar / P.height;
    if (h > 0.6) { h = 0.6; w = h * P.height * ar / P.width; }
    if (!state.box) state.box = { x: (1 - w) / 2, y: (1 - h) / 2, w: w, h: h };
    touched();
    syncUI();
    layout();
  }

  // ---------- Effet : gris, sépia ou couleur ----------
  // Gris et sépia : contraste un peu relevé et léger vignetage, l'air d'une vieille photo.
  function effectData(src, w, h, effect) {
    var d = new Uint8ClampedArray(src);
    if (effect === 'couleur') return d;
    for (var y = 0, o = 0; y < h; y++) {
      var vy = (y + 0.5) / h * 2 - 1;
      for (var x = 0; x < w; x++, o += 4) {
        var vx = (x + 0.5) / w * 2 - 1, v = 1 - 0.2 * Math.min(1, (vx * vx + vy * vy) * 0.6);
        var L = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2] - 128) * 1.12 + 128;
        L *= v;
        if (effect === 'sepia') { d[o] = L * 1.07 + 16; d[o + 1] = L * 0.95 + 6; d[o + 2] = L * 0.78; }
        else { d[o] = d[o + 1] = d[o + 2] = L; }
      }
    }
    return d;
  }
  function applyEffect() {
    var a = state.anim;
    if (!a) return;
    a.shown = a.raw.map(function (r) {
      var c = document.createElement('canvas');
      c.width = a.w; c.height = a.h;
      c.getContext('2d').putImageData(new ImageData(effectData(r, a.w, a.h, state.effect), a.w, a.h), 0, 0);
      return c;
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-effect]'), function (b) {
    b.addEventListener('click', function () {
      if (state.busy || state.effect === b.dataset.effect) return;
      state.effect = b.dataset.effect;
      Array.prototype.forEach.call(document.querySelectorAll('[data-effect]'), function (o) {
        o.classList.toggle('is-active', o === b);
        o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
      });
      applyEffect();
      touched();
    });
  });

  // ---------- Dessin ----------
  function boxPx(W, H) {
    var b = state.box;
    return { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
  }
  // l'animation remplit le cadre choisi (recadrée au centre si les proportions diffèrent)
  function drawCover(c, img, aw, ah, r) {
    var s = Math.max(r.w / aw, r.h / ah), sw = r.w / s, sh = r.h / s;
    c.drawImage(img, (aw - sw) / 2, (ah - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
  }

  var frameIdx = 0, last = 0, acc = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (!state.page) return;
    var a = state.anim;
    if (a && a.shown && a.shown.length > 1) {
      acc += Math.min(200, now - (last || now));
      while (acc >= a.delay * 10) { acc -= a.delay * 10; frameIdx = (frameIdx + 1) % a.shown.length; }
    }
    last = now;
    render();
  }
  requestAnimationFrame(tick);

  function px() { return scene.width / Math.max(1, scene.getBoundingClientRect().width); }

  function render() {
    var W = scene.width, H = scene.height, a = state.anim;
    sctx.drawImage(state.page, 0, 0);
    if (!a || !a.shown) return;
    var r = boxPx(W, H);
    sctx.save();
    sctx.beginPath(); sctx.rect(r.x, r.y, r.w, r.h); sctx.clip();
    drawCover(sctx, a.shown[frameIdx % a.shown.length], a.w, a.h, r);
    sctx.restore();
    if (state.busy) return;
    var k = px();
    sctx.save();
    sctx.lineWidth = 2 * k;
    sctx.setLineDash([7 * k, 5 * k]);
    sctx.strokeStyle = 'rgba(255,255,255,0.95)';
    sctx.strokeRect(r.x, r.y, r.w, r.h);
    sctx.lineDashOffset = 6 * k;
    sctx.strokeStyle = 'rgba(0,0,0,0.6)';
    sctx.strokeRect(r.x, r.y, r.w, r.h);
    sctx.setLineDash([]);
    // poignée de redimensionnement (coin bas droit)
    sctx.fillStyle = '#ffffff';
    sctx.strokeStyle = 'rgba(0,0,0,0.5)';
    sctx.beginPath(); sctx.arc(r.x + r.w, r.y + r.h, 9 * k, 0, Math.PI * 2); sctx.fill(); sctx.stroke();
    sctx.restore();
  }

  // ---------- Vue ----------
  function layout() {
    var top = $('#topbar').offsetHeight, bottom = bottomBars.hidden ? 0 : bottomBars.offsetHeight;
    document.documentElement.style.setProperty('--top-h', top + 'px');
    document.documentElement.style.setProperty('--bottom-h', bottom + 'px');
    if (!state.page) return;
    var W = stage.clientWidth - 16, H = stage.clientHeight - top - bottom - 16;
    var k = Math.min(W / scene.width, H / scene.height);
    scene.style.width = scene.width * k + 'px';
    scene.style.height = scene.height * k + 'px';
    scene.style.left = (stage.clientWidth - scene.width * k) / 2 + 'px';
    scene.style.top = top + 8 + (H - scene.height * k) / 2 + 'px';
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });

  // ---------- Gestes : placer et dimensionner l'animation ----------
  function toPage(cx, cy) {
    var r = scene.getBoundingClientRect();
    return [(cx - r.left) / r.width, (cy - r.top) / r.height];
  }
  var pointers = new Map(), gesture = null, lastTap = 0;
  function pair() {
    var p = Array.from(pointers.values());
    return Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y));
  }
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });

  stage.addEventListener('pointerdown', function (e) {
    if (!state.box || state.busy) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var b = state.box, q = toPage(e.clientX, e.clientY), r = scene.getBoundingClientRect();
    if (pointers.size === 1) {
      var hx = (b.x + b.w) * r.width + r.left, hy = (b.y + b.h) * r.height + r.top;
      if (Math.hypot(e.clientX - hx, e.clientY - hy) < HANDLE) gesture = { type: 'resize' };
      else if (q[0] >= b.x && q[0] <= b.x + b.w && q[1] >= b.y && q[1] <= b.y + b.h) {
        gesture = { type: 'move', q: q, x0: b.x, y0: b.y, sx: e.clientX, sy: e.clientY };
      } else gesture = null;
    } else if (pointers.size === 2) {
      gesture = { type: 'pinch', d0: pair(), b0: { x: b.x, y: b.y, w: b.w, h: b.h } };
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var b = state.box, g = gesture, q = toPage(e.clientX, e.clientY);
    if (g.type === 'move') {
      b.x = clamp(g.x0 + q[0] - g.q[0], -b.w + 0.05, 0.95);
      b.y = clamp(g.y0 + q[1] - g.q[1], -b.h + 0.05, 0.95);
      touched();
    } else if (g.type === 'resize') {
      b.w = clamp(q[0] - b.x, 0.05, 2);
      b.h = clamp(q[1] - b.y, 0.05, 2);
      touched();
    } else if (g.type === 'pinch' && pointers.size >= 2) {
      var k = pair() / g.d0, cx = g.b0.x + g.b0.w / 2, cy = g.b0.y + g.b0.h / 2;
      b.w = clamp(g.b0.w * k, 0.05, 2);
      b.h = b.w * g.b0.h / g.b0.w;
      b.x = cx - b.w / 2;
      b.y = cy - b.h / 2;
      touched();
    }
  });
  function endPointer(e) {
    if (!pointers.delete(e.pointerId)) return;
    var g = gesture;
    gesture = pointers.size ? { type: 'settle' } : null;
    if (!g || g.type !== 'move' || e.type !== 'pointerup' || Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) return;
    // double-touche : retrouver les proportions de l'animation
    var now = Date.now();
    if (now - lastTap < 320) { fitAspect(); lastTap = 0; } else lastTap = now;
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('wheel', function (e) {
    if (!state.box || state.busy) return;
    e.preventDefault();
    var b = state.box, k = Math.exp(-e.deltaY * 0.0015), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    b.w = clamp(b.w * k, 0.05, 2); b.h = clamp(b.h * k, 0.05, 2);
    b.x = cx - b.w / 2; b.y = cy - b.h / 2;
    touched();
  }, { passive: false });

  function fitAspect() {
    var a = state.anim, b = state.box, P = state.page;
    if (!a) return;
    var cy = b.y + b.h / 2;
    b.h = b.w * P.width * a.h / a.w / P.height;
    b.y = cy - b.h / 2;
    touched();
    toast('Proportions d’origine');
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // ---------- Création du GIF ----------
  var worker = null;
  $('#btn-save').addEventListener('click', function () {
    var a = state.anim, P = state.page;
    if (!a || state.busy) return;
    var n = a.shown.length, W = P.width, H = P.height, r = boxPx(W, H);
    // zone visible de l'animation (elle peut déborder de la page)
    var x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    var x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
    if (x1 - x0 < 2 || y1 - y0 < 2) { toast('L’animation est hors de la page'); return; }
    // trop de pixels pour la mémoire du téléphone : tout est réduit d'autant
    var k = Math.min(1, Math.sqrt(BOX_BUDGET / ((x1 - x0) * (y1 - y0) * n)));
    var oW = Math.max(2, Math.round(W * k)), oH = Math.max(2, Math.round(H * k));
    var R = { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
    var bx = Math.max(0, Math.floor(R.x)), by = Math.max(0, Math.floor(R.y));
    var bw = Math.min(oW, Math.ceil(R.x + R.w)) - bx, bh = Math.min(oH, Math.ceil(R.y + R.h)) - by;

    busy('Préparation…', 0);
    var bgC = document.createElement('canvas');
    bgC.width = oW; bgC.height = oH;
    var bgx = bgC.getContext('2d', { willReadFrequently: true });
    bgx.imageSmoothingQuality = 'high';
    bgx.drawImage(P, 0, 0, oW, oH);
    var bg = bgx.getImageData(0, 0, oW, oH).data.buffer;
    var fc = document.createElement('canvas');
    fc.width = bw; fc.height = bh;
    var fx = fc.getContext('2d', { willReadFrequently: true });
    fx.imageSmoothingQuality = 'high';
    var frames = [];
    (function step(i) {
      if (i >= n) { encode(bg, oW, oH, { x: bx, y: by, w: bw, h: bh }, frames, a.delay); return; }
      // la page sous l'animation (pour les GIF transparents), puis l'image i
      fx.setTransform(1, 0, 0, 1, 0, 0);
      fx.drawImage(bgC, bx, by, bw, bh, 0, 0, bw, bh);
      fx.save();
      fx.translate(-bx, -by);
      fx.beginPath(); fx.rect(R.x, R.y, R.w, R.h); fx.clip();
      drawCover(fx, a.shown[i], a.w, a.h, R);
      fx.restore();
      frames.push(fx.getImageData(0, 0, bw, bh).data.buffer);
      progress((i + 1) / n * 0.3, 'Images ' + (i + 1) + ' / ' + n);
      if (i % 8 === 7) setTimeout(function () { step(i + 1); }, 0); else step(i + 1);
    })(0);
  });

  function encode(bg, W, H, box, frames, delay) {
    progress(0.3, 'Encodage du GIF…');
    worker = new Worker('gazette-worker.js');
    worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'progress') { progress(0.3 + m.p * 0.7, m.attempt ? 'Encodage (version plus légère)…' : 'Encodage du GIF…'); return; }
      worker.terminate(); worker = null;
      done();
      if (m.type !== 'done') { toast('Création du GIF impossible'); return; }
      showResult(new Blob([m.buffer], { type: 'image/gif' }), m.bytes);
    };
    worker.onerror = function () {
      if (worker) { worker.terminate(); worker = null; }
      done();
      toast('Création du GIF impossible');
    };
    worker.postMessage({ bg: bg, W: W, H: H, box: box, frames: frames, delay: delay, maxBytes: MAX_BYTES }, [bg].concat(frames));
  }

  // ---------- Résultat ----------
  var sheet = $('#save-sheet'), shareBtn = $('#btn-share'), downloadBtn = $('#btn-download');
  var exportFile = null, exportUrl = null;
  function showResult(blob, bytes) {
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    var name = 'gazette-' + timestamp() + '.gif';
    exportUrl = URL.createObjectURL(blob);
    try { exportFile = new File([blob], name, { type: 'image/gif' }); } catch (e) { exportFile = null; }
    $('#save-preview').src = exportUrl;
    downloadBtn.href = exportUrl;
    downloadBtn.download = name;
    var canShare = !!(exportFile && navigator.canShare && navigator.canShare({ files: [exportFile] }));
    shareBtn.hidden = !canShare;
    var mb = (bytes / 1048576).toFixed(1).replace('.', ',') + ' Mo';
    $('#save-hint').textContent = 'GIF de ' + mb + '. ' + (canShare
      ? 'Touchez « Enregistrer dans Photos » puis « Enregistrer l’image ».'
      : 'Téléchargez le fichier, ou faites un appui long sur l’aperçu pour l’enregistrer.');
    sheet.hidden = false;
  }
  shareBtn.addEventListener('click', function () {
    if (!exportFile) return;
    navigator.share({ files: [exportFile] }).then(function () {
      state.exported = true;
      closeSheet();
      toast('GIF enregistré');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      downloadBtn.click();
    });
  });
  downloadBtn.addEventListener('click', function () { state.exported = true; });
  function closeSheet() { sheet.hidden = true; }
  $('#btn-close-sheet').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });

  // ---------- Interface ----------
  function syncUI() {
    var has = !!state.anim;
    $('#anim-step').hidden = has;
    $('#anim-controls').hidden = !has;
    $('#btn-save').disabled = !has || state.busy;
    layout();
  }
  function busy(text, p) {
    state.busy = true;
    statusEl.hidden = false;
    progress(p, text);
    $('#btn-save').disabled = true;
  }
  function done() {
    state.busy = false;
    statusEl.hidden = true;
    syncUI();
  }
  function progress(p, text) {
    if (text) $('#status-text').textContent = text;
    $('#progress-bar').style.width = Math.round(p * 100) + '%';
  }
  function touched() { state.exported = false; }
  window.addEventListener('beforeunload', function (e) {
    if (state.anim && !state.exported) { e.preventDefault(); e.returnValue = ''; }
  });

  function timestamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 2200);
  }

  layout();
})();
