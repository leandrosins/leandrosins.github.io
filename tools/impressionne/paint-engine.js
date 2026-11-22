/* Impressionne-moi le corps : moteur de peinture par coups de pinceau, écrit à la main (aucune dépendance).
 *
 *   PaintEngine.paint({ data, w, h }, { abstraction, focus, seed }, onLayer) → { data, w, h, strokes }
 *
 * 1. analyse (en réduction) : sujet, sens des formes, palette chaud / froid ;
 * 2. sous-couche terre, puis 5 passes du couteau large au pinceau fin ;
 * 3. chaque passe n'est autorisée que là où le niveau de finesse le permet
 *    (sujet, points touchés du doigt), d'où la dissolution vers les bords ;
 * 4. chaque touche dépose aussi une épaisseur, éclairée à la fin (empâtement + toile).
 */
(function (root) {
  'use strict';

  var ANALYSIS_SIDE = 800;

  // r = demi-largeur (fraction du grand côté), need = finesse requise, err = écart minimal pour repeindre
  var LAYERS = [
    { r: 0.034,  len: 4.5, need: 0,    err: 0,  wet: 0.10, jitter: 12,  thick: 0.75, knife: true },
    { r: 0.018,  len: 6,   need: 0,    err: 20, wet: 0.16, jitter: 10,  thick: 0.85, knife: true },
    { r: 0.009,  len: 7,   need: 0.25, err: 13, wet: 0.14, jitter: 6,   thick: 0.65 },
    { r: 0.0045, len: 8,   need: 0.52, err: 12, wet: 0.10, jitter: 4,   thick: 0.45 },
    { r: 0.0023, len: 8,   need: 0.80, err: 12, wet: 0.05, jitter: 2.5, thick: 0.35 }
  ];

  // ---------- Outils ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  function colorDist(r, g, b, R, G, B) {
    var dr = r - R, dg = g - G, db = b - B;
    return Math.sqrt((3 * dr * dr + 4 * dg * dg + 2 * db * db) / 9) * 1.732;
  }

  function random(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(x, y, seed) {
    var h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    fx *= fx * (3 - 2 * fx); fy *= fy * (3 - 2 * fy);
    return mix(mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), fx),
               mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), fx), fy);
  }

  // Flou ≈ gaussien : 3 passes de moyenne glissante horizontale + verticale
  function blur(src, w, h, sigma) {
    var out = new Float32Array(src);
    var r = Math.round(sigma);
    if (r < 1) return out;
    var tmp = new Float32Array(src.length), d = 2 * r + 1, x, y, s;
    for (var pass = 0; pass < 3; pass++) {
      for (y = 0; y < h; y++) {
        var row = y * w;
        s = 0;
        for (x = -r; x <= r; x++) s += out[row + clamp(x, 0, w - 1)];
        for (x = 0; x < w; x++) {
          tmp[row + x] = s / d;
          s += out[row + Math.min(w - 1, x + r + 1)] - out[row + Math.max(0, x - r)];
        }
      }
      for (x = 0; x < w; x++) {
        s = 0;
        for (y = -r; y <= r; y++) s += tmp[clamp(y, 0, h - 1) * w + x];
        for (y = 0; y < h; y++) {
          out[y * w + x] = s / d;
          s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
        }
      }
    }
    return out;
  }

  function reduce(src, w, h) {
    var R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
    var n = new Float32Array(w * h), d = src.data;
    for (var y = 0; y < src.h; y++) {
      var row = Math.min(h - 1, Math.floor(y * h / src.h)) * w;
      for (var x = 0; x < src.w; x++) {
        var i = row + Math.min(w - 1, Math.floor(x * w / src.w)), j = (y * src.w + x) * 4;
        R[i] += d[j]; G[i] += d[j + 1]; B[i] += d[j + 2]; n[i]++;
      }
    }
    for (var k = 0; k < n.length; k++) { var c = n[k] || 1; R[k] /= c; G[k] /= c; B[k] /= c; }
    return [R, G, B];
  }

  // ---------- Analyse ----------
  // Sujet probable : ce qui diffère des couleurs du pourtour (haut + moitié haute des côtés,
  // car le sujet touche souvent le bas de l'image), avec une préférence pour le centre.
  function findSubject(rgb, w, h, long, rand) {
    var b = rgb.map(function (p) { return blur(p, w, h, long * 0.006); });
    var samples = [], x, y, i, k;
    function take(i) { samples.push([b[0][i], b[1][i], b[2][i]]); }
    for (x = 0; x < w; x += 4) { take(2 * w + x); take(Math.floor(h * 0.06) * w + x); }
    for (y = 0; y < h * 0.5; y += 4) { take(y * w + 2); take(y * w + w - 3); }

    var centres = [];
    for (k = 0; k < 4; k++) centres.push(samples[Math.floor(rand() * samples.length)].slice());
    for (var it = 0; it < 8; it++) {
      var sum = centres.map(function () { return [0, 0, 0, 0]; });
      samples.forEach(function (s) {
        var best = 0, bd = Infinity;
        centres.forEach(function (c, j) {
          var v = colorDist(s[0], s[1], s[2], c[0], c[1], c[2]);
          if (v < bd) { bd = v; best = j; }
        });
        var t = sum[best];
        t[0] += s[0]; t[1] += s[1]; t[2] += s[2]; t[3]++;
      });
      sum.forEach(function (t, j) { if (t[3]) centres[j] = [t[0] / t[3], t[1] / t[3], t[2] / t[3]]; });
    }

    var m = new Float32Array(w * h);
    for (y = 0, i = 0; y < h; y++) {
      for (x = 0; x < w; x++, i++) {
        var near = Infinity;
        for (k = 0; k < centres.length; k++) {
          near = Math.min(near, colorDist(b[0][i], b[1][i], b[2][i], centres[k][0], centres[k][1], centres[k][2]));
        }
        var u = (x / w - 0.52) / 0.62, v = (y / h - 0.52) / 0.68;
        m[i] = smooth(25, 130, near * Math.exp(-(u * u + v * v) * 0.6));
      }
    }
    return blur(m, w, h, long * 0.008);
  }

  // Sens des touches : tenseur de structure multi-échelle, en angle double (cos 2θ, sin 2θ).
  function findFlow(L, w, h, long, seed) {
    var A = new Float32Array(w * h), B = new Float32Array(w * h), E = new Float32Array(w * h);
    var S = blur(L, w, h, 1), x, y, i;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        var gx = (3 * (S[i - w + 1] - S[i - w - 1]) + 10 * (S[i + 1] - S[i - 1]) + 3 * (S[i + w + 1] - S[i + w - 1])) / 32;
        var gy = (3 * (S[i + w - 1] - S[i - w - 1]) + 10 * (S[i + w] - S[i - w]) + 3 * (S[i + w + 1] - S[i - w + 1])) / 32;
        A[i] = gx * gx - gy * gy; B[i] = 2 * gx * gy; E[i] = gx * gx + gy * gy;
      }
    }
    var cos = new Float32Array(w * h), sin = new Float32Array(w * h);
    [[0.003, 1], [0.012, 0.8], [0.04, 0.7]].forEach(function (scale) {
      var s = long * scale[0], a = blur(A, w, h, s), b = blur(B, w, h, s), e = blur(E, w, h, s);
      for (var j = 0; j < a.length; j++) {
        var q = scale[1] / (e[j] + 3);
        cos[j] -= a[j] * q; sin[j] -= b[j] * q; // signe − : le long du contour, pas en travers
      }
    });
    // dans les aplats : un geste en diagonale qui ondule lentement
    for (y = 0, i = 0; y < h; y++) {
      for (x = 0; x < w; x++, i++) {
        var base = -0.65 + (noise(x / long * 2.5, y / long * 2.5, seed) - 0.5) * 1.4;
        cos[i] += Math.cos(2 * base) * 0.22; sin[i] += Math.sin(2 * base) * 0.22;
      }
    }
    return { cos: cos, sin: sin };
  }

  function analyse(src, opts) {
    var long = Math.min(ANALYSIS_SIDE, Math.max(src.w, src.h));
    var k = long / Math.max(src.w, src.h);
    var w = Math.max(8, Math.round(src.w * k)), h = Math.max(8, Math.round(src.h * k)), n = w * h;
    var rgb = reduce(src, w, h), R = rgb[0], G = rgb[1], B = rgb[2];
    var subject = findSubject(rgb, w, h, long, random(opts.seed));
    var L = new Float32Array(n), i, x, y, a = opts.abstraction;
    for (i = 0; i < n; i++) L[i] = lum(R[i], G[i], B[i]);
    var flow = findFlow(L, w, h, long, opts.seed);

    var detail = new Float32Array(n), focus = new Float32Array(n), border = new Float32Array(n);
    opts.focus.forEach(function (f) {
      var fx = f.x * w, fy = f.y * h, fr = Math.max(2, f.r * long);
      for (var yy = Math.max(0, Math.floor(fy - fr)); yy < Math.min(h, fy + fr); yy++) {
        for (var xx = Math.max(0, Math.floor(fx - fr)); xx < Math.min(w, fx + fr); xx++) {
          var v = 1 - smooth(0.55, 1, Math.hypot(xx - fx, yy - fy) / fr);
          focus[yy * w + xx] = Math.max(focus[yy * w + xx], v);
        }
      }
    });
    for (y = 0, i = 0; y < h; y++) {
      for (x = 0; x < w; x++, i++) {
        var edge = Math.min(x, y, w - 1 - x, h - 1 - y) / long + (noise(x / long * 14, y / long * 14, opts.seed + 7) - 0.5) * 0.09;
        border[i] = smooth(-0.01, 0.05 + 0.13 * a, edge);
        var form = smooth(0.02, 0.62, subject[i]); // un peu plus large que le sujet : silhouette nette
      detail[i] = Math.max(clamp(form * border[i] * (1.22 - 0.85 * a), 0, 1), focus[i]);
      }
    }

    // Couleur
    //  - sujet : contraste, lumières ocre / ombres froides ;
    //  - fond : SA propre couleur, seulement éclaircie dans les ombres. La luminosité monte en
    //    multipliant R, V, B ensemble : ajouter du blanc ou du gris éteindrait la teinte.
    var outside = new Float32Array(n), lift = mix(0.78, 0.68, a);
    for (i = 0; i < n; i++) {
      var r0 = R[i], g0 = G[i], b0 = B[i];
      var l = L[i] / 255, c = l + (l * l * (3 - 2 * l) - l) * 0.35;
      var gain = l > 0.01 ? c / l : 1;
      var r = r0 * gain, g = g0 * gain, b = b0 * gain;
      var hi = smooth(0.4, 0.9, l), lo = 1 - smooth(0.1, 0.5, l);
      r += 7 * hi - 5 * lo; g += 3 * hi + 2 * lo; b += -8 * hi + 12 * lo;

      var target = 255 * Math.pow(l, lift), up = target / Math.max(1, L[i]);
      var top = Math.max(r0, g0, b0);
      if (top * up > 250) up = Math.max(1, 250 / top); // sans écrêter un canal (la teinte virerait)
      var away = 1 - smooth(0, 0.75, Math.max(subject[i], focus[i]));
      outside[i] = away;
      R[i] = clamp(mix(r, mix(r0 * up, target, 0.08) + 3, away), 0, 255);
      G[i] = clamp(mix(g, mix(g0 * up, target, 0.08) + 3, away), 0, 255);
      B[i] = clamp(mix(b, mix(b0 * up, target, 0.08) + 3, away), 0, 255);
    }
    return {
      w: w, h: h, long: long, rgb: [R, G, B], outside: outside,
      detail: detail, focus: focus, border: border, flow: flow
    };
  }

  // ---------- Toile et touches ----------
  function Surface(w, h) {
    var n = w * h;
    this.w = w; this.h = h;
    this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n);
    this.height = new Float32Array(n);
    // tampons de travail d'une touche
    this.near = new Float32Array(n).fill(Infinity);
    this.across = new Float32Array(n); this.along = new Float32Array(n);
    this.touched = new Int32Array(n);
    this.bristle = new Float32Array(25);
  }

  // Sous-couche : terre sous le sujet, imprégnée de la couleur locale sous le fond.
  Surface.prototype.prime = function (info, seed) {
    var long = Math.max(this.w, this.h);
    var local = info.rgb.map(function (p) { return blur(p, info.w, info.h, info.long * 0.02); });
    for (var y = 0, i = 0; y < this.h; y++) {
      for (var x = 0; x < this.w; x++, i++) {
        var t = noise(x / long * 18, y / long * 18, seed + 3) - 0.5;
        var j = Math.floor(y * info.h / this.h) * info.w + Math.floor(x * info.w / this.w);
        var soak = info.outside[j] * 0.85, shade = 1.12 + t * 0.3;
        this.r[i] = mix(128 + t * 34, local[0][j] * shade, soak);
        this.g[i] = mix(94 + t * 28, local[1][j] * shade, soak);
        this.b[i] = mix(70 + t * 24, local[2][j] * shade, soak);
      }
    }
  };

  // pts = [x0, y0, x1, y1…] en pixels de la toile ; c0 → c1 = couleur le long de la touche
  Surface.prototype.stroke = function (pts, radius, c0, c1, layer, rand) {
    var w = this.w, h = this.h, near = this.near, across = this.across, along = this.along, list = this.touched;
    var count = 0, total = 0, s, i;
    for (s = 0; s + 3 < pts.length; s += 2) {
      var ax = pts[s], ay = pts[s + 1], dx = pts[s + 2] - ax, dy = pts[s + 3] - ay;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.01) continue;
      var ux = dx / len, uy = dy / len;
      var x0 = Math.max(0, Math.floor(Math.min(ax, ax + dx) - radius)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, ax + dx) + radius));
      var y0 = Math.max(0, Math.floor(Math.min(ay, ay + dy) - radius)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, ay + dy) + radius));
      for (var y = y0; y <= y1; y++) {
        var py = y - ay;
        for (var x = x0; x <= x1; x++) {
          var px = x - ax, t = px * ux + py * uy, v = py * ux - px * uy;
          var over = t < 0 ? -t : t > len ? t - len : 0, d = v * v + over * over;
          if (d > radius * radius) continue;
          i = y * w + x;
          if (d >= near[i]) continue;
          if (near[i] === Infinity) list[count++] = i;
          near[i] = d; across[i] = v; along[i] = total + t;
        }
      }
      total += len;
    }
    if (!count) return;

    var bristle = this.bristle, last = bristle.length - 1, prev = rand();
    for (i = 0; i <= last; i++) { prev = prev * 0.35 + rand() * 0.65; bristle[i] = prev; }
    var knife = layer.knife, streak = knife ? 12 : 8, span = total + 2 * radius;

    for (var k = 0; k < count; k++) {
      i = list[k];
      var side = across[i] / radius, dist = Math.sqrt(near[i]) / radius;
      near[i] = Infinity;
      var f = clamp((side + 1) / 2, 0, 1) * last, f0 = Math.floor(f);
      var hair = mix(bristle[f0], bristle[Math.min(last, f0 + 1)], f - f0);
      var pos = clamp((along[i] + radius) / span, 0, 1);
      // bords irréguliers, attaque franche, fin de touche sèche où les poils se séparent
      var alpha = clamp(((knife ? 1 : 0.86 + 0.14 * hair) - dist) * radius, 0, 1);
      alpha *= clamp((pos - hair * 0.07) * 30, 0, 1);
      if (pos > 0.68) alpha *= clamp((hair + 0.22 - (pos - 0.68) / 0.32 * 0.85) * 6, 0, 1);
      if (alpha <= 0) continue;
      var shade = (hair - 0.5) * streak;
      this.r[i] += (mix(c0[0], c1[0], pos) + shade - this.r[i]) * alpha;
      this.g[i] += (mix(c0[1], c1[1], pos) + shade - this.g[i]) * alpha;
      this.b[i] += (mix(c0[2], c1[2], pos) + shade - this.b[i]) * alpha;
      var ridge = knife ? smooth(0.6, 0.95, Math.abs(side)) * 0.5 : 0;
      var depth = layer.thick * (0.45 + 0.55 * hair + ridge) * (1 - 0.3 * pos);
      this.height[i] += (depth - this.height[i]) * alpha;
    }
  };

  // Rendu final : empâtement éclairé du haut-gauche + trame de toile là où la peinture est mince
  Surface.prototype.finish = function (light, seed) {
    var w = this.w, h = this.h, H = this.height, out = new Uint8ClampedArray(w * h * 4);
    var unit = Math.max(w, h) / 1600, period = Math.max(2.5, 4.2 * unit);
    var weaveX = new Float32Array(w), weaveY = new Float32Array(h), x, y;
    for (x = 0; x < w; x++) weaveX[x] = Math.sin(x / period * 2 * Math.PI + noise(x / 40, 1, seed) * 3);
    for (y = 0; y < h; y++) weaveY[y] = Math.sin(y / period * 2 * Math.PI + noise(1, y / 40, seed) * 3);
    for (y = 0; y < h; y++) {
      var up = y ? -w : 0, down = y < h - 1 ? w : 0;
      for (x = 0; x < w; x++) {
        var i = y * w + x;
        var gx = H[x < w - 1 ? i + 1 : i] - H[x ? i - 1 : i], gy = H[i + down] - H[i + up];
        var relief = clamp((gx * 0.6 + gy * 0.8) * 0.2 * light * unit, -0.16, 0.2);
        var grain = weaveX[x] * weaveY[y] * 0.024 * (1 - Math.min(0.85, H[i]));
        var k = 1 + relief + grain, shine = Math.max(0, relief) * 45, o = i * 4;
        out[o] = this.r[i] * k + shine; out[o + 1] = this.g[i] * k + shine; out[o + 2] = this.b[i] * k + shine;
        out[o + 3] = 255;
      }
    }
    return out;
  };

  Surface.prototype.snapshot = function () {
    var out = new Uint8ClampedArray(this.w * this.h * 4);
    for (var i = 0, o = 0; i < this.r.length; i++, o += 4) {
      out[o] = this.r[i]; out[o + 1] = this.g[i]; out[o + 2] = this.b[i]; out[o + 3] = 255;
    }
    return out;
  };

  // ---------- Une passe ----------
  function paintLayer(surface, info, index, opts) {
    var layer = LAYERS[index], a = opts.abstraction, w = info.w, h = info.h;
    var rand = random(opts.seed * 31 + index * 1009);
    var scale = index < 3 ? mix(0.7, 1.4, a) : 1;
    var R = Math.max(0.8, layer.r * info.long * scale);
    var ref = info.rgb.map(function (p) { return blur(p, w, h, R * 0.45); });
    var sx = surface.w / w, sy = surface.h / h;
    var flowC = info.flow.cos, flowS = info.flow.sin;

    var seeds = [], gap = Math.max(1.2, R * (index ? 1.05 : 0.85)), x, y;
    for (y = 0; y < h + gap / 2; y += gap) {
      for (x = 0; x < w + gap / 2; x += gap) {
        var jx = clamp(x + (rand() - 0.5) * gap, 0, w - 1), jy = clamp(y + (rand() - 0.5) * gap, 0, h - 1);
        var at = Math.floor(jy) * w + Math.floor(jx);
        if (info.detail[at] + (rand() - 0.5) * 0.12 < layer.need && layer.need) continue;
        if (!index && rand() > 0.3 + 0.7 * info.border[at]) continue; // sous-couche visible aux bords
        seeds.push(jx, jy);
      }
    }
    for (var s = seeds.length / 2 - 1; s > 0; s--) {
      var q = Math.floor(rand() * (s + 1)), tx = seeds[2 * s], ty = seeds[2 * s + 1];
      seeds[2 * s] = seeds[2 * q]; seeds[2 * s + 1] = seeds[2 * q + 1];
      seeds[2 * q] = tx; seeds[2 * q + 1] = ty;
    }

    function index2(px, py) { return Math.floor(clamp(py, 0, h - 1)) * w + Math.floor(clamp(px, 0, w - 1)); }
    function onCanvas(px, py) {
      return Math.floor(clamp(py * sy, 0, surface.h - 1)) * surface.w + Math.floor(clamp(px * sx, 0, surface.w - 1));
    }

    var painted = 0;
    for (var n = 0; n < seeds.length; n += 2) {
      var x0 = seeds[n], y0 = seeds[n + 1], i = index2(x0, y0), precise = info.focus[i];
      var r = ref[0][i], g = ref[1][i], b = ref[2][i];
      if (index) {
        var error = 0;
        for (var p = 0; p < 5; p++) {
          var ox = x0 + (p === 1 ? R : p === 2 ? -R : 0) * 0.5, oy = y0 + (p === 3 ? R : p === 4 ? -R : 0) * 0.5;
          var ri = index2(ox, oy), ci = onCanvas(ox, oy);
          error += colorDist(ref[0][ri], ref[1][ri], ref[2][ri], surface.r[ci], surface.g[ci], surface.b[ci]);
        }
        if (error / 5 < layer.err * (1 + a * 0.7) * (1 - precise * 0.45)) continue;
      }

      var loose = 1 - info.detail[i];
      var maxLen = R * layer.len * (0.6 + rand() * 0.7) * (1 + loose * 0.5) * (1 - precise * 0.15);
      var step = Math.max(1, R * (layer.knife ? 1.4 : 1)), steps = Math.max(1, Math.round(maxLen / step / 2));
      var tolerance = (layer.knife ? 34 : 24) * (1 + loose * a) * (1 - precise * 0.4);
      var bend = layer.knife ? 0.3 : 0.75, angle = 0.5 * Math.atan2(flowS[i], flowC[i]) + (rand() - 0.5) * 0.25 * loose;
      var head = [], tail = [];

      for (var dir = -1; dir <= 1; dir += 2) {
        var cx = x0, cy = y0, vx = Math.cos(angle) * dir, vy = Math.sin(angle) * dir, side = dir < 0 ? tail : head;
        for (var t = 0; t < steps; t++) {
          var nx = cx + vx * step, ny = cy + vy * step;
          if (nx < -R || ny < -R || nx > w + R || ny > h + R) break;
          var j = index2(nx, ny);
          if (colorDist(ref[0][j], ref[1][j], ref[2][j], r, g, b) > tolerance) break; // ne franchit pas un contour
          side.push(nx * sx, ny * sy);
          cx = nx; cy = ny;
          var local = 0.5 * Math.atan2(flowS[j], flowC[j]), ex = Math.cos(local), ey = Math.sin(local);
          if (ex * vx + ey * vy < 0) { ex = -ex; ey = -ey; }
          vx = mix(vx, ex, bend); vy = mix(vy, ey, bend);
          var norm = Math.sqrt(vx * vx + vy * vy) || 1;
          vx /= norm; vy /= norm;
        }
      }
      var pts = [];
      for (var e = tail.length - 2; e >= 0; e -= 2) pts.push(tail[e], tail[e + 1]);
      pts.push(x0 * sx, y0 * sy);
      Array.prototype.push.apply(pts, head);
      if (pts.length === 2) pts.push(pts[0] + Math.cos(angle) * R * sx * 0.6, pts[1] + Math.sin(angle) * R * sy * 0.6);

      // frais sur frais : la touche ramasse un peu de la couleur du dessous
      var under = onCanvas(x0, y0), wet = layer.wet * (1 - precise);
      var amount = layer.jitter * (0.5 + loose) * (0.6 + a) * (1 - precise * 0.6);
      var value = (rand() - 0.5) * amount * 1.5, warm = (rand() - 0.5) * amount;
      // dans le fond, la touche varie en intensité (×) et non par ajout, qui grise les couleurs sombres
      var out = info.outside[i], add = 1 - out, times = 1 + out * value / 70;
      var tint = out * warm / 220;
      var c0 = [mix(r, surface.r[under], wet) * times * (1 + tint) + (value + warm) * add,
                mix(g, surface.g[under], wet) * times + value * add,
                mix(b, surface.b[under], wet) * times * (1 - tint) + (value - warm) * add];
      var tip = index2(pts[pts.length - 2] / sx, pts[pts.length - 1] / sy);
      var c1 = [c0[0] + (ref[0][tip] - r) * 0.7, c0[1] + (ref[1][tip] - g) * 0.7, c0[2] + (ref[2][tip] - b) * 0.7];
      surface.stroke(pts, Math.max(1.3, R * sx * (0.8 + rand() * 0.4)), c0, c1, layer, rand);
      painted++;
    }
    return painted;
  }

  function paint(src, options, onLayer) {
    var o = options || {};
    var opts = {
      abstraction: clamp(o.abstraction == null ? 0.45 : o.abstraction, 0, 1),
      focus: o.focus || [],
      seed: (o.seed || 1) | 0
    };
    var info = analyse(src, opts), surface = new Surface(src.w, src.h), strokes = 0;
    surface.prime(info, opts.seed);
    for (var i = 0; i < LAYERS.length; i++) {
      strokes += paintLayer(surface, info, i, opts);
      if (onLayer) onLayer(i, LAYERS.length, surface);
    }
    return { data: surface.finish(0.7 + 0.6 * opts.abstraction, opts.seed), w: src.w, h: src.h, strokes: strokes };
  }

  root.PaintEngine = { paint: paint, analyse: analyse };
})(typeof self !== 'undefined' ? self : globalThis);
