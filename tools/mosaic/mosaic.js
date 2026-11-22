/* Mozaïc-moi plus fort — mosaïque de photos, 100 % locale (aucune ressource externe). */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  // ---------- Grilles ----------
  // Unités : chaque case = [x, y, largeur, hauteur] dans une grille cols × rows de carrés.
  // Les cases sont listées dans l'ordre de lecture (ordre de remplissage des photos).
  var LAYOUTS = [
    // 2 photos
    { id: 'p2-sq', n: 2, o: 'p', cols: 1, rows: 2, cells: [[0, 0, 1, 1], [0, 1, 1, 1]] },
    { id: 'l2-sq', n: 2, o: 'l', cols: 2, rows: 1, cells: [[0, 0, 1, 1], [1, 0, 1, 1]] },
    // 4 photos — portrait
    { id: 'p4-rect', n: 4, o: 'p', cols: 2, rows: 4, cells: [[0, 0, 1, 2], [1, 0, 1, 2], [0, 2, 1, 2], [1, 2, 1, 2]] },
    { id: 'p4-mix', n: 4, o: 'p', cols: 2, rows: 3, cells: [[0, 0, 1, 1], [1, 0, 1, 2], [0, 1, 1, 2], [1, 2, 1, 1]] },
    // 4 photos — paysage
    { id: 'l4-rect', n: 4, o: 'l', cols: 4, rows: 2, cells: [[0, 0, 2, 1], [2, 0, 2, 1], [0, 1, 2, 1], [2, 1, 2, 1]] },
    { id: 'l4-mix', n: 4, o: 'l', cols: 3, rows: 2, cells: [[0, 0, 1, 1], [1, 0, 2, 1], [0, 1, 2, 1], [2, 1, 1, 1]] },
    // 6 photos — portrait
    { id: 'p6-sq', n: 6, o: 'p', cols: 2, rows: 3, cells: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1]] },
    { id: 'p6-mix', n: 6, o: 'p', cols: 2, rows: 4, cells: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 2], [1, 1, 1, 2], [0, 3, 1, 1], [1, 3, 1, 1]] },
    { id: 'p6-four', n: 6, o: 'p', cols: 2, rows: 4, cells: [[0, 0, 2, 1], [0, 1, 1, 1], [1, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [0, 3, 2, 1]] },
    // 6 photos — paysage
    { id: 'l6-sq', n: 6, o: 'l', cols: 3, rows: 2, cells: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1]] },
    { id: 'l6-mix', n: 6, o: 'l', cols: 4, rows: 2, cells: [[0, 0, 1, 1], [1, 0, 2, 1], [3, 0, 1, 1], [0, 1, 1, 1], [1, 1, 2, 1], [3, 1, 1, 1]] },
    { id: 'l6-four', n: 6, o: 'l', cols: 4, rows: 2, cells: [[0, 0, 1, 2], [1, 0, 1, 1], [2, 0, 1, 1], [3, 0, 1, 2], [1, 1, 1, 1], [2, 1, 1, 1]] }
  ];
  function layoutById(id) {
    for (var i = 0; i < LAYOUTS.length; i++) if (LAYOUTS[i].id === id) return LAYOUTS[i];
    return null;
  }

  var PREV_MAX = 1600;     // px : copie allégée de chaque photo pour l'édition
  var EXPORT_LONG = 3200;  // px : grand côté de l'image exportée
  var MAX_Z = 10;          // zoom maximal dans une case
  var HIST_MAX = 80;
  var JPEG_QUALITY = 0.92;

  // ---------- État ----------
  // cells[i] = null (case vide) ou { id, z, u, v } :
  //   z = zoom (1 = la photo couvre juste la case), (u, v) = point de la photo
  //   (en fraction de sa largeur / hauteur) placé au centre de la case.
  var state = {
    layout: null,
    cells: [],
    sel: -1,
    hist: [],
    idx: -1,
    exportedIdx: -1
  };
  var imgs = {};   // id → { file, w, h, prev }
  var nextId = 1;

  var stage = $('#stage'), view = $('#view'), vctx = view.getContext('2d');
  var setup = $('#setup'), panel = $('#panel'), bottomBars = $('#bottom-bars');
  var fileInput = $('#file-input'), toastEl = $('#toast');
  var dpr = 1, W = 0, H = 0, topH = 56, bottomH = 70;
  var setupCount = 4;

  // ---------- Historique ----------
  function snapshot() {
    return {
      layout: state.layout ? state.layout.id : null,
      cells: state.cells.map(function (c) { return c ? { id: c.id, z: c.z, u: c.u, v: c.v } : null; })
    };
  }
  function sameSnap(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function commit() {
    var s = snapshot();
    if (state.idx >= 0 && sameSnap(s, state.hist[state.idx])) { updateUI(); return; }
    state.hist = state.hist.slice(0, state.idx + 1);
    state.hist.push(s);
    if (state.hist.length > HIST_MAX) state.hist.shift();
    state.idx = state.hist.length - 1;
    purgeImages();
    updateUI();
  }

  function restore(s) {
    state.layout = layoutById(s.layout);
    state.cells = s.cells.map(function (c) { return c ? { id: c.id, z: c.z, u: c.u, v: c.v } : null; });
    if (state.sel >= state.cells.length || (state.sel >= 0 && !state.cells[state.sel])) state.sel = -1;
    gesture = null;
    updateUI();
    requestDraw();
  }

  function undo() {
    if (state.idx <= 0) return;
    state.idx--;
    restore(state.hist[state.idx]);
  }
  function redo() {
    if (state.idx >= state.hist.length - 1) return;
    state.idx++;
    restore(state.hist[state.idx]);
  }
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  });

  // Libère les photos qui ne servent plus nulle part (ni maintenant, ni dans l'historique).
  function purgeImages() {
    var used = {};
    state.hist.forEach(function (s) { s.cells.forEach(function (c) { if (c) used[c.id] = 1; }); });
    state.cells.forEach(function (c) { if (c) used[c.id] = 1; });
    Object.keys(imgs).forEach(function (id) {
      if (!used[id]) { freeCanvas(imgs[id].prev); delete imgs[id]; }
    });
  }

  // ---------- Mise en page ----------
  function layout() {
    var r = stage.getBoundingClientRect();
    W = r.width; H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    view.width = Math.round(W * dpr);
    view.height = Math.round(H * dpr);
    topH = $('#topbar').offsetHeight;
    // On réserve toujours la place du panneau de la case sélectionnée,
    // pour que la mosaïque ne saute pas quand on sélectionne une case.
    var wasOpen = panel.classList.contains('is-open');
    panel.classList.add('is-open');
    bottomH = bottomBars.offsetHeight;
    if (!wasOpen) panel.classList.remove('is-open');
    document.documentElement.style.setProperty('--top-h', topH + 'px');
    document.documentElement.style.setProperty('--bottom-h', bottomBars.offsetHeight + 'px');
    requestDraw();
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });

  // Position de la mosaïque à l'écran
  function geom() {
    var L = state.layout, pad = 16;
    var top = topH + pad, aw = W - 2 * pad, ah = H - top - bottomH - pad;
    var unit = Math.max(1, Math.min(aw / L.cols, ah / L.rows));
    var mw = unit * L.cols, mh = unit * L.rows;
    return { unit: unit, x: (W - mw) / 2, y: top + Math.max(0, (ah - mh) / 2), w: mw, h: mh };
  }
  function cellRect(i, g) {
    var c = state.layout.cells[i];
    return { x: g.x + c[0] * g.unit, y: g.y + c[1] * g.unit, w: c[2] * g.unit, h: c[3] * g.unit };
  }
  function hitCell(px, py) {
    if (!state.layout) return -1;
    var g = geom();
    for (var i = 0; i < state.layout.cells.length; i++) {
      var r = cellRect(i, g);
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return i;
    }
    return -1;
  }

  // Rectangle (en px écran) où dessiner toute la photo d'une case
  function placement(cell, im, r) {
    var base = Math.max(r.w / im.w, r.h / im.h), s = base * cell.z;
    return {
      x: r.x + r.w / 2 - cell.u * im.w * s,
      y: r.y + r.h / 2 - cell.v * im.h * s,
      w: im.w * s, h: im.h * s, s: s
    };
  }
  // Garde la case toujours entièrement couverte par la photo.
  function clampCell(cell, im, r) {
    cell.z = Math.min(MAX_Z, Math.max(1, cell.z));
    var s = Math.max(r.w / im.w, r.h / im.h) * cell.z;
    var hu = r.w / (2 * s * im.w), hv = r.h / (2 * s * im.h);
    cell.u = Math.min(1 - hu, Math.max(hu, cell.u));
    cell.v = Math.min(1 - hv, Math.max(hv, cell.v));
  }

  // ---------- Dessin ----------
  var drawRaf = 0;
  function requestDraw() {
    if (drawRaf) return;
    drawRaf = requestAnimationFrame(function () { drawRaf = 0; draw(); });
  }

  function draw() {
    var c = vctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#06070a';
    c.fillRect(0, 0, view.width, view.height);
    if (!state.layout) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    var g = geom(), n = state.layout.cells.length, i, r;

    for (i = 0; i < n; i++) {
      r = cellRect(i, g);
      var cell = state.cells[i];
      if (cell && imgs[cell.id]) drawCell(c, cell, r);
      else drawEmpty(c, r, i);
    }
    // fines séparations (aperçu uniquement, absentes de l'export)
    c.strokeStyle = 'rgba(6, 7, 10, 0.9)';
    c.lineWidth = 1;
    for (i = 0; i < n; i++) {
      r = cellRect(i, g);
      c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }

    // Case sélectionnée : toute la photo en transparence, la partie visible en clair.
    var sel = state.sel;
    if (sel >= 0 && state.cells[sel] && imgs[state.cells[sel].id]) {
      var sc = state.cells[sel], im = imgs[sc.id];
      r = cellRect(sel, g);
      var p = placement(sc, im, r);
      c.save();
      c.globalAlpha = 0.38;
      c.drawImage(im.prev, p.x, p.y, p.w, p.h);
      c.restore();
      c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      c.lineWidth = 1;
      c.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      drawCell(c, sc, r);
      outline(c, r, '#ffb86b');
    }

    // Échange par glisser : case visée en surbrillance + vignette sous le doigt.
    if (gesture && gesture.type === 'swap') {
      var t = hitCell(gesture.cx, gesture.cy);
      if (t >= 0 && t !== gesture.src) outline(c, cellRect(t, g), '#7c9cff');
      var src = state.cells[gesture.src], sim = imgs[src.id];
      var sr = cellRect(gesture.src, g), k = Math.min(1, 110 / Math.max(sr.w, sr.h));
      var gr = { x: gesture.cx - sr.w * k / 2, y: gesture.cy - sr.h * k / 2, w: sr.w * k, h: sr.h * k };
      c.save();
      c.globalAlpha = 0.85;
      c.shadowColor = 'rgba(0, 0, 0, 0.6)';
      c.shadowBlur = 16;
      c.fillStyle = '#000';
      c.fillRect(gr.x, gr.y, gr.w, gr.h);
      c.shadowBlur = 0;
      if (sim) drawCell(c, src, gr);
      c.restore();
    }
  }

  function drawCell(c, cell, r) {
    var im = imgs[cell.id], p = placement(cell, im, r);
    c.save();
    c.beginPath();
    c.rect(r.x, r.y, r.w, r.h);
    c.clip();
    c.drawImage(im.prev, p.x, p.y, p.w, p.h);
    c.restore();
  }

  function drawEmpty(c, r, i) {
    c.fillStyle = (i % 2) ? '#161b26' : '#141821';
    c.fillRect(r.x, r.y, r.w, r.h);
    c.save();
    c.strokeStyle = 'rgba(139, 147, 167, 0.45)';
    c.setLineDash([6, 5]);
    c.lineWidth = 1.5;
    c.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    c.restore();
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.min(20, r.w / 5, r.h / 5);
    c.beginPath();
    c.arc(cx, cy, rad, 0, Math.PI * 2);
    c.fillStyle = 'rgba(124, 156, 255, 0.16)';
    c.fill();
    c.strokeStyle = '#7c9cff';
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx - rad * 0.45, cy); c.lineTo(cx + rad * 0.45, cy);
    c.moveTo(cx, cy - rad * 0.45); c.lineTo(cx, cy + rad * 0.45);
    c.stroke();
  }

  function outline(c, r, color) {
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.shadowColor = 'rgba(0, 0, 0, 0.5)';
    c.shadowBlur = 6;
    c.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
    c.restore();
  }

  // ---------- Gestes ----------
  // 1 doigt : toucher une case = choisir / sélectionner ; glisser = cadrer la photo
  // sélectionnée (le doigt peut être n'importe où) ; sans sélection, glisser une photo
  // sur une autre case = les échanger. 2 doigts : zoom de la photo sélectionnée.
  var pointers = new Map();
  var gesture = null;
  var pendingPick = -1;

  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });

  stage.addEventListener('pointerdown', function (e) {
    if (!state.layout) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      gesture = { type: 'tap', x: e.clientX, y: e.clientY, cell: hitCell(e.clientX, e.clientY) };
    } else if (pointers.size === 2) {
      startPinch();
    }
  });

  function selectedRect() { return cellRect(state.sel, geom()); }
  function hasSelPhoto() { return state.sel >= 0 && !!state.cells[state.sel]; }

  function startPinch() {
    if (!hasSelPhoto()) { gesture = { type: 'none' }; return; }
    var pts = Array.from(pointers.values()), cell = state.cells[state.sel];
    gesture = {
      type: 'pinch',
      d0: Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
      mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2,
      z0: cell.z, u0: cell.u, v0: cell.v
    };
  }

  stage.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var g = gesture;
    if (!g) return;
    if (g.type === 'tap') {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 8) return;
      if (hasSelPhoto()) {
        var cell = state.cells[state.sel];
        gesture = g = { type: 'pan', x: e.clientX, y: e.clientY, u0: cell.u, v0: cell.v };
      } else if (g.cell >= 0 && state.cells[g.cell]) {
        gesture = g = { type: 'swap', src: g.cell, cx: e.clientX, cy: e.clientY };
        requestDraw();
        return;
      } else {
        gesture = { type: 'none' };
        return;
      }
    }
    if (g.type === 'pan') {
      var c = state.cells[state.sel], im = imgs[c.id], r = selectedRect();
      var s = placement(c, im, r).s;
      c.u = g.u0 - (e.clientX - g.x) / (s * im.w);
      c.v = g.v0 - (e.clientY - g.y) / (s * im.h);
      clampCell(c, im, r);
      requestDraw();
    } else if (g.type === 'pinch' && pointers.size >= 2) {
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      zoomAt(g.z0 * d / g.d0, g, mx, my);
    } else if (g.type === 'swap') {
      g.cx = e.clientX; g.cy = e.clientY;
      requestDraw();
    }
  });

  // Zoom de la photo sélectionnée : le point de la photo situé sous (g.mx, g.my)
  // au début du geste reste sous (mx, my).
  function zoomAt(z, g, mx, my) {
    var c = state.cells[state.sel], im = imgs[c.id], r = selectedRect();
    var base = Math.max(r.w / im.w, r.h / im.h), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var s0 = base * g.z0;
    var ix = g.u0 * im.w + (g.mx - cx) / s0, iy = g.v0 * im.h + (g.my - cy) / s0;
    c.z = Math.min(MAX_Z, Math.max(1, z));
    var s1 = base * c.z;
    c.u = (ix - (mx - cx) / s1) / im.w;
    c.v = (iy - (my - cy) / s1) / im.h;
    clampCell(c, im, r);
    requestDraw();
  }

  function endPointer(e, cancelled) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    var g = gesture;
    if (!g) return;
    if (pointers.size > 0) {
      // un doigt reste posé après un pincement : on attend qu'il se lève
      if (g.type === 'pinch') gesture = { type: 'settle' };
      return;
    }
    gesture = null;
    if (g.type === 'tap' && !cancelled) onTap(g.cell);
    else if (g.type === 'pan' || g.type === 'pinch' || g.type === 'settle') commit();
    else if (g.type === 'swap') {
      var t = cancelled ? -1 : hitCell(g.cx, g.cy);
      if (t >= 0 && t !== g.src) swapCells(g.src, t);
      requestDraw();
    }
  }
  stage.addEventListener('pointerup', function (e) { endPointer(e, false); });
  stage.addEventListener('pointercancel', function (e) { endPointer(e, true); });

  // Le sélecteur de fichiers doit s'ouvrir dans un « click » (exigence de Safari).
  stage.addEventListener('click', function () {
    if (pendingPick < 0) return;
    var i = pendingPick;
    pendingPick = -1;
    openPicker(i, false);
  });

  function onTap(i) {
    if (i < 0) { select(-1); return; }
    if (!state.cells[i]) { select(-1); pendingPick = i; return; }
    select(i);
  }

  // Molette (ordinateur) : zoom de la photo sélectionnée
  var wheelTimer = 0;
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (!hasSelPhoto()) return;
    var c = state.cells[state.sel];
    zoomAt(c.z * Math.exp(-e.deltaY * 0.0015), { z0: c.z, u0: c.u, v0: c.v, mx: e.clientX, my: e.clientY }, e.clientX, e.clientY);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(commit, 300);
  }, { passive: false });

  function swapCells(a, b) {
    var t = state.cells[a];
    state.cells[a] = state.cells[b];
    state.cells[b] = t;
    var g = geom();
    [a, b].forEach(function (i) {
      var c = state.cells[i];
      if (c) clampCell(c, imgs[c.id], cellRect(i, g));
    });
    state.sel = -1;
    commit();
    toast('Photos échangées');
  }

  function select(i) {
    if (state.sel === i) return;
    state.sel = i;
    updateUI();
    requestDraw();
  }

  // ---------- Panneau de la case sélectionnée ----------
  $('#btn-done').addEventListener('click', function () { select(-1); });
  $('#btn-replace').addEventListener('click', function () { if (state.sel >= 0) openPicker(state.sel, true); });
  $('#btn-fit').addEventListener('click', function () {
    var c = state.cells[state.sel];
    if (!c) return;
    c.z = 1; c.u = 0.5; c.v = 0.5;
    commit();
    requestDraw();
  });
  $('#btn-remove').addEventListener('click', function () {
    if (state.sel < 0) return;
    state.cells[state.sel] = null;
    state.sel = -1;
    commit();
    requestDraw();
  });

  // ---------- Photos ----------
  var pickTarget = -1, pickReplace = false;

  function openPicker(target, replace) {
    pickTarget = target;
    pickReplace = replace;
    fileInput.value = '';
    fileInput.click();
  }
  $('#btn-add').addEventListener('click', function () {
    if (!state.layout) return;
    if (firstEmpty([]) < 0) { toast('Toutes les cases sont remplies'); return; }
    openPicker(-1, false);
  });

  function firstEmpty(taken) {
    for (var i = 0; i < state.cells.length; i++) {
      if (!state.cells[i] && taken.indexOf(i) < 0) return i;
    }
    return -1;
  }

  fileInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call(fileInput.files || []).filter(function (f) {
      return !f.type || f.type.indexOf('image/') === 0;
    });
    if (!files.length) return;
    // Cases à remplir : la case visée d'abord, puis les cases vides dans l'ordre.
    var targets = [];
    if (pickTarget >= 0) targets.push(pickTarget);
    while (targets.length < files.length) {
      var e = firstEmpty(targets);
      if (e < 0) break;
      targets.push(e);
    }
    var skipped = files.length - targets.length;
    files = files.slice(0, targets.length);
    var single = files.length === 1 && pickTarget >= 0;
    toast(files.length > 1 ? 'Chargement des photos…' : 'Chargement…');

    // une à une, pour limiter la mémoire sur téléphone
    var done = 0, failed = 0;
    (function next(k) {
      if (k >= files.length) {
        state.sel = single && !failed ? targets[0] : -1;
        commit();
        requestDraw();
        if (failed) toast(failed > 1 ? failed + ' photos illisibles' : 'Photo illisible');
        else if (skipped > 0) toast(skipped + (skipped > 1 ? ' photos en trop ignorées' : ' photo en trop ignorée'));
        else if (single) toast('Pincez pour zoomer, glissez pour cadrer');
        else hideToast();
        maybeSwapTip();
        return;
      }
      loadImage(files[k]).then(function (im) {
        imgs[im.id] = im;
        state.cells[targets[k]] = { id: im.id, z: 1, u: 0.5, v: 0.5 };
        done++;
        requestDraw();
        next(k + 1);
      }, function () { failed++; next(k + 1); });
    })(0);
  });

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); reject(); return; }
        var prev = downscale(img, w, h, PREV_MAX);
        URL.revokeObjectURL(url);
        // On garde le fichier d'origine : il est relu en pleine qualité à l'export.
        resolve({ id: nextId++, file: file, w: w, h: h, prev: prev });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
  }

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function freeCanvas(c) { if (c && c.getContext) { c.width = 0; c.height = 0; } }
  function smoothCtx(c) {
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    return x;
  }

  // Réduction par moitiés successives (net, sans crénelage, même sur Safari).
  function downscale(img, w, h, max) {
    var k = Math.min(1, max / Math.max(w, h));
    var tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
    var src = img, sw = w, sh = h;
    while (sw / 2 >= tw && sh / 2 >= th) {
      var c = newCanvas(sw / 2, sh / 2);
      smoothCtx(c).drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height);
      if (src !== img) freeCanvas(src);
      src = c; sw = c.width; sh = c.height;
    }
    var out = newCanvas(tw, th);
    smoothCtx(out).drawImage(src, 0, 0, sw, sh, 0, 0, tw, th);
    if (src !== img) freeCanvas(src);
    return out;
  }

  // Dessine la portion (sx, sy, sw, sh) de img dans le rectangle de destination,
  // en réduisant par moitiés si besoin.
  function drawCropped(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
    var cur = img, tmp = null;
    while (sw / 2 >= dw && sh / 2 >= dh) {
      var c = newCanvas(sw / 2, sh / 2);
      smoothCtx(c).drawImage(cur, sx, sy, sw, sh, 0, 0, c.width, c.height);
      if (tmp) freeCanvas(tmp);
      tmp = cur = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
    }
    ctx.drawImage(cur, sx, sy, sw, sh, dx, dy, dw, dh);
    if (tmp) freeCanvas(tmp);
  }

  function decodeFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
  }

  // ---------- Choix de la grille ----------
  var countButtons = document.querySelectorAll('[data-count]');
  countButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      setupCount = parseInt(b.dataset.count, 10);
      renderSetup();
    });
  });

  function renderSetup() {
    countButtons.forEach(function (b) {
      b.setAttribute('aria-checked', String(parseInt(b.dataset.count, 10) === setupCount));
    });
    var lists = { p: $('#grids-portrait'), l: $('#grids-landscape') };
    lists.l.classList.add('grid-list--landscape');
    lists.p.textContent = '';
    lists.l.textContent = '';
    LAYOUTS.forEach(function (L) {
      if (L.n !== setupCount) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'grid-choice' + (state.layout && state.layout.id === L.id ? ' is-current' : '');
      b.setAttribute('aria-label', (L.o === 'p' ? 'Grille portrait' : 'Grille paysage') + ' de ' + L.n + ' photos');
      var t = document.createElement('div');
      t.className = 'grid-thumb';
      t.style.gridTemplateColumns = 'repeat(' + L.cols + ', 1fr)';
      t.style.gridTemplateRows = 'repeat(' + L.rows + ', 1fr)';
      t.style.aspectRatio = L.cols + ' / ' + L.rows;
      L.cells.forEach(function (c) {
        var s = document.createElement('span');
        s.style.gridColumn = (c[0] + 1) + ' / span ' + c[2];
        s.style.gridRow = (c[1] + 1) + ' / span ' + c[3];
        t.appendChild(s);
      });
      b.appendChild(t);
      b.addEventListener('click', function () { chooseLayout(L); });
      lists[L.o].appendChild(b);
    });
  }

  function openSetup() {
    if (state.layout) setupCount = state.layout.n;
    state.sel = -1;
    renderSetup();
    $('#setup-cancel').hidden = !state.layout;
    setup.hidden = false;
    setup.scrollTop = 0;
    updateUI();
  }
  function closeSetup() {
    setup.hidden = true;
    updateUI();
    layout();
  }
  $('#btn-grid').addEventListener('click', openSetup);
  $('#setup-cancel').addEventListener('click', closeSetup);

  function chooseLayout(L) {
    if (!state.layout) {
      state.layout = L;
      state.cells = L.cells.map(function () { return null; });
      state.hist = [];
      state.idx = -1;
      commit();
      closeSetup();
      toast('Touchez une case pour ajouter une photo');
      return;
    }
    if (L.id !== state.layout.id) {
      var old = state.cells, cells;
      if (L.n === old.length) {
        // même nombre de photos : chacune garde sa place
        cells = old.map(function (c) { return c ? { id: c.id, z: 1, u: 0.5, v: 0.5 } : null; });
      } else {
        var kept = old.filter(Boolean);
        cells = L.cells.map(function (_, i) {
          var c = kept[i];
          return c ? { id: c.id, z: 1, u: 0.5, v: 0.5 } : null;
        });
        if (kept.length > L.n) toast((kept.length - L.n) + ' photo(s) retirée(s) — « Précédent » pour revenir');
      }
      state.layout = L;
      state.cells = cells;
      state.sel = -1;
      commit();
    }
    closeSetup();
  }

  // ---------- Interface ----------
  function updateUI() {
    var hasLayout = !!state.layout, editing = hasLayout && setup.hidden;
    $('#btn-undo').disabled = !editing || state.idx <= 0;
    $('#btn-redo').disabled = !editing || state.idx >= state.hist.length - 1;
    var any = state.cells.some(Boolean);
    $('#btn-save').disabled = !any;
    $('#btn-add').disabled = !hasLayout;
    panel.classList.toggle('is-open', editing && hasSelPhoto());
    document.documentElement.style.setProperty('--bottom-h', bottomBars.offsetHeight + 'px');
  }

  var swapTipShown = false;
  function maybeSwapTip() {
    if (swapTipShown || state.cells.filter(Boolean).length < 2) return;
    swapTipShown = true;
    setTimeout(function () { toast('Astuce : glissez une photo sur une autre pour les échanger', 3200); }, 1800);
  }

  // ---------- Export ----------
  var sheet = $('#save-sheet'), shareBtn = $('#btn-share'), downloadBtn = $('#btn-download');
  var preview = $('#save-preview');
  var exportFile = null, exportUrl = null, exporting = false;

  $('#btn-save').addEventListener('click', function () {
    if (exporting || !state.layout) return;
    var empty = state.cells.filter(function (c) { return !c; }).length;
    if (empty && !window.confirm(empty > 1
      ? 'Il reste ' + empty + ' cases vides (elles seront blanches). Exporter quand même ?'
      : 'Il reste une case vide (elle sera blanche). Exporter quand même ?')) return;
    select(-1);
    exporting = true;
    toast('Préparation de l’image…', 10000);
    renderExport().then(function (canvas) {
      canvas.toBlob(function (blob) {
        freeCanvas(canvas);
        exporting = false;
        hideToast();
        if (!blob) { toast('Export impossible'); return; }
        if (exportUrl) URL.revokeObjectURL(exportUrl);
        var name = 'mosaic-' + timestamp() + '.jpg';
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
    }, function () {
      exporting = false;
      toast('Export impossible');
    });
  });

  // Rendu final en pleine qualité : chaque photo est relue depuis son fichier d'origine.
  function renderExport() {
    var L = state.layout;
    var unit = Math.floor(EXPORT_LONG / Math.max(L.cols, L.rows));
    var out = newCanvas(unit * L.cols, unit * L.rows), ctx = smoothCtx(out);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    var cells = state.cells.slice();
    var chain = Promise.resolve();
    L.cells.forEach(function (lc, i) {
      var cell = cells[i];
      if (!cell) return;
      chain = chain.then(function () {
        var im = imgs[cell.id];
        var r = { x: lc[0] * unit, y: lc[1] * unit, w: lc[2] * unit, h: lc[3] * unit };
        return decodeFile(im.file).then(function (d) {
          var fw = d.img.naturalWidth, fh = d.img.naturalHeight;
          var s = Math.max(r.w / fw, r.h / fh) * cell.z;
          var sw = r.w / s, sh = r.h / s;
          var sx = Math.min(fw - sw, Math.max(0, cell.u * fw - sw / 2));
          var sy = Math.min(fh - sh, Math.max(0, cell.v * fh - sh / 2));
          drawCropped(ctx, d.img, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
          URL.revokeObjectURL(d.url);
        }, function () {
          // fichier devenu illisible : on se rabat sur la copie d'édition
          var p = placement(cell, im, r);
          ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
          ctx.drawImage(im.prev, p.x, p.y, p.w, p.h);
          ctx.restore();
        });
      });
    });
    return chain.then(function () { return out; });
  }

  shareBtn.addEventListener('click', function () {
    if (!exportFile) return;
    navigator.share({ files: [exportFile] }).then(function () {
      state.exportedIdx = state.idx;
      closeSheet();
      toast('Mosaïque enregistrée');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      downloadBtn.click();
    });
  });
  downloadBtn.addEventListener('click', function () { state.exportedIdx = state.idx; });
  function closeSheet() { sheet.hidden = true; }
  $('#btn-close-sheet').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });

  function timestamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  window.addEventListener('beforeunload', function (e) {
    if (state.cells.some(Boolean) && state.exportedIdx !== state.idx) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- Toast ----------
  var toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 1800);
  }
  function hideToast() { clearTimeout(toastTimer); toastEl.classList.remove('is-visible'); }

  renderSetup();
  updateUI();
  layout();
})();
