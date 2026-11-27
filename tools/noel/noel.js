/* Déballe-moi sous le sapin : interface. 100 % local (aucune ressource externe). */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var A = window.NoelArt;

  var MAX_SIDE = 1800;        // grand côté de la photo (le cadre s'ajoute autour)
  var JPEG_QUALITY = 0.93;
  var HINTS = {
    frames: 'Choisissez un cadre ; il se combine avec les accessoires.',
    stickers: 'Touchez un accessoire pour l’ajouter. 1 doigt : déplacer · 2 doigts : taille et rotation · double-touche : miroir.'
  };

  // Accessoire : { type, x, y (fractions de la photo), s (fraction du petit côté), rot, flip, text }
  var state = {
    photo: null,            // canvas de la photo
    frame: 'aucun',
    caption: 'Joyeux Noël',
    stickers: [],
    sel: -1,
    tab: 'frames',
    L: null,                // mise en page du cadre courant
    dirty: false,
    exported: true
  };
  var base = document.createElement('canvas');   // photo + cadre, redessiné seulement quand le cadre change
  var scene = $('#scene'), sctx = scene.getContext('2d');
  var stage = $('#stage'), bottomBars = $('#bottom-bars'), stripEl = $('#strip');
  var textRow = $('#text-row'), textInput = $('#text-input');
  var fileInput = $('#file-input'), toastEl = $('#toast');

  // la police manuscrite (légende, étiquette) : redessiner quand elle arrive
  if (document.fonts && document.fonts.load) {
    document.fonts.load('600 40px "SM Dancing Script"').then(function () { if (state.photo) rebuild(); }).catch(function () {});
  }

  // ---------- Chargement ----------
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (unsaved() && !window.confirm('Remplacer la photo en cours ? Elle n’a pas été exportée.')) return;
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement('canvas');
      c.width = Math.max(8, Math.round(img.naturalWidth * k));
      c.height = Math.max(8, Math.round(img.naturalHeight * k));
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      state.photo = c;
      state.stickers = [];
      state.sel = -1;
      state.exported = true;
      $('#empty').hidden = true;
      scene.hidden = false;
      bottomBars.hidden = false;
      $('#btn-new').hidden = false;
      buildStrip();
      rebuild();
      layout();
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Photo illisible'); };
    img.src = url;
  });

  // ---------- Dessin ----------
  function rebuild() {
    var F = A.FRAMES[state.frame], p = state.photo;
    state.L = F.layout(p.width, p.height);
    base.width = scene.width = state.L.W;
    base.height = scene.height = state.L.H;
    F.draw(base.getContext('2d'), state.L, p, { caption: state.caption });
    draw();
    layout();
  }

  // repère « photo » : origine au coin de la photo, tourné avec elle (polaroïd)
  function toPhoto(c) {
    var L = state.L, p = state.photo;
    c.translate(L.ox + p.width / 2, L.oy + p.height / 2);
    c.rotate(L.rot);
    c.translate(-p.width / 2, -p.height / 2);
  }
  function unit() { return Math.min(state.photo.width, state.photo.height); }

  function drawSticker(c, st) {
    var T = A.STICKERS[st.type], S = st.s * unit();
    c.save();
    c.translate(st.x * state.photo.width, st.y * state.photo.height);
    c.rotate(st.rot);
    c.scale(st.flip ? -S : S, S);
    T.draw(c, st);
    c.restore();
  }

  function render(c, withSel) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(base, 0, 0);
    c.save();
    toPhoto(c);
    state.stickers.forEach(function (st) { drawSticker(c, st); });
    var st = state.stickers[state.sel];
    if (withSel && st) {
      var T = A.STICKERS[st.type], S = st.s * unit(), px = scene.width / Math.max(1, scene.getBoundingClientRect().width);
      c.translate(st.x * state.photo.width, st.y * state.photo.height);
      c.rotate(st.rot);
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = 2 * px;
      c.setLineDash([6 * px, 5 * px]);
      c.strokeRect(-T.w * S / 2, -T.h * S / 2, T.w * S, T.h * S);
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineDashOffset = 5.5 * px;
      c.strokeRect(-T.w * S / 2, -T.h * S / 2, T.w * S, T.h * S);
    }
    c.restore();
  }

  var queued = false;
  function draw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; if (state.photo) render(sctx, true); });
  }

  // ---------- Vue ----------
  function layout() {
    var top = $('#topbar').offsetHeight, bottom = bottomBars.hidden ? 0 : bottomBars.offsetHeight;
    document.documentElement.style.setProperty('--top-h', top + 'px');
    document.documentElement.style.setProperty('--bottom-h', bottom + 'px');
    if (!state.L) return;
    var W = stage.clientWidth - 16, H = stage.clientHeight - top - bottom - 16;
    var k = Math.min(W / state.L.W, H / state.L.H);
    scene.style.width = state.L.W * k + 'px';
    scene.style.height = state.L.H * k + 'px';
    scene.style.left = (stage.clientWidth - state.L.W * k) / 2 + 'px';
    scene.style.top = top + 8 + (H - state.L.H * k) / 2 + 'px';
    draw();
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });

  // ---------- Bandeau : cadres / accessoires ----------
  function setTab(tab) {
    state.tab = tab;
    ['frames', 'stickers'].forEach(function (t) {
      var b = $('#tab-' + t);
      b.classList.toggle('is-active', t === tab);
      b.setAttribute('aria-pressed', t === tab ? 'true' : 'false');
    });
    $('#hint').textContent = HINTS[tab];
    buildStrip();
    syncText();
    layout();
  }
  $('#tab-frames').addEventListener('click', function () { setTab('frames'); });
  $('#tab-stickers').addEventListener('click', function () { setTab('stickers'); });

  // Vignettes dessinées avec le vrai code de dessin
  var sample = null;
  function samplePhoto() {
    if (sample) return sample;
    sample = document.createElement('canvas');
    sample.width = 120; sample.height = 150;
    var c = sample.getContext('2d'), g = c.createLinearGradient(0, 0, 120, 150);
    g.addColorStop(0, '#7e8aa6'); g.addColorStop(1, '#c9a78c');
    c.fillStyle = g; c.fillRect(0, 0, 120, 150);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath(); c.arc(60, 60, 26, 0, Math.PI * 2); c.fill();
    c.fillRect(28, 96, 64, 54);
    return sample;
  }

  function buildStrip() {
    stripEl.textContent = '';
    var frames = state.tab === 'frames', list = frames ? A.FRAMES : A.STICKERS;
    Object.keys(list).forEach(function (k) {
      var item = list[k], b = document.createElement('button'), c = document.createElement('canvas');
      b.type = 'button';
      b.className = 'thumb';
      b.dataset.key = k;
      c.width = 128; c.height = 128;
      var ctx = c.getContext('2d');
      if (frames) {
        var p = samplePhoto(), L = item.layout(p.width, p.height), t = document.createElement('canvas');
        t.width = L.W; t.height = L.H;
        item.draw(t.getContext('2d'), L, p, { caption: 'Joyeux Noël' });
        var s = Math.min(116 / L.W, 116 / L.H);
        ctx.drawImage(t, (128 - L.W * s) / 2, (128 - L.H * s) / 2, L.W * s, L.H * s);
      } else {
        var u = 108 / Math.max(item.w, item.h);
        ctx.translate(64, 64);
        ctx.scale(u, u);
        item.draw(ctx, {});
      }
      var label = document.createElement('span');
      label.textContent = item.label;
      b.appendChild(c);
      b.appendChild(label);
      if (frames) b.setAttribute('aria-pressed', k === state.frame ? 'true' : 'false');
      b.addEventListener('click', function () { frames ? pickFrame(k) : addSticker(k); });
      stripEl.appendChild(b);
    });
  }

  function pickFrame(k) {
    state.frame = k;
    Array.prototype.forEach.call(stripEl.children, function (b) { b.setAttribute('aria-pressed', b.dataset.key === k ? 'true' : 'false'); });
    touched();
    rebuild();
    syncText();
  }

  function addSticker(type) {
    var T = A.STICKERS[type];
    state.stickers.push({ type: type, x: 0.5, y: 0.42, s: T.size, rot: 0, flip: false, text: T.text ? 'À déballer' : '' });
    state.sel = state.stickers.length - 1;
    touched();
    syncSel();
  }

  // ---------- Texte : légende du polaroïd ou texte de l'étiquette ----------
  function syncText() {
    var st = state.stickers[state.sel];
    if (st && A.STICKERS[st.type].text) {
      textRow.hidden = false;
      $('#text-label').textContent = 'Étiquette';
      textInput.value = st.text;
    } else if (state.frame === 'polaroid' && state.tab === 'frames') {
      textRow.hidden = false;
      $('#text-label').textContent = 'Légende';
      textInput.value = state.caption;
    } else textRow.hidden = true;
    layout();
  }
  textInput.addEventListener('input', function () {
    var st = state.stickers[state.sel];
    touched();
    if (st && A.STICKERS[st.type].text) { st.text = textInput.value; draw(); }
    else { state.caption = textInput.value; rebuild(); }
  });
  textInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') textInput.blur(); });

  function syncSel() {
    $('#btn-delete').disabled = state.sel < 0;
    syncText();
    draw();
  }

  $('#btn-delete').addEventListener('click', function () {
    if (state.sel < 0) return;
    state.stickers.splice(state.sel, 1);
    state.sel = -1;
    touched();
    syncSel();
  });

  // ---------- Gestes sur les accessoires ----------
  function toScene(cx, cy) {
    var r = scene.getBoundingClientRect();
    return [(cx - r.left) * scene.width / r.width, (cy - r.top) * scene.height / r.height];
  }
  // point de la scène → repère photo
  function sceneToPhoto(p) {
    var L = state.L, ph = state.photo, dx = p[0] - (L.ox + ph.width / 2), dy = p[1] - (L.oy + ph.height / 2);
    var c = Math.cos(-L.rot), s = Math.sin(-L.rot);
    return [dx * c - dy * s + ph.width / 2, dx * s + dy * c + ph.height / 2];
  }
  function hit(u, v) {
    for (var i = state.stickers.length - 1; i >= 0; i--) {
      var st = state.stickers[i], T = A.STICKERS[st.type], S = st.s * unit();
      var dx = u - st.x * state.photo.width, dy = v - st.y * state.photo.height;
      var c = Math.cos(-st.rot), s = Math.sin(-st.rot), lx = (dx * c - dy * s) / S, ly = (dx * s + dy * c) / S;
      // un peu de marge : les doigts sont plus gros que les petits accessoires
      var m = Math.max(0, 0.04 * unit() / S);
      if (Math.abs(lx) < T.w / 2 + m && Math.abs(ly) < T.h / 2 + m) return i;
    }
    return -1;
  }

  var pointers = new Map(), gesture = null, lastTap = { t: 0, i: -1 };
  function pair() {
    var p = Array.from(pointers.values());
    return { d: Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)), a: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x), x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  }
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });

  stage.addEventListener('pointerdown', function (e) {
    if (!state.photo) return;
    if (document.activeElement === textInput) textInput.blur();
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      var q = sceneToPhoto(toScene(e.clientX, e.clientY)), i = hit(q[0], q[1]);
      if (i >= 0 && i !== state.sel) { state.sel = i; syncSel(); }
      var st = state.stickers[i];
      gesture = st
        ? { type: 'drag', i: i, u: q[0], v: q[1], x0: st.x, y0: st.y, sx: e.clientX, sy: e.clientY, moved: false }
        : { type: 'empty', sx: e.clientX, sy: e.clientY };
    } else if (pointers.size === 2 && state.sel >= 0) {
      var s2 = state.stickers[state.sel], p = pair(), m = sceneToPhoto(toScene(p.x, p.y));
      gesture = { type: 'pinch', start: p, s0: s2.s, rot0: s2.rot, x0: s2.x, y0: s2.y, u: m[0], v: m[1] };
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var g = gesture, st, q;
    if (g.type === 'drag') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 6) g.moved = true;
      st = state.stickers[g.i];
      q = sceneToPhoto(toScene(e.clientX, e.clientY));
      st.x = clamp(g.x0 + (q[0] - g.u) / state.photo.width, -0.2, 1.2);
      st.y = clamp(g.y0 + (q[1] - g.v) / state.photo.height, -0.2, 1.2);
      touched();
      draw();
    } else if (g.type === 'pinch' && pointers.size >= 2) {
      var p = pair();
      st = state.stickers[state.sel];
      st.s = clamp(g.s0 * p.d / g.start.d, 0.04, 3);
      st.rot = g.rot0 + (p.a - g.start.a);
      q = sceneToPhoto(toScene(p.x, p.y));
      st.x = clamp(g.x0 + (q[0] - g.u) / state.photo.width, -0.2, 1.2);
      st.y = clamp(g.y0 + (q[1] - g.v) / state.photo.height, -0.2, 1.2);
      touched();
      draw();
    }
  });
  function endPointer(e) {
    if (!pointers.delete(e.pointerId)) return;
    var g = gesture;
    if (pointers.size) { gesture = { type: 'settle' }; return; }
    gesture = null;
    if (!g || e.type !== 'pointerup') return;
    var now = Date.now();
    if (g.type === 'empty' && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 8 && state.sel >= 0) { state.sel = -1; syncSel(); }
    if (g.type === 'drag' && !g.moved) {
      if (lastTap.i === g.i && now - lastTap.t < 320) { // double-touche : miroir
        state.stickers[g.i].flip = !state.stickers[g.i].flip;
        touched();
        draw();
        lastTap = { t: 0, i: -1 };
        return;
      }
      lastTap = { t: now, i: g.i };
    }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  // souris : molette = taille, Maj + molette = rotation
  stage.addEventListener('wheel', function (e) {
    var st = state.stickers[state.sel];
    if (!st) return;
    e.preventDefault();
    if (e.shiftKey) st.rot += e.deltaY * 0.003;
    else st.s = clamp(st.s * Math.exp(-e.deltaY * 0.0015), 0.04, 3);
    touched();
    draw();
  }, { passive: false });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel >= 0 && document.activeElement !== textInput) $('#btn-delete').click();
  });

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function touched() { state.exported = false; }
  function unsaved() { return !!state.photo && !state.exported; }

  // ---------- Export ----------
  var sheet = $('#save-sheet'), shareBtn = $('#btn-share'), downloadBtn = $('#btn-download');
  var exportFile = null, exportUrl = null;

  $('#btn-save').addEventListener('click', function () {
    if (!state.photo) return;
    var out = document.createElement('canvas');
    out.width = state.L.W; out.height = state.L.H;
    render(out.getContext('2d'), false);
    out.toBlob(function (blob) {
      if (!blob) { toast('Export impossible'); return; }
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      var name = 'noel-' + timestamp() + '.jpg';
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
      state.exported = true;
      closeSheet();
      toast('Photo enregistrée');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      downloadBtn.click();
    });
  });
  downloadBtn.addEventListener('click', function () { state.exported = true; });
  function closeSheet() { sheet.hidden = true; }
  $('#btn-close-sheet').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  window.addEventListener('beforeunload', function (e) {
    if (unsaved()) { e.preventDefault(); e.returnValue = ''; }
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
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 1800);
  }

  setTab('frames');
  layout();
})();
