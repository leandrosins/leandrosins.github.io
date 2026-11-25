/* Enigme-moi sur le visage : moteur de brouillage réversible. 100 % local.
 *
 * La photo est découpée en anneaux concentriques, comme une toupie.
 * Le code secret décide, de façon déterministe, de l'épaisseur de chaque
 * anneau et de l'angle dont il tourne (de plus en plus vers le centre : un
 * siphon). Chaque anneau tourne d'un bloc, sans être déformé : on le remet
 * en place en le tournant dans l'autre sens, presque sans perte.
 *
 * Une toupie est un disque inscrit dans la photo. Sur une photo allongée,
 * deux autres toupies brouillent les deux bouts ; ce qui reste dans les coins
 * est retourné par symétrie (demi-tour, miroirs), qui garde le cadre.
 * Les couleurs sont en plus permutées (et parfois inversées).
 *
 * Tout est relatif à la taille de la photo : une image brouillée,
 * recompressée ou réduite par une messagerie se décode quand même
 * (mais pas recadrée). Ce n'est pas du chiffrement : c'est un brouillage.
 */
(function (root) {
  'use strict';

  // ---------- Code → paramètres ----------
  function hash(str) {
    // FNV-1a puis mélange final : deux codes voisins donnent des valeurs sans rapport
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  var BINS = 2048;

  // Une toupie : n anneaux d'épaisseurs tirées au sort sur [0..1] (1 = bord du disque),
  // angle fort au centre et faible au bord, un anneau sur deux à contre-sens.
  function top(r, n, power) {
    var spin = r() < 0.5 ? -1 : 1, wts = [], sum = 0, i;
    for (i = 0; i < n; i++) { wts.push(0.6 + r()); sum += wts[i]; }
    var edges = [0], acc = 0, angles = [];
    for (i = 0; i < n; i++) { acc += wts[i] / sum; edges.push(i === n - 1 ? 1 : acc); }
    for (i = 0; i < n; i++) {
      var mid = (edges[i] + edges[i + 1]) / 2;
      var a = spin * Math.PI * (0.5 + power * Math.pow(1 - mid, 1.5)) + (r() - 0.5) * 1.2;
      angles.push(i % 2 ? -a * 0.6 : a);
    }
    // table rayon → anneau, pour ne pas chercher à chaque pixel
    var table = new Uint8Array(BINS);
    for (var b = 0, k = 0; b < BINS; b++) { while (b / BINS >= edges[k + 1]) k++; table[b] = k; }
    return { table: table, edges: edges, cos: angles.map(Math.cos), sin: angles.map(Math.sin) };
  }

  function params(key) {
    var r = rng(hash('siphon:' + key));
    var P = { main: top(r, 22, 5), ends: [top(r, 14, 4), top(r, 14, 4)], ops: [] };
    for (var i = 0; i < 6; i++) P.ops.push(1 + Math.floor(r() * 3)); // 1 demi-tour, 2 miroir ↔, 3 miroir ↕
    var c = 1 + Math.floor(r() * 11); // jamais l'identité
    P.perm = PERMS[c % 6];
    P.invert = c >= 6;
    return P;
  }

  // ---------- Lecture interpolée ----------
  // Catmull-Rom : plus net que le bilinéaire.
  var WX = [0, 0, 0, 0], WY = [0, 0, 0, 0];
  function cubic(t, o) {
    var t2 = t * t, t3 = t2 * t;
    o[0] = -0.5 * t3 + t2 - 0.5 * t;
    o[1] = 1.5 * t3 - 2.5 * t2 + 1;
    o[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
    o[3] = 0.5 * t3 - 0.5 * t2;
  }
  function ringAt(T, q) { return q < 1 ? T.table[q * BINS | 0] : -1; }

  // (x, y) continus, centres de pixels en +0.5. Si ring ≥ 0, on ne garde que
  // les pixels du même anneau : deux anneaux voisins ne vont pas ensemble.
  function sample(d, w, h, x, y, out, T, cx, cy, u, ring) {
    x -= 0.5; y -= 0.5;
    var x0 = Math.floor(x), y0 = Math.floor(y), r = 0, g = 0, b = 0, sum = 0;
    cubic(x - x0, WX); cubic(y - y0, WY);
    for (var j = 0; j < 4; j++) {
      var py = Math.min(h - 1, Math.max(0, y0 - 1 + j)), dy = (py + 0.5 - cy) / u;
      for (var i = 0; i < 4; i++) {
        var px = Math.min(w - 1, Math.max(0, x0 - 1 + i));
        if (ring >= 0) {
          var dx = (px + 0.5 - cx) / u;
          if (ringAt(T, Math.sqrt(dx * dx + dy * dy)) !== ring) continue;
        }
        var o = (py * w + px) * 4, k = WX[i] * WY[j];
        r += d[o] * k; g += d[o + 1] * k; b += d[o + 2] * k; sum += k;
      }
    }
    if (sum < 0.4) { // voisinage presque entièrement ailleurs : pixel le plus proche
      var n = (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4;
      out[0] = d[n]; out[1] = d[n + 1]; out[2] = d[n + 2];
      return;
    }
    out[0] = r / sum; out[1] = g / sum; out[2] = b / sum;
  }

  // ---------- Étapes ----------
  // Toupie de centre (cx, cy) et de rayon u : brouiller lit l'entrée en R⁻¹·p,
  // décoder lit en R·p (dans le même anneau seulement).
  // En décodage, la recompression JPEG a sali les bords de chaque anneau
  // (cassure nette dans l'image brouillée) : on lit à SEAM pixels des bords,
  // un décalage invisible plutôt qu'un fin liseré coloré.
  var SEAM = 2;
  function spinTop(src, dst, w, h, T, cx, cy, u, decode) {
    var dir = decode ? 1 : -1, c = [0, 0, 0], m = SEAM / u, E = T.edges;
    var y0 = Math.max(0, Math.floor(cy - u)), y1 = Math.min(h, Math.ceil(cy + u));
    var x0 = Math.max(0, Math.floor(cx - u)), x1 = Math.min(w, Math.ceil(cx + u));
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var px = x + 0.5 - cx, py = y + 0.5 - cy, ring = ringAt(T, Math.sqrt(px * px + py * py) / u);
        if (ring < 0) continue;
        var s = dir * T.sin[ring], co = T.cos[ring], o = (y * w + x) * 4, k = 1;
        if (decode) {
          var q = Math.sqrt(px * px + py * py) / u, lo = E[ring] > 0 ? E[ring] + m : 0, hi = E[ring + 1] - m;
          var qq = lo > hi ? (E[ring] + E[ring + 1]) / 2 : Math.min(hi, Math.max(lo, q));
          if (q > 0) k = qq / q;
        }
        sample(src, w, h, cx + (px * co - py * s) * k, cy + (px * s + py * co) * k, c, T, cx, cy, u, decode ? ring : -1);
        dst[o] = c[0]; dst[o + 1] = c[1]; dst[o + 2] = c[2];
      }
    }
  }

  // Hors du disque central : anneaux retournés par symétrie. Exact et involutif.
  function flipCorners(src, dst, w, h, ops, u) {
    var cx = w / 2, cy = h / 2, step = (Math.hypot(w, h) / 2 / u - 1) / ops.length + 1e-9;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var q = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / u;
        if (q < 1) continue;
        var op = ops[Math.min(ops.length - 1, (q - 1) / step | 0)];
        var sx = op !== 3 ? w - 1 - x : x, sy = op !== 2 ? h - 1 - y : y;
        var o = (y * w + x) * 4, n = (sy * w + sx) * 4;
        dst[o] = src[n]; dst[o + 1] = src[n + 1]; dst[o + 2] = src[n + 2];
      }
    }
  }

  function colors(d, P, decode) {
    var v = [0, 0, 0], c = [0, 0, 0], perm = P.perm, inv = P.invert;
    for (var o = 0; o < d.length; o += 4) {
      c[0] = d[o]; c[1] = d[o + 1]; c[2] = d[o + 2];
      for (var i = 0; i < 3; i++) {
        if (decode) v[perm[i]] = inv ? 255 - c[i] : c[i];
        else v[i] = inv ? 255 - c[perm[i]] : c[perm[i]];
      }
      d[o] = v[0]; d[o + 1] = v[1]; d[o + 2] = v[2]; d[o + 3] = 255;
    }
  }

  // decode = false : brouiller ; true : retrouver la photo. onStep(i, n) : progression.
  function process(src, key, decode, onStep) {
    var w = src.w, h = src.h, P = params(key), u = Math.min(w, h) / 2;
    var stages = [function (a, b) { flipCorners(a, b, w, h, P.ops, u); }];
    stages.push(function (a, b, dec) { spinTop(a, b, w, h, P.main, w / 2, h / 2, u, dec); });
    // photo allongée : une toupie à chaque bout, collée au bord
    if (Math.max(w, h) > 1.15 * Math.min(w, h)) {
      [u, Math.max(w, h) - u].forEach(function (c, k) {
        stages.push(function (a, b, dec) {
          if (w > h) spinTop(a, b, w, h, P.ends[k], c, h / 2, u, dec);
          else spinTop(a, b, w, h, P.ends[k], w / 2, c, u, dec);
        });
      });
    }
    if (decode) stages.reverse();

    var cur = new Uint8ClampedArray(src.data), next = new Uint8ClampedArray(cur.length), t;
    if (decode) colors(cur, P, true);
    for (var i = 0; i < stages.length; i++) {
      next.set(cur);
      stages[i](cur, next, decode);
      t = cur; cur = next; next = t;
      if (onStep) onStep(i + 1, stages.length);
    }
    if (!decode) colors(cur, P, false);
    return cur;
  }

  root.SecretEngine = { process: process };
})(typeof self !== 'undefined' ? self : this);
