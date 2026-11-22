/* Croque-moi les fesses : moteur de croquis au fusain, écrit à la main (aucune dépendance).
 *
 *   SketchEngine.draw({ data, w, h }, { technique, focus, seed }, onLayer) → { data, w, h }
 *
 * 1. valeurs : gris lissé sans baver sur les bords, niveaux adaptés à la photo ;
 * 2. estompe : les masses, au doigt ;
 * 3. hachures : elles suivent les formes et s'arrêtent à leurs bords ;
 * 4. traits : contours lissés le long des formes + reprises de construction ;
 * 5. gomme : lumières relevées, puis grain du papier.
 *
 * technique ne change pas la quantité de noir, seulement la façon de le poser :
 *   0 = estompé (fondu au doigt), 0.5 = équilibre, 1 = hachuré (trait nerveux).
 */
(function (root) {
  'use strict';

  var FLOW_SIDE = 700;
  var LAYER_COUNT = 5;
  var PAPER = [240, 234, 222], COAL = [27, 25, 24];

  // r = demi-largeur, len = longueur (px pour 1700 de grand côté), from = noirceur minimale
  var HATCHES = [
    { r: 5,   len: 60, gap: 15, from: 0.44, force: 0.20 },
    { r: 2.4, len: 38, gap: 10, from: 0.56, force: 0.28 },
    { r: 1.4, len: 24, gap: 8,  from: 0.70, force: 0.40 }
  ];

  // ---------- Outils ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

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

  // Flou ≈ gaussien : 3 passes de moyenne glissante (ctx.filter n'existe pas sur Safari)
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

  // Filtre guidé : lisse les textures en gardant les bords nets
  function guided(L, w, h, r, eps) {
    var n = w * h, v = new Float32Array(n), i;
    for (i = 0; i < n; i++) v[i] = L[i] * L[i];
    var m = blur(L, w, h, r), b = new Float32Array(n);
    v = blur(v, w, h, r);
    for (i = 0; i < n; i++) {
      var s = Math.max(0, v[i] - m[i] * m[i]), a = s / (s + eps);
      v[i] = a; b[i] = m[i] * (1 - a);
    }
    var A = blur(v, w, h, r), B = blur(b, w, h, r);
    for (i = 0; i < n; i++) A[i] = A[i] * L[i] + B[i];
    return A;
  }

  // ---------- Analyse ----------
  function findFlow(L, w, h, seed) {
    var k = Math.min(1, FLOW_SIDE / Math.max(w, h));
    var fw = Math.max(8, Math.round(w * k)), fh = Math.max(8, Math.round(h * k)), n = fw * fh;
    var S = new Float32Array(n), count = new Float32Array(n), x, y, i;
    for (y = 0; y < h; y++) {
      var row = Math.min(fh - 1, Math.floor(y * fh / h)) * fw;
      for (x = 0; x < w; x++) {
        i = row + Math.min(fw - 1, Math.floor(x * fw / w));
        S[i] += L[y * w + x]; count[i]++;
      }
    }
    for (i = 0; i < n; i++) S[i] /= count[i] || 1;
    S = blur(S, fw, fh, 1);

    var A = new Float32Array(n), B = new Float32Array(n), E = new Float32Array(n);
    for (y = 1; y < fh - 1; y++) {
      for (x = 1; x < fw - 1; x++) {
        i = y * fw + x;
        var gx = (S[i + 1] - S[i - 1]) * 255, gy = (S[i + fw] - S[i - fw]) * 255;
        A[i] = gx * gx - gy * gy; B[i] = 2 * gx * gy; E[i] = gx * gx + gy * gy;
      }
    }
    var cos = new Float32Array(n), sin = new Float32Array(n), long = Math.max(fw, fh);
    [[0.004, 1], [0.016, 0.7], [0.05, 0.4]].forEach(function (scale) {
      var s = long * scale[0], a = blur(A, fw, fh, s), b = blur(B, fw, fh, s), e = blur(E, fw, fh, s);
      for (var j = 0; j < n; j++) {
        var q = scale[1] / (e[j] + 12);
        cos[j] -= a[j] * q; sin[j] -= b[j] * q; // signe − : le long du contour
      }
    });

    var dx = new Float32Array(n), dy = new Float32Array(n), hx = new Float32Array(n), hy = new Float32Array(n);
    for (y = 0, i = 0; y < fh; y++) {
      for (x = 0; x < fw; x++, i++) {
        // dans les aplats : la diagonale du poignet
        var base = -0.85 + (noise(x / long * 3, y / long * 3, seed) - 0.5) * 0.8;
        var t = 0.5 * Math.atan2(sin[i] + Math.sin(2 * base) * 0.3, cos[i] + Math.cos(2 * base) * 0.3);
        dx[i] = Math.cos(t); dy[i] = Math.sin(t);
        // hachures : presque parallèles, à peine courbées par la forme (sinon effet pelage)
        t = 0.5 * Math.atan2(sin[i] + Math.sin(2 * base) * 1.7, cos[i] + Math.cos(2 * base) * 1.7);
        hx[i] = Math.cos(t); hy[i] = Math.sin(t);
      }
    }
    return {
      line: { x: dx, y: dy },
      hatch: { x: hx, y: hy },
      at: function (px, py) {
        return clamp(Math.floor(py * fh / h), 0, fh - 1) * fw + clamp(Math.floor(px * fw / w), 0, fw - 1);
      }
    };
  }

  function levels(values, w, h) {
    var bins = new Float64Array(256), total = 0;
    for (var y = 0; y < h; y += 2) {
      for (var x = 0; x < w; x += 2) {
        // le centre compte davantage que les bords
        var u = x / w - 0.5, v = y / h - 0.5, weight = 1.2 - (u * u + v * v) * 2;
        bins[clamp(Math.round(values[y * w + x] * 255), 0, 255)] += weight;
        total += weight;
      }
    }
    var lo = 0, hi = 0, sum = 0;
    for (var i = 0; i < 256; i++) {
      sum += bins[i];
      if (sum < total * 0.02) lo = i;
      if (sum < total * 0.98) hi = i;
    }
    lo /= 255; hi /= 255;
    var span = hi - lo;
    // photo presque unie : on ne pousse pas le bruit au noir
    if (span < 0.25) { lo = clamp(lo - (0.25 - span) / 2, 0, 0.75); span = 0.25; }
    return { lo: lo, span: span };
  }

  function analyse(src, opts) {
    var w = src.w, h = src.h, n = w * h, long = Math.max(w, h), unit = long / 1700, d = src.data;
    var L = new Float32Array(n), i, x, y;
    for (i = 0; i < n; i++) L[i] = (0.36 * d[i * 4] + 0.54 * d[i * 4 + 1] + 0.10 * d[i * 4 + 2]) / 255;

    var soft = guided(L, w, h, Math.max(1, 4 * unit), 0.003);
    var mass = guided(L, w, h, Math.max(1, 14 * unit), 0.008);
    var around = blur(mass, w, h, 55 * unit), range = levels(mass, w, h);

    var dark = new Float32Array(n);
    for (i = 0; i < n; i++) {
      // modelé local : une ombre douce reste lisible sur une zone claire
      var v = (mass[i] - range.lo) / range.span + (mass[i] - around[i]) * 1.1;
      dark[i] = Math.pow(1 - clamp(v, 0, 1), 1.08);
    }

    var focus = new Float32Array(n);
    opts.focus.forEach(function (f) {
      var fx = f.x * w, fy = f.y * h, fr = Math.max(2, f.r * long);
      for (var yy = Math.max(0, Math.floor(fy - fr)); yy < Math.min(h, fy + fr); yy++) {
        for (var xx = Math.max(0, Math.floor(fx - fr)); xx < Math.min(w, fx + fr); xx++) {
          var q = 1 - smooth(0.55, 1, Math.hypot(xx - fx, yy - fy) / fr);
          focus[yy * w + xx] = Math.max(focus[yy * w + xx], q);
        }
      }
    });

    // feuille inachevée : le dessin se dissout vers les bords, en touches irrégulières
    var area = new Float32Array(n), fade = 0.06;
    for (y = 0, i = 0; y < h; y++) {
      for (x = 0; x < w; x++, i++) {
        var edge = Math.min(x, y, w - 1 - x, h - 1 - y) / long;
        edge += (noise((x + y) / long * 9, (x - y) / long * 38, opts.seed + 7) - 0.5) * 0.06;
        area[i] = Math.max(smooth(-0.005, fade, edge), focus[i]);
      }
    }

    return {
      w: w, h: h, unit: unit, L: L, soft: soft, dark: dark, focus: focus, area: area,
      flow: findFlow(soft, w, h, opts.seed)
    };
  }

  // ---------- Feuille ----------
  function Sheet(w, h, unit, seed) {
    this.w = w; this.h = h;
    this.ink = new Float32Array(w * h);
    this.tooth = new Float32Array(w * h);
    var fine = 1 / Math.max(1, 1.7 * unit), wide = 1 / Math.max(2, 6 * unit);
    for (var y = 0, i = 0; y < h; y++) {
      for (var x = 0; x < w; x++, i++) {
        this.tooth[i] = 0.65 * noise(x * fine, y * fine, seed + 31) + 0.35 * noise(x * wide, y * wide, seed + 32);
      }
    }
  }

  Sheet.prototype.deposit = function (i, amount) {
    // peu appuyé, le fusain n'accroche que le sommet du grain ; appuyé, il bouche tout
    var a = amount * mix(0.35 + 1.3 * this.tooth[i], 1, amount);
    this.ink[i] += (1 - this.ink[i]) * clamp(a, 0, 1);
  };

  Sheet.prototype.stroke = function (pts, radius, force) {
    var last = pts.length - 1;
    for (var p = 1; p <= last; p++) {
      var a = pts[p - 1], b = pts[p], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
      var x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - radius)), x1 = Math.min(this.w - 1, Math.ceil(Math.max(a[0], b[0]) + radius));
      var y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - radius)), y1 = Math.min(this.h - 1, Math.ceil(Math.max(a[1], b[1]) + radius));
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var t = ((x - a[0]) * dx + (y - a[1]) * dy) / len2;
          if ((t < 0 && p > 1) || (t >= 1 && p < last)) continue; // pas de double dépôt aux jointures
          t = clamp(t, 0, 1);
          var ex = x - a[0] - t * dx, ey = y - a[1] - t * dy, q = (ex * ex + ey * ey) / (radius * radius);
          if (q >= 1) continue;
          var along = (p - 1 + t) / last; // attaque et relâché du geste
          this.deposit(y * this.w + x, force * (1 - q) * (0.35 + 2.6 * along * (1 - along)));
        }
      }
    }
  };

  Sheet.prototype.snapshot = function () {
    var out = new Uint8ClampedArray(this.ink.length * 4);
    for (var i = 0, j = 0; i < this.ink.length; i++, j += 4) {
      var ink = this.ink[i], grain = (this.tooth[i] - 0.5) * 9 * (1 - ink);
      for (var c = 0; c < 3; c++) out[j + c] = mix(PAPER[c], COAL[c], ink) + grain;
      out[j + 3] = 255;
    }
    return out;
  };

  // Un geste qui suit la forme, dans les deux sens, jusqu'au prochain bord
  function trace(info, dir, x, y, length, step, turn, limit) {
    var w = info.w, h = info.h, flow = info.flow, start = info.soft[(y | 0) * w + (x | 0)];
    var cos = Math.cos(turn), sin = Math.sin(turn);
    function walk(sign) {
      var out = [], px = x, py = y, lx = 0, ly = 0;
      for (var s = step; s <= length / 2; s += step) {
        var f = flow.at(px, py);
        var dx = dir.x[f] * cos - dir.y[f] * sin, dy = dir.x[f] * sin + dir.y[f] * cos;
        var way = out.length ? (dx * lx + dy * ly < 0 ? -1 : 1) : sign;
        lx = dx * way; ly = dy * way;
        px += lx * step; py += ly * step;
        if (px < 0 || py < 0 || px >= w || py >= h) break;
        if (Math.abs(info.soft[(py | 0) * w + (px | 0)] - start) > limit) break;
        out.push([px, py]);
      }
      return out;
    }
    return walk(-1).reverse().concat([[x, y]], walk(1));
  }

  // ---------- Passes ----------
  function smudge(sheet, info, opts) {
    var w = info.w, h = info.h, u = info.unit, force = 0.92 * (1 - 0.32 * opts.raw);
    for (var y = 0, i = 0; y < h; y++) {
      for (var x = 0; x < w; x++, i++) {
        var streak = noise((x + y) / (70 * u), (x - y) / (14 * u), opts.seed + 3);
        var cloud = noise(x / (160 * u), y / (160 * u), opts.seed + 4);
        sheet.deposit(i, info.dark[i] * force * info.area[i] * (0.78 + 0.22 * streak + 0.2 * (cloud - 0.5)));
      }
    }
  }

  function hatch(sheet, info, opts, rand) {
    var w = info.w, h = info.h, u = info.unit, raw = opts.raw, soft = opts.soft;
    var press = 1.2 * (1 - 0.6 * soft) * (1 + 0.3 * raw);
    function pass(H, turn, from, weight) {
      var gap = Math.max(3, H.gap * u), step = Math.max(2, 6 * u);
      for (var gy = 0; gy < h; gy += gap) {
        for (var gx = 0; gx < w; gx += gap) {
          var x = Math.min(w - 1, gx + rand() * gap), y = Math.min(h - 1, gy + rand() * gap), i = (y | 0) * w + (x | 0);
          if (rand() >= smooth(from, 1, info.dark[i]) * info.area[i] * (1 - 0.6 * info.focus[i])) continue;
          var pts = trace(info, info.flow.hatch, x, y, H.len * u * (1 + 0.6 * raw) * (0.6 + 0.8 * rand()), step, turn + (rand() - 0.5) * 0.16, 0.11);
          if (pts.length < 2) continue;
          sheet.stroke(pts, Math.max(0.8, H.r * u), H.force * weight * (0.7 + 0.6 * rand()));
        }
      }
    }
    HATCHES.forEach(function (H) { pass(H, 0, H.from - 0.1 * raw, press); });
    if (raw) pass(HATCHES[1], 0.75, 0.72, 0.8 * press * raw); // hachures croisées dans les ombres
  }

  // Le doigt passe sur le fusain : le grain et les hachures fondent, les bords des formes restent
  function rub(sheet, info, opts) {
    if (!opts.soft) return;
    var ink = sheet.ink, melted = guided(ink, info.w, info.h, Math.max(1, 5 * info.unit), 0.035);
    for (var i = 0; i < ink.length; i++) {
      var v = mix(ink[i], melted[i], 0.78 * opts.soft * (1 - 0.7 * info.focus[i]));
      ink[i] = clamp(v + (1 - v) * 0.36 * opts.soft * Math.pow(info.dark[i], 3) * info.area[i], 0, 1); // rend le noir perdu par les hachures
    }
  }

  function lines(sheet, info, opts, rand) {
    var w = info.w, h = info.h, n = w * h, u = info.unit, flow = info.flow;
    var s = Math.max(1, 2 * u), near = blur(info.soft, w, h, s), far = blur(info.soft, w, h, s * 2);
    var raw = blur(info.L, w, h, 1), edge = new Float32Array(n), x, y, i;
    for (i = 0; i < n; i++) {
      edge[i] = Math.max(0, far[i] - near[i]);
      if (info.focus[i]) edge[i] += info.focus[i] * Math.max(0, near[i] - raw[i]) * 0.9; // points touchés : détail fin
    }

    // contours lissés le long des formes : des traits, plus des pointillés
    var line = new Float32Array(n), step = Math.max(1, 2 * u);
    for (y = 0, i = 0; y < h; y++) {
      for (x = 0; x < w; x++, i++) {
        var f = flow.at(x, y), dx = flow.line.x[f] * step, dy = flow.line.y[f] * step, sum = edge[i] * 2, weight = 2;
        for (var k = -3; k <= 3; k++) {
          if (!k) continue;
          var px = Math.round(x + dx * k), py = Math.round(y + dy * k);
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          var g = 1 - Math.abs(k) * 0.2;
          sum += edge[py * w + px] * g; weight += g;
        }
        line[i] = sum / weight;
      }
    }

    var force = 0.75 * (1 - 0.4 * opts.soft) * (1 + 0.5 * opts.raw);
    for (y = 0, i = 0; y < h; y++) {
      for (x = 0; x < w; x++, i++) {
        var a = smooth(0.004, 0.034 - 0.012 * info.focus[i], line[i]);
        if (!a) continue;
        var press = 0.65 + 0.5 * noise(x / (40 * u), y / (40 * u), opts.seed + 5);
        sheet.deposit(i, clamp(a * force * press * mix(0.3, 1, info.area[i]), 0, 1));
      }
    }

    // reprises : longs traits légers, un peu à côté du contour
    var gap = Math.max(4, 12 * u);
    for (var gy = 0; gy < h; gy += gap) {
      for (var gx = 0; gx < w; gx += gap) {
        x = Math.min(w - 1, gx + rand() * gap); y = Math.min(h - 1, gy + rand() * gap); i = (y | 0) * w + (x | 0);
        if (rand() >= smooth(0.012, 0.04, line[i]) * (1 - info.focus[i]) * 0.4 * (1 - opts.soft) * (1 + 1.5 * opts.raw)) continue;
        var pts = trace(info, flow.line, x, y, 150 * u * (0.5 + rand()), Math.max(2, 7 * u), (rand() - 0.5) * 0.08, 0.22);
        if (pts.length < 3) continue;
        var ox = (rand() - 0.5) * 7 * u, oy = (rand() - 0.5) * 7 * u;
        for (var p = 0; p < pts.length; p++) { pts[p][0] += ox; pts[p][1] += oy; }
        sheet.stroke(pts, Math.max(0.8, 1.5 * u), 0.36 * (1 + 0.6 * opts.raw));
      }
    }
  }

  function erase(sheet, info) {
    var wide = blur(info.soft, info.w, info.h, 22 * info.unit);
    for (var i = 0; i < wide.length; i++) {
      var light = smooth(0.015, 0.10, info.soft[i] - wide[i]) * (1 - smooth(0.35, 0.8, info.dark[i]));
      sheet.ink[i] *= 1 - 0.7 * light;
    }
  }

  function draw(src, options, onLayer) {
    var t = 2 * clamp(options.technique, 0, 1) - 1;
    var opts = { soft: Math.max(0, -t), raw: Math.max(0, t), focus: options.focus || [], seed: options.seed || 1 };
    var info = analyse(src, opts), sheet = new Sheet(src.w, src.h, info.unit, opts.seed);
    var rand = random(opts.seed * 7919);
    function done(index) { if (onLayer) onLayer(index, LAYER_COUNT, sheet); }
    done(0);
    smudge(sheet, info, opts); done(1);
    hatch(sheet, info, opts, rand); rub(sheet, info, opts); done(2);
    lines(sheet, info, opts, rand); done(3);
    erase(sheet, info); done(4);
    return { data: sheet.snapshot(), w: src.w, h: src.h };
  }

  root.SketchEngine = { draw: draw };
})(typeof self !== 'undefined' ? self : globalThis);
