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
    // Baguette : tol = niveau 0..1000 ; `sel` = sélection en cours (non appliquée)
    // step 1 = choix de la zone à effacer, step 2 = choix de la zone source
    // match = « raccord couleur » en % (100 = raccord au contour, 0 = teinte de la source)
    wand: { tol: 150, grow: 2, match: 100, step: 1, method: 'heal', sel: null },
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
      // Flou gaussien approché, calculé à la main (sans ctx.filter, ignoré par Safari) :
      // on réduit l'image, on applique 3 flous « boîte » sur cette petite version
      // (rapide), puis on la ré-agrandit en douceur.
      var sigma = L * (0.002 + 0.0028 * grain);
      var f = Math.max(1, sigma / 2.45);
      var s2 = downscale(src, Math.max(1, Math.round(w / f)), Math.max(1, Math.round(h / f)));
      boxBlurCanvas(s2, 2, 3);
      upscaleInto(s2, out);
      freeCanvas(s2);
    }
    return out;
  }

  // Flou « boîte » séparable (horizontal puis vertical), répété `passes` fois.
  function boxBlurCanvas(c, radius, passes) {
    var w = c.width, h = c.height;
    var x = c.getContext('2d');
    var img = x.getImageData(0, 0, w, h);
    var a = img.data;
    var b = new Uint8ClampedArray(a.length);
    for (var p = 0; p < passes; p++) {
      boxPass(a, b, w, h, radius, 4, w * 4);   // lignes
      boxPass(b, a, h, w, radius, w * 4, 4);   // colonnes
    }
    x.putImageData(img, 0, 0);
  }

  // Un passage 1D : `len` pixels par ligne, `lines` lignes ; `step` = écart entre
  // deux pixels voisins, `lineStep` = écart entre deux lignes (en octets).
  function boxPass(src, dst, len, lines, r, step, lineStep) {
    var div = 2 * r + 1;
    for (var l = 0; l < lines; l++) {
      var base = l * lineStep;
      for (var ch = 0; ch < 4; ch++) {
        var sum = 0, i;
        for (i = -r; i <= r; i++) {
          var k = Math.min(len - 1, Math.max(0, i));
          sum += src[base + k * step + ch];
        }
        for (i = 0; i < len; i++) {
          dst[base + i * step + ch] = sum / div;
          var out = Math.max(0, i - r);
          var inn = Math.min(len - 1, i + r + 1);
          sum += src[base + inn * step + ch] - src[base + out * step + ch];
        }
      }
    }
  }

  // ---------- Baguette magique ----------
  // Sélection « par proximité » (comme la baguette de Paint.NET) : depuis le pixel touché,
  // on s'étend aux voisins dont la couleur est assez proche de la couleur touchée.
  //
  // Astuce de performance : au toucher, on calcule une seule fois pour CHAQUE pixel
  // la tolérance minimale à partir de laquelle il rejoint la sélection (propagation
  // « minimax » avec une file à seaux). Changer la tolérance devient alors un simple
  // seuil : l'aperçu se met à jour en direct.
  var WAND_LEVELS = 1000; // la tolérance 0..1 est discrétisée en 1000 niveaux

  // Prépare l'analyse depuis le pixel (sx, sy). Le calcul lui-même est progressif :
  // wandExtend(a, T) ne traite que les niveaux nécessaires jusqu'à la tolérance T,
  // et reprend là où il s'était arrêté si la tolérance augmente ensuite.
  function wandAnalyze(imageData, sx, sy, T) {
    var w = imageData.width, h = imageData.height, d = imageData.data, N = w * h, LV = WAND_LEVELS;
    var s = sy * w + sx, si = s * 4;
    var a = {
      w: w, h: h, sx: sx, sy: sy, image: imageData,
      seed: [d[si], d[si + 1], d[si + 2]],
      level: new Uint16Array(N).fill(65535),
      next: new Int32Array(N),
      head: new Int32Array(LV + 1).fill(-1),
      count: new Float64Array(LV + 1),
      x0: new Int32Array(LV + 1).fill(w), y0: new Int32Array(LV + 1).fill(h),
      x1: new Int32Array(LV + 1).fill(-1), y1: new Int32Array(LV + 1).fill(-1),
      done: -1 // dernier niveau entièrement traité
    };
    a.level[s] = 0; a.next[s] = -1; a.head[0] = s;
    wandExtend(a, T == null ? LV : T);
    return a;
  }

  function wandExtend(a, T) {
    if (T <= a.done) return;
    var w = a.w, h = a.h, d = a.image.data, LV = WAND_LEVELS;
    var level = a.level, next = a.next, head = a.head, count = a.count;
    var bx0 = a.x0, by0 = a.y0, bx1 = a.x1, by1 = a.y1;
    var r0 = a.seed[0], g0 = a.seed[1], b0 = a.seed[2];
    // distance RGB normalisée : 0 = même couleur, 1 = écart maximal (noir ↔ blanc)
    var norm = LV / (Math.sqrt(3) * 255);

    for (var L = a.done + 1; L <= T; L++) {
      // Les cumuls du niveau L partent de ceux du niveau précédent.
      if (L > 0) {
        count[L] = count[L - 1];
        bx0[L] = bx0[L - 1]; by0[L] = by0[L - 1]; bx1[L] = bx1[L - 1]; by1[L] = by1[L - 1];
      }
      while (head[L] !== -1) {
        var p = head[L];
        head[L] = next[p];
        var x = p % w, y = (p - x) / w;
        count[L]++;
        if (x < bx0[L]) bx0[L] = x;
        if (x > bx1[L]) bx1[L] = x;
        if (y < by0[L]) by0[L] = y;
        if (y > by1[L]) by1[L] = y;
        // 4 voisins
        for (var k = 0; k < 4; k++) {
          var n;
          if (k === 0) { if (x === 0) continue; n = p - 1; }
          else if (k === 1) { if (x === w - 1) continue; n = p + 1; }
          else if (k === 2) { if (y === 0) continue; n = p - w; }
          else { if (y === h - 1) continue; n = p + w; }
          if (level[n] !== 65535) continue;
          var ni = n * 4;
          var dr = d[ni] - r0, dg = d[ni + 1] - g0, db = d[ni + 2] - b0;
          var nl = Math.ceil(Math.sqrt(dr * dr + dg * dg + db * db) * norm);
          if (nl < L) nl = L;
          if (nl > LV) nl = LV;
          level[n] = nl;
          next[n] = head[nl];
          head[nl] = n;
        }
      }
    }
    a.done = T;
  }

  // Extrait la zone utile : rectangle englobant la sélection, élargie de `grow` px,
  // + 1 px de marge (le contour extérieur, utilisé par le remplissage).
  // Renvoie une copie des pixels d'origine + le masque (1 = à remplacer).
  var HALO_MAX = 40;  // px : extension automatique maximale sur le halo de l'encre
  var HALO_BAND = 8;  // px : anneau de peau « propre » au-delà, pour la couleur de référence

  function wandRegion(a, T, grow) {
    wandExtend(a, T);
    var margin = grow + 1 + HALO_MAX + HALO_BAND;
    var x0 = Math.max(0, a.x0[T] - margin), y0 = Math.max(0, a.y0[T] - margin);
    var x1 = Math.min(a.w - 1, a.x1[T] + margin), y1 = Math.min(a.h - 1, a.y1[T] + margin);
    var rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    var src = a.image.data, data = new Uint8ClampedArray(rw * rh * 4), mask = new Uint8Array(rw * rh);
    for (var y = 0; y < rh; y++) {
      var row = (y0 + y) * a.w + x0;
      data.set(src.subarray(row * 4, (row + rw) * 4), y * rw * 4);
      for (var x = 0; x < rw; x++) mask[y * rw + x] = a.level[row + x] <= T ? 1 : 0;
    }
    // Élargissement (dilatation), en alternant voisinage 4 et 8 pour un bord arrondi.
    for (var g = 0; g < grow; g++) {
      var prev = mask.slice(), diag = g % 2 === 1;
      for (var yy = 0; yy < rh; yy++) {
        for (var xx = 0; xx < rw; xx++) {
          var i = yy * rw + xx;
          if (prev[i]) continue;
          var l = xx > 0, r = xx < rw - 1, u = yy > 0, dn = yy < rh - 1;
          if ((l && prev[i - 1]) || (r && prev[i + 1]) || (u && prev[i - rw]) || (dn && prev[i + rw]) ||
              (diag && ((l && u && prev[i - rw - 1]) || (r && u && prev[i - rw + 1]) ||
                        (l && dn && prev[i + rw - 1]) || (r && dn && prev[i + rw + 1])))) {
            mask[i] = 1;
          }
        }
      }
    }
    // Un pixel sélectionné collé au bord de la photo n'a pas de contour de ce côté :
    // on le retire du masque pour que le remplissage ait toujours 4 voisins.
    for (var e = 0; e < rw; e++) { if (y0 === 0) mask[e] = 0; if (y1 === a.h - 1) mask[(rh - 1) * rw + e] = 0; }
    for (var f = 0; f < rh; f++) { if (x0 === 0) mask[f * rw] = 0; if (x1 === a.w - 1) mask[f * rw + rw - 1] = 0; }
    var count = 0, list = [];
    for (var k = 0; k < mask.length; k++) if (mask[k]) { count++; list.push(k); }
    return {
      x: x0, y: y0, w: rw, h: rh, data: data, mask: mask, count: count,
      list: Int32Array.from(list), T: T, grow: grow
    };
  }

  // Méthodes de remplissage de la sélection (on en ajoutera d'autres pour les essais).
  // fill(c) reçoit c = { data (RGBA de la zone, à modifier là où mask = 1), mask, list
  // (indices sélectionnés), w, h, x, y (origine de la zone dans la photo),
  // image (ImageData de toute la photo), params } et renvoie des infos, ou null.
  var FILL_METHODS = {
    // « Correcteur » (comme la Pièce / le pinceau correcteur de Photoshop) :
    // - la TEXTURE (grain, pores, bruit) est copiée depuis la zone source (décalage dx, dy) ;
    // - la COULEUR / LUMIÈRE est raccordée au contour : l'écart entre le contour de la
    //   sélection et celui de la source est étalé en douceur dans toute la zone
    //   (interpolation « membrane » = équation de Laplace), donc pas de démarcation.
    heal: {
      fill: function (c) {
        var w = c.w, h = c.h, m = c.mask, d = c.data, list = c.list;
        var img = c.image, IW = img.width, IH = img.height, S = img.data;
        var dx = Math.round(c.params.dx || 0), dy = Math.round(c.params.dy || 0);
        var n = w * h;
        // indice (dans la photo) du pixel source correspondant au pixel (rx, ry) de la zone
        function src(rx, ry) {
          var X = c.x + rx + dx, Y = c.y + ry + dy;
          if (X < 0) X = -X; else if (X >= IW) X = 2 * IW - 2 - X; // miroir aux bords
          if (Y < 0) Y = -Y; else if (Y >= IH) Y = 2 * IH - 2 - Y;
          X = Math.min(IW - 1, Math.max(0, X)); Y = Math.min(IH - 1, Math.max(0, Y));
          return (Y * IW + X) * 4;
        }

        // 0. Halo de l'encre : autour d'un tatouage, les pixels juste à l'extérieur de la
        //    sélection sont encore teintés par l'encre. S'ils servaient au raccord, toute la
        //    zone ressortirait trop sombre. On étend donc la zone traitée sur ce halo
        //    (pixels nettement plus proches de la couleur de l'encre que la peau propre).
        // Ne dépend que de la zone à effacer (pas de la source) : calculé une fois par
        // sélection et mis en cache, pour que le glissement de la source reste fluide.
        // Le halo ne sert QU'À mesurer la couleur (raccord pris sur de la peau propre) :
        // seuls les pixels de la sélection elle-même sont remplacés.
        var selList = c.list, selMask = c.mask;
        var halo = null;
        if (c.params.seed && HALO_MAX > 0) {
          if (c.cache && 'halo' in c.cache) halo = c.cache.halo;
          else {
            halo = haloExtend(d, m, w, h, c.params.seed);
            if (c.cache) c.cache.halo = halo;
          }
          if (halo) { m = halo.mask; list = halo.list; }
        }

        // 1. Contour extérieur : écart de couleur destination − source.
        var F = new Float32Array(n * 3);   // correction (R, V, B) par pixel
        var bIdx = [], bx = [], by = [];
        var x, y, i, s, j;
        for (y = 0; y < h; y++) {
          for (x = 0; x < w; x++) {
            i = y * w + x;
            if (m[i]) continue;
            if ((x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w])) {
              s = src(x, y);
              var cr = d[i * 4], cg = d[i * 4 + 1], cb = d[i * 4 + 2];
              // Pixel encore un peu teinté par l'encre : on retire la part d'encre
              // (« démélange ») pour retrouver la couleur de la peau à cet endroit.
              if (halo) {
                var un = halo.unmix(x, y, cr, cg, cb);
                cr = un[0]; cg = un[1]; cb = un[2];
              }
              F[i * 3] = cr - S[s];
              F[i * 3 + 1] = cg - S[s + 1];
              F[i * 3 + 2] = cb - S[s + 2];
              bIdx.push(i); bx.push(x); by.push(y);
            }
          }
        }
        var B = bIdx.length, L = list.length;
        if (!B || !L) return null; // rien à remplir, ou pas de contour

        // 2. Première approximation lisse : moyenne des écarts du contour pondérée
        //    par l'inverse de la distance (sur 256 points du contour au plus).
        // (aperçu « rapide » pendant que le doigt glisse : moins de points, moins d'itérations)
        var fast = !!c.params.fast;
        var stride = Math.max(1, Math.ceil(B / (fast ? 48 : 256)));
        var K = Math.ceil(B / stride), kx = new Float32Array(K), ky = new Float32Array(K), kv = new Float32Array(K * 3);
        for (j = 0, s = 0; j < B; j += stride, s++) {
          kx[s] = bx[j]; ky[s] = by[j];
          kv[s * 3] = F[bIdx[j] * 3]; kv[s * 3 + 1] = F[bIdx[j] * 3 + 1]; kv[s * 3 + 2] = F[bIdx[j] * 3 + 2];
        }
        var p;
        for (j = 0; j < L; j++) {
          p = list[j];
          x = p % w; y = (p - x) / w;
          var sw = 0, sr = 0, sg = 0, sb = 0;
          for (var q = 0; q < K; q++) {
            var ex = kx[q] - x, ey = ky[q] - y, d2 = ex * ex + ey * ey + 0.5;
            var wt = 1 / (d2 * Math.sqrt(d2));
            sw += wt; sr += wt * kv[q * 3]; sg += wt * kv[q * 3 + 1]; sb += wt * kv[q * 3 + 2];
          }
          F[p * 3] = sr / sw; F[p * 3 + 1] = sg / sw; F[p * 3 + 2] = sb / sw;
        }

        // 3. Affinage : relaxation (Gauss-Seidel sur-relaxé) de l'équation de Laplace,
        //    pour un raccord parfait avec chaque pixel du contour.
        var iters = fast ? 12 : (L > 200000 ? 40 : 80), om = 1.85;
        for (var it = 0; it < iters; it++) {
          for (j = 0; j < L; j++) {
            p = list[j];
            var a3 = (p - 1) * 3, b3 = (p + 1) * 3, u3 = (p - w) * 3, v3 = (p + w) * 3, p3 = p * 3;
            F[p3] += om * ((F[a3] + F[b3] + F[u3] + F[v3]) * 0.25 - F[p3]);
            F[p3 + 1] += om * ((F[a3 + 1] + F[b3 + 1] + F[u3 + 1] + F[v3 + 1]) * 0.25 - F[p3 + 1]);
            F[p3 + 2] += om * ((F[a3 + 2] + F[b3 + 2] + F[u3 + 2] + F[v3 + 2]) * 0.25 - F[p3 + 2]);
          }
        }

        // 4. Résultat = texture source + correction × « raccord couleur »
        //    (1 = raccord complet au contour, 0 = teinte exacte de la source).
        var k = c.params.match == null ? 1 : c.params.match;
        var overlap = 0, SL = selList.length;
        for (j = 0; j < SL; j++) {
          p = selList[j];
          x = p % w; y = (p - x) / w;
          s = src(x, y);
          d[p * 4] = S[s] + F[p * 3] * k;
          d[p * 4 + 1] = S[s + 1] + F[p * 3 + 1] * k;
          d[p * 4 + 2] = S[s + 2] + F[p * 3 + 2] * k;
          d[p * 4 + 3] = 255;
          // la source tombe-t-elle dans la zone à effacer ?
          var sx = x + dx, sy = y + dy;
          if (sx >= 0 && sy >= 0 && sx < w && sy < h && selMask[sy * w + sx]) overlap++;
        }
        return { overlap: SL ? overlap / SL : 0, mask: selMask };
      }
    },

    // Ancienne méthode (gardée pour comparaison) : couleur médiane du contour, en aplat.
    median: {
      fill: function (c) {
        var data = c.data, mask = c.mask, w = c.w, h = c.h;
        var hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), n = 0;
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var i = y * w + x;
            if (mask[i]) continue;
            if ((x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) ||
                (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w])) {
              hr[data[i * 4]]++; hg[data[i * 4 + 1]]++; hb[data[i * 4 + 2]]++; n++;
            }
          }
        }
        if (!n) return null;
        var col = [histMedian(hr, n), histMedian(hg, n), histMedian(hb, n)];
        for (var j = 0; j < c.list.length; j++) {
          var p = c.list[j];
          data[p * 4] = col[0]; data[p * 4 + 1] = col[1]; data[p * 4 + 2] = col[2]; data[p * 4 + 3] = 255;
        }
        return { color: col };
      }
    }
  };

  // Étend le masque sur le halo de l'encre. Renvoie { mask, list } ou null.
  //  - distances (en px) de chaque pixel à la sélection, par propagation ;
  //  - couleur de référence « peau propre » = médiane de l'anneau situé au-delà du halo ;
  //  - un pixel du halo est un pixel nettement plus proche de la couleur de l'encre
  //    (seed) que ne l'est la peau propre ; on l'ajoute s'il touche la zone, couche par couche.
  function haloExtend(d, m, w, h, seed) {
    var n = w * h, dist = new Int16Array(n).fill(-1), queue = new Int32Array(n), qh = 0, qt = 0;
    var i, x, y;
    for (i = 0; i < n; i++) if (m[i]) { dist[i] = 0; queue[qt++] = i; }
    var maxD = HALO_MAX + HALO_BAND;
    while (qh < qt) {
      var p = queue[qh++], dp = dist[p];
      if (dp >= maxD) continue;
      x = p % w; y = (p - x) / w;
      if (x > 0 && dist[p - 1] < 0) { dist[p - 1] = dp + 1; queue[qt++] = p - 1; }
      if (x < w - 1 && dist[p + 1] < 0) { dist[p + 1] = dp + 1; queue[qt++] = p + 1; }
      if (y > 0 && dist[p - w] < 0) { dist[p - w] = dp + 1; queue[qt++] = p - w; }
      if (y < h - 1 && dist[p + w] < 0) { dist[p + w] = dp + 1; queue[qt++] = p + w; }
    }
    // Couleur de référence « peau propre » : médiane de l'anneau [HALO_MAX + 1, HALO_MAX + HALO_BAND],
    // calculée par secteur angulaire (16) autour de la zone, pour suivre l'éclairage local.
    var SEC = 16, cx = 0, cy = 0, cm = 0;
    for (i = 0; i < n; i++) if (m[i]) { x = i % w; cx += x; cy += (i - x) / w; cm++; }
    if (!cm) return null;
    cx /= cm; cy /= cm;
    function sectorOf(px, py) {
      var a = Math.atan2(py - cy, px - cx);
      return Math.min(SEC - 1, Math.floor((a + Math.PI) / (2 * Math.PI) * SEC));
    }
    var hist = new Uint32Array(SEC * 3 * 256), scnt = new Uint32Array(SEC + 1);
    var G = SEC; // index du cumul global
    var ghist = new Uint32Array(3 * 256);
    for (i = 0; i < n; i++) {
      if (dist[i] <= HALO_MAX) continue;
      x = i % w; y = (i - x) / w;
      var sc = sectorOf(x, y), o = sc * 768;
      hist[o + d[i * 4]]++; hist[o + 256 + d[i * 4 + 1]]++; hist[o + 512 + d[i * 4 + 2]]++; scnt[sc]++;
      ghist[d[i * 4]]++; ghist[256 + d[i * 4 + 1]]++; ghist[512 + d[i * 4 + 2]]++; scnt[G]++;
    }
    if (!scnt[G]) return null;
    var glob = [histMedian(ghist.subarray(0, 256), scnt[G]), histMedian(ghist.subarray(256, 512), scnt[G]),
                histMedian(ghist.subarray(512), scnt[G])];
    var refs = [], Ds = new Float32Array(SEC);
    for (var k = 0; k < SEC; k++) {
      var nk = scnt[k], o2 = k * 768;
      var rf = nk >= 30
        ? [histMedian(hist.subarray(o2, o2 + 256), nk), histMedian(hist.subarray(o2 + 256, o2 + 512), nk),
           histMedian(hist.subarray(o2 + 512, o2 + 768), nk)]
        : glob;
      refs.push(rf);
      Ds[k] = Math.hypot(rf[0] - seed[0], rf[1] - seed[1], rf[2] - seed[2]);
    }
    var Dg = Math.hypot(glob[0] - seed[0], glob[1] - seed[1], glob[2] - seed[2]);
    if (Dg < 40) return null; // encre trop proche de la peau : pas de halo identifiable

    // Couleur moyennée sur 5×5 px (images intégrales) : le grain de la peau est gommé,
    // ce qui permet de mesurer précisément une faible part d'encre.
    var R5 = 2, ii = new Float64Array((w + 1) * (h + 1) * 3);
    for (y = 0; y < h; y++) {
      var ar = 0, ag = 0, ab = 0;
      for (x = 0; x < w; x++) {
        var q = (y * w + x) * 4;
        ar += d[q]; ag += d[q + 1]; ab += d[q + 2];
        var t = ((y + 1) * (w + 1) + x + 1) * 3, u = (y * (w + 1) + x + 1) * 3;
        ii[t] = ii[u] + ar; ii[t + 1] = ii[u + 1] + ag; ii[t + 2] = ii[u + 2] + ab;
      }
    }
    function smooth(px, py) {
      var xa = Math.max(0, px - R5), xb = Math.min(w, px + R5 + 1);
      var ya = Math.max(0, py - R5), yb = Math.min(h, py + R5 + 1);
      var A = (ya * (w + 1) + xa) * 3, Bq = (ya * (w + 1) + xb) * 3, C = (yb * (w + 1) + xa) * 3, Dq = (yb * (w + 1) + xb) * 3;
      var area = (xb - xa) * (yb - ya);
      return [(ii[Dq] - ii[Bq] - ii[C] + ii[A]) / area,
              (ii[Dq + 1] - ii[Bq + 1] - ii[C + 1] + ii[A + 1]) / area,
              (ii[Dq + 2] - ii[Bq + 2] - ii[C + 2] + ii[A + 2]) / area];
    }
    // part d'encre estimée d'un pixel (0 = peau propre, 1 = encre pure)
    function inkAt(px, py) {
      var D = Ds[sectorOf(px, py)];
      if (D < 40) return 0;
      var sm = smooth(px, py);
      return 1 - Math.hypot(sm[0] - seed[0], sm[1] - seed[1], sm[2] - seed[2]) / D;
    }

    var out = m.slice();
    for (var layer = 1; layer <= HALO_MAX; layer++) {
      var added = 0;
      for (i = 0; i < n; i++) {
        if (dist[i] !== layer || out[i]) continue;
        x = i % w; y = (i - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue; // garder un contour
        if (!(out[i - 1] || out[i + 1] || out[i - w] || out[i + w])) continue;
        // encore au moins 4 % d'encre (mesuré sur la couleur moyennée) → halo
        if (inkAt(x, y) > 0.04) { out[i] = 1; added++; }
      }
      if (!added) break; // plus de halo : on s'arrête
    }
    var list = [];
    for (i = 0; i < n; i++) if (out[i]) list.push(i);

    return {
      mask: out,
      list: Int32Array.from(list),
      // Retire la part d'encre d'un pixel : pixel = (1 − α)·peau + α·encre,
      // avec α estimé d'après sa distance à l'encre comparée à celle de la peau propre.
      unmix: function (px, py, r, g, b) {
        // part d'encre mesurée sur la couleur moyennée (insensible au grain),
        // retirée du pixel réel (dont on garde ainsi le grain)
        var alpha = inkAt(px, py);
        if (alpha <= 0.01) return [r, g, b];
        if (alpha > 0.7) alpha = 0.7;
        var inv = 1 / (1 - alpha);
        return [(r - alpha * seed[0]) * inv, (g - alpha * seed[1]) * inv, (b - alpha * seed[2]) * inv];
      }
    };
  }

  function histMedian(hist, n) {
    var half = n / 2, acc = 0;
    for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= half) return v; }
    return 255;
  }

  // Remplit une zone (calculée par wandRegion) : renvoie les pixels résultat + infos.
  function wandFill(a, reg, method, params) {
    var m = FILL_METHODS[method] || FILL_METHODS.heal;
    var out = reg.data.slice();
    var info = m.fill({
      data: out, mask: reg.mask, list: reg.list, w: reg.w, h: reg.h, x: reg.x, y: reg.y,
      image: a.image, params: params || {}, cache: reg.cache || (reg.cache = {})
    });
    return { data: out, info: info };
  }

  // Décalage source par défaut : juste à côté de la sélection, sans la chevaucher,
  // en restant dans la photo (on essaie à droite, à gauche, en bas, en haut…).
  function wandDefaultOffset(a, reg) {
    var gap = 12, bw = reg.w, bh = reg.h;
    var cands = [[bw + gap, 0], [-(bw + gap), 0], [0, bh + gap], [0, -(bh + gap)],
                 [bw + gap, bh + gap], [-(bw + gap), bh + gap], [bw + gap, -(bh + gap)], [-(bw + gap), -(bh + gap)]];
    var best = cands[0], bestOut = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var x0 = reg.x + cands[i][0], y0 = reg.y + cands[i][1];
      var out = Math.max(0, -x0) + Math.max(0, x0 + bw - a.w) + Math.max(0, -y0) + Math.max(0, y0 + bh - a.h);
      if (out < bestOut) { bestOut = out; best = cands[i]; }
      if (out === 0) break;
    }
    return { dx: best[0], dy: best[1] };
  }

  // Calcul complet à partir d'une opération enregistrée (pour rejouer l'historique).
  function wandCompute(a, op) {
    var reg = wandRegion(a, op.tol, op.grow || 0);
    var res = wandFill(a, reg, op.method, {
      dx: op.dx, dy: op.dy, seed: a.seed, match: op.match == null ? 1 : op.match
    });
    reg.result = res.data;
    reg.info = res.info;
    return reg;
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
    } else if (op.type === 'wand') {
      // On rejoue la sélection à partir de l'état courant de la photo (déterministe).
      var a = wandAnalyze(pctx.getImageData(0, 0, photo.width, photo.height), op.x, op.y, op.tol);
      var reg = wandCompute(a, op);
      if (reg.info) pctx.putImageData(new ImageData(reg.result, reg.w, reg.h), reg.x, reg.y);
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
    if (state.wand.sel) { wandDiscard(); return; }
    if (state.idx === 0) return;
    state.idx--;
    rerender();
    updateHistoryUI();
    toast('Retouche annulée');
  }

  function redo() {
    if (state.pending) commitPending();
    if (state.wand.sel) wandApply();
    if (state.idx >= state.ops.length) return;
    applyOp(state.ops[state.idx]);
    state.idx++;
    updateHistoryUI();
    toast('Retouche rétablie');
  }

  function updateHistoryUI() {
    undoBtn.disabled = !state.loaded || (state.idx === 0 && !state.pending && !state.wand.sel);
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
      if (state.wand.sel) wandDiscard();
      photo.width = w; photo.height = h;
      pctx.drawImage(base, 0, 0);
      state.loaded = true;
      state.view = { s: 1, tx: 0, ty: 0 };
      state.initialView = true;

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
  var topbar = $('#topbar');
  var bottomBars = $('#bottom-bars');
  var toolbar = $('#toolbar');

  // Hauteurs des barres qui flottent au-dessus de la photo.
  function insets() {
    return { top: topbar.offsetHeight, bottom: bottomBars.offsetHeight, toolbar: toolbar.offsetHeight };
  }

  // Échelle (relative au cadrage « photo entière ») qui fait remplir la largeur de l'écran.
  function fillScale() {
    return state.fit.w ? Math.max(1, stage.clientWidth / state.fit.w) : 1;
  }

  function layout() {
    var ins = insets();
    var root = document.documentElement.style;
    root.setProperty('--top-h', ins.top + 'px');
    root.setProperty('--bottom-h', ins.bottom + 'px');
    if (!state.loaded) return;
    var sw = stage.clientWidth, sh = stage.clientHeight;
    // Cadrage de base (zoom 1) : photo entière entre la barre du haut et la barre d'outils.
    var availH = Math.max(1, sh - ins.top - ins.toolbar);
    var k = Math.min(sw / state.iw, availH / state.ih);
    var w = Math.max(1, Math.floor(state.iw * k)), h = Math.max(1, Math.floor(state.ih * k));
    state.fit = { left: Math.round((sw - w) / 2), top: Math.round(ins.top + (availH - h) / 2), w: w, h: h };
    wrap.style.left = state.fit.left + 'px';
    wrap.style.top = state.fit.top + 'px';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    if (state.initialView) {
      // Au chargement : la photo remplit toute la largeur, centrée verticalement.
      state.initialView = false;
      state.view.s = fillScale();
      state.view.tx = -state.fit.left;
      state.view.ty = (ins.top + sh - ins.bottom) / 2 - h * state.view.s / 2 - state.fit.top;
    }
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
    var ins = insets();
    v.s = Math.min(8, Math.max(1, v.s));
    // Zone visible entre les barres : la photo peut passer dessous, mais on doit
    // toujours pouvoir amener chacun de ses bords dans cette zone.
    function axis(t, origin, size, a0, a1) {
      var scaled = size * v.s;
      if (scaled <= a1 - a0) return a0 + (a1 - a0 - scaled) / 2 - origin;
      return Math.min(a0 - origin, Math.max(a1 - scaled - origin, t));
    }
    v.tx = axis(v.tx, f.left, f.w, 0, sw);
    v.ty = axis(v.ty, f.top, f.h, ins.top, sh - ins.bottom);
  }

  function applyView() {
    var v = state.view;
    wrap.style.transform = 'translate(' + v.tx + 'px,' + v.ty + 'px) scale(' + v.s + ')';
    var fs = fillScale();
    var zoomedIn = v.s > 1.02;
    zoomResetBtn.textContent = zoomedIn ? 'Voir tout' : 'Plein écran';
    zoomResetBtn.hidden = !state.loaded || (!zoomedIn && fs <= 1.02);
  }

  zoomResetBtn.addEventListener('click', function () {
    var v = state.view;
    if (v.s > 1.02) {
      v.s = 1;
    } else {
      var ins = insets();
      var cy = (ins.top + stage.clientHeight - ins.bottom) / 2;
      var ly = (cy - state.fit.top - v.ty) / v.s;
      v.s = fillScale();
      v.tx = -state.fit.left;
      v.ty = cy - state.fit.top - ly * v.s;
    }
    clampView();
    applyView();
    resizeOverlay();
  });

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { layout(); });
    ro.observe(stage);
    ro.observe(bottomBars);
    ro.observe(topbar);
  } else {
    window.addEventListener('resize', layout);
  }

  // Coordonnées écran → coordonnées image.
  function toImage(cx, cy) {
    var r = photo.getBoundingClientRect();
    return { x: (cx - r.left) * state.iw / r.width, y: (cy - r.top) * state.ih / r.height };
  }
  // Centre (coordonnées écran) de la zone visible entre les barres.
  function visibleCenter() {
    var sr = stage.getBoundingClientRect(), ins = insets();
    return { x: sr.left + sr.width / 2, y: sr.top + (ins.top + sr.height - ins.bottom) / 2 };
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

    var ws = state.wand.sel;
    if (ws && ws.preview && ws.reg) {
      var R = ws.reg;
      ctx.imageSmoothingEnabled = false; // bords nets, fidèles au résultat final
      ctx.drawImage(ws.preview, R.x * sc, R.y * sc, R.w * sc, R.h * sc);
      if (state.wand.step === 2 && ws.ghost && ws.dx != null) {
        // Zone source : forme en jaune + cadre pointillé + lien vers la zone à effacer.
        var gx = (R.x + ws.dx) * sc, gy = (R.y + ws.dy) * sc;
        ctx.drawImage(ws.ghost, gx, gy, R.w * sc, R.h * sc);
        ctx.imageSmoothingEnabled = true;
        ctx.setLineDash([6 * cssPx, 5 * cssPx]);
        ctx.lineWidth = 1.5 * cssPx;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeRect(gx, gy, R.w * sc, R.h * sc);
        ctx.strokeRect(R.x * sc, R.y * sc, R.w * sc, R.h * sc);
        ctx.lineDashOffset = 5.5 * cssPx;
        ctx.strokeStyle = '#ffcd3c';
        ctx.strokeRect(gx, gy, R.w * sc, R.h * sc);
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(R.x * sc, R.y * sc, R.w * sc, R.h * sc);
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        var cx1 = (R.x + R.w / 2) * sc, cy1 = (R.y + R.h / 2) * sc;
        ctx.beginPath();
        ctx.moveTo(cx1, cy1);
        ctx.lineTo(gx + R.w * sc / 2, gy + R.h * sc / 2);
        ctx.strokeStyle = 'rgba(255,205,60,0.8)';
        ctx.lineWidth = 1.5 * cssPx;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(gx + R.w * sc / 2, gy + R.h * sc / 2, 4 * cssPx, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcd3c';
        ctx.fill();
      }
      ctx.imageSmoothingEnabled = true;
      // repère du point touché
      var mx = (ws.a.sx + 0.5) * sc, my = (ws.a.sy + 0.5) * sc;
      ctx.beginPath();
      ctx.arc(mx, my, 6 * cssPx, 0, Math.PI * 2);
      ctx.lineWidth = 3 * cssPx;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.lineWidth = 1.5 * cssPx;
      ctx.strokeStyle = '#ffffff';
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
    var vc = visibleCenter();
    var vis = toImage(vc.x, vc.y);
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
    var vc = visibleCenter();
    var p = toImage(vc.x, vc.y);
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
    var c = defaultCenter();
    var sr = stage.getBoundingClientRect(), ins = insets();
    var visH = sr.height - ins.top - ins.bottom;
    var low = toImage(sr.left + sr.width / 2, sr.top + sr.height - ins.bottom - visH * 0.15);
    var y = Math.min(state.ih * 0.92, Math.max(state.ih * 0.08, low.y));
    setPending(makeStampItem(c.x, y));
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
      // Deux doigts = déplacement / zoom de la photo, quel que soit l'outil :
      // on annule ce que le premier doigt avait commencé.
      abortSingle();
      startPinch();
    }
  }

  function abortSingle() {
    var g = gesture;
    if (!g) return;
    if (g.type === 'stroke') cancelStroke();
    if (g.type === 'wand-src' && state.wand.sel) {
      state.wand.sel.dx = g.dx0; state.wand.sel.dy = g.dy0; state.wand.sel.fast = false;
      scheduleWandRefresh();
    }
    if ((g.type === 'move' || g.type === 'handle') && state.pending) {
      if (g.created) {
        setPending(null);
      } else if (g.start) {
        var it = state.pending;
        it.x = g.start.x; it.y = g.start.y; it.size = g.start.size; it.rot = g.start.rot;
      }
    }
    state.brushPreview = null;
    requestOverlay();
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.type === 'pinch-view') {
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
    if (gesture && gesture.type === 'wand-src' && pointers.size === 0) wandSourceEnd();
    if (gesture && gesture.type === 'wand-tap' && pointers.size === 0) {
      // Un simple toucher (sans glisser ni deuxième doigt) choisit le point de départ.
      var wp = toImage(gesture.x, gesture.y);
      wandSelectAt(wp.x, wp.y);
    }
    if (pointers.size === 0) {
      if (gesture && gesture.type === 'pinch-view') resizeOverlay();
      if (gesture && gesture.type === 'handle') syncSizeSliders();
      gesture = null;
      state.brushPreview = null;
      requestOverlay();
    } else if (gesture && gesture.type === 'pinch-view' && pointers.size === 1) {
      // Fin du pincement avec un doigt encore posé : il continue de déplacer la photo,
      // mais n'active jamais l'outil.
      resizeOverlay();
      var rest = pointers.values().next().value;
      gesture = { type: 'pan', x: rest.x, y: rest.y, tx: state.view.tx, ty: state.view.ty };
    }
  }

  function startSingle(e) {
    var p = toImage(e.clientX, e.clientY);
    var k = imgPerCss();

    if (state.tool === 'blur' && state.blur.mode === 'wand') {
      if (state.wand.step === 2 && state.wand.sel) { wandSourceStart(e); return; }
      // La sélection se fait au relâchement, pour laisser place à un éventuel pincement.
      gesture = { type: 'wand-tap', x: e.clientX, y: e.clientY };
      return;
    }

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
        var start = { x: it.x, y: it.y, size: it.size, rot: it.rot };
        var corners = itemCorners(it);
        var h = corners[2];
        var dh = Math.hypot(p.x - h[0], p.y - h[1]);
        if (dh < 26 * k) {
          gesture = {
            type: 'handle', start: start,
            d0: Math.max(1, Math.hypot(p.x - it.x, p.y - it.y)),
            a0: Math.atan2(p.y - it.y, p.x - it.x),
            size0: it.size, rot0: it.rot
          };
          return;
        }
        if (hitItem(it, p, 14 * k)) {
          gesture = { type: 'move', start: start, dx: it.x - p.x, dy: it.y - p.y };
          return;
        }
        it.x = p.x; it.y = p.y;
        gesture = { type: 'move', start: start, dx: 0, dy: 0 };
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
      gesture = { type: 'move', created: true, dx: 0, dy: 0 };
      return;
    }

    // Aucun outil : un doigt fait glisser la photo si elle est zoomée.
    gesture = { type: 'pan', x: e.clientX, y: e.clientY, tx: state.view.tx, ty: state.view.ty };
  }

  function moveSingle(e) {
    var g = gesture, it = state.pending;
    if (g.type === 'wand-src') { wandSourceMove(e); return; }
    if (g.type === 'wand-tap') {
      // Le doigt glisse : ce n'est plus un toucher, on déplace la photo.
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) {
        gesture = { type: 'pan', x: e.clientX, y: e.clientY, tx: state.view.tx, ty: state.view.ty };
      }
      return;
    }
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
    } else if (g.type === 'pan') {
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
    var sr = stage.getBoundingClientRect();
    var v = state.view, f = state.fit;
    // point local (non zoomé) sous le centre des doigts
    var lx = (t.mx - sr.left - f.left - v.tx) / v.s;
    var ly = (t.my - sr.top - f.top - v.ty) / v.s;
    gesture = { type: 'pinch-view', t0: t, s0: v.s, lx: lx, ly: ly };
  }

  function movePinch() {
    if (pointers.size < 2) return;
    var t = twoPointers(), g = gesture;
    if (g.type === 'pinch-view') {
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
    if (state.wand.sel) wandApply();
    state.tool = state.tool === t ? null : t;
    toolButtons.forEach(function (b) { b.classList.toggle('is-active', b.dataset.tool === state.tool); });
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== state.tool; });
    panel.classList.toggle('is-open', !!state.tool);
    if (state.tool === 'stamp') {
      ensureStampPending();
      if (!state.stamp.text.trim()) setTimeout(function () { $('#stamp-text').focus(); }, 50);
    }
    if (state.tool === 'blur' && state.blur.mode !== 'wand') setTimeout(flashBrush, 60);
  }

  // « Appliquer » : on fixe l'élément sur la photo puis on referme l'outil.
  document.querySelectorAll('[data-action="apply"]').forEach(function (b) {
    b.addEventListener('click', function () {
      commitPending();
      if (state.tool) selectTool(state.tool);
    });
  });
  document.querySelectorAll('[data-action="discard"]').forEach(function (b) {
    b.addEventListener('click', discardPending);
  });

  // Flou
  document.querySelectorAll('[data-blur-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (state.wand.sel) wandDiscard();
      state.blur.mode = b.dataset.blurMode;
      document.querySelectorAll('[data-blur-mode]').forEach(function (x) {
        x.setAttribute('aria-checked', String(x === b));
      });
      var wand = state.blur.mode === 'wand';
      document.querySelector('[data-blur-opts="brush"]').hidden = wand;
      document.querySelector('[data-blur-opts="wand"]').hidden = !wand;
      $('#blur-hint').textContent = wand
        ? 'Touchez la zone à effacer'
        : 'Touchez ou glissez le doigt sur la photo';
      if (!wand) flashBrush();
    });
  });

  // ---------- Baguette magique : interface ----------
  // Étape 1 « Zone » : on touche la zone à effacer, on règle tolérance / élargissement.
  // Étape 2 « Source » : on fait glisser le doigt pour déplacer la zone source dont
  // la texture sera copiée ; le résultat s'affiche en direct.
  var wandTol = $('#wand-tol'), wandTolOut = $('#wand-tol-out');
  var wandGrow = $('#wand-grow'), wandGrowOut = $('#wand-grow-out');
  var wandRaf = 0;

  wandTol.value = state.wand.tol;
  wandTolOut.textContent = (state.wand.tol / WAND_LEVELS).toFixed(2);
  wandTol.addEventListener('input', function () {
    state.wand.tol = parseInt(wandTol.value, 10);
    wandTolOut.textContent = (state.wand.tol / WAND_LEVELS).toFixed(2);
    scheduleWandRefresh();
  });
  wandGrow.value = state.wand.grow;
  wandGrowOut.textContent = state.wand.grow + ' px';
  wandGrow.addEventListener('input', function () {
    state.wand.grow = parseInt(wandGrow.value, 10);
    wandGrowOut.textContent = state.wand.grow + ' px';
    scheduleWandRefresh();
  });

  var wandMatch = $('#wand-match'), wandMatchOut = $('#wand-match-out');
  wandMatch.value = state.wand.match;
  wandMatchOut.textContent = state.wand.match + ' %';
  wandMatch.addEventListener('input', function () {
    state.wand.match = parseInt(wandMatch.value, 10);
    wandMatchOut.textContent = state.wand.match + ' %';
    scheduleWandRefresh();
  });

  document.querySelectorAll('[data-wand-step]').forEach(function (b) {
    b.addEventListener('click', function () { wandSetStep(parseInt(b.dataset.wandStep, 10)); });
  });
  $('#wand-next').addEventListener('click', function () { wandSetStep(2); });
  $('#wand-apply').addEventListener('click', wandApply);
  $('#wand-discard').addEventListener('click', wandDiscard);

  function wandSetStep(step) {
    if (step === 2 && !state.wand.sel) return;
    state.wand.step = step;
    document.querySelectorAll('[data-wand-step]').forEach(function (x) {
      x.setAttribute('aria-checked', String(parseInt(x.dataset.wandStep, 10) === step));
    });
    document.querySelectorAll('[data-wand-pane]').forEach(function (p) {
      p.hidden = parseInt(p.dataset.wandPane, 10) !== step;
    });
    $('#wand-next').hidden = step !== 1;
    $('#wand-apply').hidden = step !== 2;
    $('#blur-hint').textContent = step === 1 ? 'Touchez la zone à effacer' : 'Choisissez la zone source';
    if (step === 2) {
      var sel = state.wand.sel;
      wandEnsureRegion();
      // Source par défaut juste à côté ; on garde celle choisie si elle reste valable.
      if (sel.dx == null) {
        var o = wandDefaultOffset(sel.a, sel.reg);
        sel.dx = o.dx; sel.dy = o.dy;
      }
    }
    scheduleWandRefresh();
  }

  function wandUpdateUI() {
    var sel = state.wand.sel;
    $('#wand-actions').hidden = !sel;
    document.querySelector('[data-wand-step="2"]').disabled = !sel;
    if (!sel) {
      $('#wand-count').textContent = '';
      if (state.wand.step !== 1) wandSetStep(1);
    }
  }

  function wandSelectAt(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= photo.width || y >= photo.height) return;
    var a = wandAnalyze(pctx.getImageData(0, 0, photo.width, photo.height), x, y, state.wand.tol);
    var old = state.wand.sel;
    state.wand.sel = {
      a: a, reg: null, preview: old ? old.preview : null, ghost: old ? old.ghost : null,
      dx: null, dy: null
    };
    wandUpdateUI();
    updateHistoryUI();
    wandRefresh();
  }

  // (Re)calcule la zone sélectionnée si la tolérance ou l'élargissement ont changé.
  function wandEnsureRegion() {
    var sel = state.wand.sel;
    if (sel.reg && sel.reg.T === state.wand.tol && sel.reg.grow === state.wand.grow) return false;
    sel.reg = wandRegion(sel.a, state.wand.tol, state.wand.grow);
    // « Fantôme » de la zone source : la forme de la sélection, en jaune translucide.
    var reg = sel.reg, gd = new Uint8ClampedArray(reg.w * reg.h * 4);
    for (var i = 0; i < reg.list.length; i++) {
      var j = reg.list[i] * 4;
      gd[j] = 255; gd[j + 1] = 205; gd[j + 2] = 60; gd[j + 3] = 120;
    }
    var g = sel.ghost || document.createElement('canvas');
    if (g.width !== reg.w || g.height !== reg.h) { g.width = reg.w; g.height = reg.h; }
    g.getContext('2d').putImageData(new ImageData(gd, reg.w, reg.h), 0, 0);
    sel.ghost = g;
    return true;
  }

  function scheduleWandRefresh() {
    if (wandRaf || !state.wand.sel) return;
    wandRaf = requestAnimationFrame(function () { wandRaf = 0; wandRefresh(); });
  }

  // Met à jour l'aperçu : sélection teintée en bleu (étape 1) ou résultat (étape 2).
  function wandRefresh() {
    var sel = state.wand.sel;
    if (!sel) return;
    wandEnsureRegion();
    var reg = sel.reg, shown;
    sel.result = null;
    if (state.wand.step === 2) {
      var res = wandFill(sel.a, reg, state.wand.method, {
        dx: sel.dx, dy: sel.dy, seed: sel.a.seed, match: state.wand.match / 100, fast: !!sel.fast
      });
      res.fast = !!sel.fast;
      sel.result = res;
      shown = res.data;
      var hint = $('#wand-src-hint');
      var bad = res.info && res.info.overlap > 0.02;
      hint.classList.toggle('is-warning', !!bad);
      hint.textContent = bad
        ? 'La source (en jaune) touche la zone à effacer : éloignez-la un peu.'
        : 'Glissez le doigt sur la photo pour déplacer la zone source (en jaune), ou touchez une zone de peau propre.';
    } else {
      shown = reg.data.slice();
      for (var i = 0; i < reg.list.length; i++) {
        var j = reg.list[i] * 4;
        shown[j] = shown[j] * 0.4 + 40 * 0.6;
        shown[j + 1] = shown[j + 1] * 0.4 + 150 * 0.6;
        shown[j + 2] = shown[j + 2] * 0.4 + 255 * 0.6;
      }
    }
    var c = sel.preview || document.createElement('canvas');
    if (c.width !== reg.w || c.height !== reg.h) { c.width = reg.w; c.height = reg.h; }
    c.getContext('2d').putImageData(new ImageData(shown, reg.w, reg.h), 0, 0);
    sel.preview = c;
    $('#wand-count').textContent = formatCount(reg.count) + ' px';
    requestOverlay();
  }

  // Gestes de l'étape 2 : glisser = déplacer la source (relatif, le doigt peut être
  // n'importe où) ; simple toucher = centrer la source à cet endroit.
  function wandSourceStart(e) {
    var sel = state.wand.sel;
    gesture = { type: 'wand-src', x: e.clientX, y: e.clientY, dx0: sel.dx, dy0: sel.dy, moved: false };
  }
  function wandSourceMove(e) {
    var g = gesture, sel = state.wand.sel;
    if (!sel) return;
    var mx = e.clientX - g.x, my = e.clientY - g.y;
    if (!g.moved && Math.hypot(mx, my) < 8) return;
    g.moved = true;
    sel.fast = true; // aperçu allégé pendant le geste
    var k = imgPerCss();
    sel.dx = Math.round(g.dx0 + mx * k);
    sel.dy = Math.round(g.dy0 + my * k);
    scheduleWandRefresh();
  }
  function wandSourceEnd() {
    var g = gesture, sel = state.wand.sel;
    if (!sel) return;
    sel.fast = false; // doigt levé : calcul complet
    if (g.moved) { scheduleWandRefresh(); return; }
    var p = toImage(g.x, g.y), reg = sel.reg;
    sel.dx = Math.round(p.x - (reg.x + reg.w / 2));
    sel.dy = Math.round(p.y - (reg.y + reg.h / 2));
    scheduleWandRefresh();
  }

  function wandApply() {
    var sel = state.wand.sel;
    if (!sel) return;
    if (state.wand.step !== 2) { wandSetStep(2); return; } // il faut d'abord voir la source
    // on applique toujours le calcul complet (jamais l'aperçu allégé)
    if (!sel.result || sel.result.fast) { sel.fast = false; wandRefresh(); }
    var reg = sel.reg, res = sel.result;
    if (res && res.info) {
      pctx.putImageData(new ImageData(res.data, reg.w, reg.h), reg.x, reg.y);
      pushOp({
        type: 'wand', x: sel.a.sx, y: sel.a.sy, tol: state.wand.tol, grow: state.wand.grow,
        method: state.wand.method, dx: sel.dx, dy: sel.dy, match: state.wand.match / 100
      });
      toast('Zone corrigée');
    } else {
      toast('Rien à remplir');
    }
    wandClear();
  }

  function wandDiscard() {
    wandClear();
  }

  function wandClear() {
    var sel = state.wand.sel;
    if (sel) { freeCanvas(sel.preview); freeCanvas(sel.ghost); }
    state.wand.sel = null;
    wandUpdateUI();
    updateHistoryUI();
    requestOverlay();
  }

  function formatCount(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
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
    if (state.wand.sel) wandApply();
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
  layout();
})();
