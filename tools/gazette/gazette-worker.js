/* Gazette-moi — encodeur GIF (Web Worker). L'encodeur est celui de GIF-moi encore,
 * écrit à la main : aucune bibliothèque externe.
 *
 * Reçoit : { bg: ArrayBuffer RGBA (la page, W × H), W, H, box: { x, y, w, h },
 *            frames: [ArrayBuffer RGBA box.w × box.h], delay (centièmes de s), maxBytes }
 * Renvoie : { type: 'progress', p } … puis { type: 'done', buffer, w, h } ou { type: 'error' }.
 *
 * Chaque image est composée à la volée (page + photo animée) : on ne garde jamais
 * toutes les images en pleine taille. Seule la zone de la photo change d'une image
 * à l'autre, et l'encodeur n'écrit que ce qui change : le fichier reste léger.
 */
'use strict';

var TRANSPARENT = 255;
var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

self.onmessage = function (e) {
  var m = e.data;
  try {
    var W = m.W, H = m.H, bg = new Uint8ClampedArray(m.bg), box = m.box;
    var shots = m.frames.map(function (f) { return new Uint8ClampedArray(f); });
    var out = null, tries = 0;
    for (;;) {
      out = encode(composer(bg, W, H, box, shots), W, H, m.delay, false, tries);
      if (out.length <= m.maxBytes || tries >= 4 || Math.min(W, H) <= 200) break;
      // trop lourd : on réduit tout (page et photo) et on recommence
      var k = Math.min(0.9, Math.max(0.5, Math.sqrt(m.maxBytes * 0.9 / out.length)));
      var nW = Math.max(2, Math.round(W * k)), nH = Math.max(2, Math.round(H * k));
      var nb = { x: Math.round(box.x * k), y: Math.round(box.y * k), w: Math.max(1, Math.round(box.w * k)), h: Math.max(1, Math.round(box.h * k)) };
      nb.w = Math.min(nb.w, nW - nb.x); nb.h = Math.min(nb.h, nH - nb.y);
      bg = resize(bg, W, H, nW, nH);
      shots = shots.map(function (f) { return resize(f, box.w, box.h, nb.w, nb.h); });
      W = nW; H = nH; box = nb;
      tries++;
    }
    var buf = out.buffer.slice(0, out.length);
    self.postMessage({ type: 'done', buffer: buf, w: W, h: H, bytes: out.length }, [buf]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};

// Un faux tableau d'images : frames[i] compose l'image i dans un tampon réutilisé.
function composer(bg, W, H, box, shots) {
  var work = new Uint8ClampedArray(W * H * 4), row = box.w * 4;
  return new Proxy({}, {
    get: function (t, k) {
      if (k === 'length') return shots.length;
      var f = shots[+k];
      work.set(bg);
      for (var y = 0; y < box.h; y++) work.set(f.subarray(y * row, (y + 1) * row), ((box.y + y) * W + box.x) * 4);
      return work;
    }
  });
}

function progress(p, attempt) { self.postMessage({ type: 'progress', p: p, attempt: attempt || 0 }); }

// ---------- Palette (coupe médiane sur un histogramme 6 bits / canal) ----------
function buildPalette(frames, w, h) {
  var BINS = 1 << 18;
  var cnt = new Uint32Array(BINS), sr = new Float64Array(BINS), sg = new Float64Array(BINS), sb = new Float64Array(BINS);
  var n = w * h, nf = frames.length;
  var pick = Math.min(nf, 16), step = Math.max(1, Math.round(Math.sqrt(n / 40000)));
  for (var s = 0; s < pick; s++) {
    var f = frames[Math.floor(s * nf / pick)];
    for (var y = 0; y < h; y += step) {
      for (var x = (y / step) % 2 ? 1 : 0; x < w; x += step) {
        var i = (y * w + x) * 4, r = f[i], g = f[i + 1], b = f[i + 2];
        var k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
        cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
      }
    }
  }
  var items = [];
  for (var k2 = 0; k2 < BINS; k2++) if (cnt[k2]) items.push(k2);

  function makeBox(list) {
    var rmin = 63, rmax = 0, gmin = 63, gmax = 0, bmin = 63, bmax = 0, c = 0;
    for (var j = 0; j < list.length; j++) {
      var q = list[j], r = q >> 12, g = (q >> 6) & 63, b = q & 63;
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (g < gmin) gmin = g; if (g > gmax) gmax = g;
      if (b < bmin) bmin = b; if (b > bmax) bmax = b;
      c += cnt[q];
    }
    var rr = rmax - rmin, gr = gmax - gmin, br = bmax - bmin;
    // poids perceptif : l'œil est plus sensible au vert, puis au rouge
    var axis = 0, span = rr * 1.0;
    if (gr * 1.2 > span) { axis = 1; span = gr * 1.2; }
    if (br * 0.8 > span) { axis = 2; span = br * 0.8; }
    return { list: list, count: c, axis: axis, span: span };
  }

  var boxes = [makeBox(items)];
  while (boxes.length < 255) {
    var best = -1, bestScore = 0;
    for (var bi = 0; bi < boxes.length; bi++) {
      var bx = boxes[bi];
      if (bx.list.length < 2 || bx.span <= 0) continue;
      var score = bx.span * Math.sqrt(bx.count);
      if (score > bestScore) { bestScore = score; best = bi; }
    }
    if (best < 0) break;
    var box = boxes[best], ax = box.axis;
    var key = ax === 0 ? function (q) { return q >> 12; } : ax === 1 ? function (q) { return (q >> 6) & 63; } : function (q) { return q & 63; };
    box.list.sort(function (a, b) { return key(a) - key(b); });
    var half = box.count / 2, acc = 0, cut = 1;
    for (var j = 0; j < box.list.length - 1; j++) {
      acc += cnt[box.list[j]];
      if (acc >= half) { cut = j + 1; break; }
      cut = j + 1;
    }
    // ne pas couper au milieu d'une même valeur sur l'axe
    while (cut < box.list.length && key(box.list[cut]) === key(box.list[cut - 1])) cut++;
    if (cut >= box.list.length) {
      cut = box.list.length - 1;
      while (cut > 0 && key(box.list[cut]) === key(box.list[cut - 1])) cut--;
      if (cut <= 0) { box.span = 0; continue; }
    }
    boxes.splice(best, 1, makeBox(box.list.slice(0, cut)), makeBox(box.list.slice(cut)));
  }

  var pal = new Uint8Array(256 * 3);
  for (var p = 0; p < boxes.length; p++) {
    var tr = 0, tg = 0, tb = 0, tc = 0, L = boxes[p].list;
    for (var j2 = 0; j2 < L.length; j2++) { var q2 = L[j2]; tr += sr[q2]; tg += sg[q2]; tb += sb[q2]; tc += cnt[q2]; }
    pal[p * 3] = Math.round(tr / tc); pal[p * 3 + 1] = Math.round(tg / tc); pal[p * 3 + 2] = Math.round(tb / tc);
  }
  return { pal: pal, size: Math.max(1, boxes.length) };
}

// Table « couleur 6 bits → index de palette », remplie à la demande.
function makeMapper(P) {
  var lut = new Int16Array(1 << 18).fill(-1), pal = P.pal, size = P.size;
  return function (k) {
    var v = lut[k];
    if (v >= 0) return v;
    var r = ((k >> 12) << 2) + 2, g = (((k >> 6) & 63) << 2) + 2, b = ((k & 63) << 2) + 2;
    var best = 0, bd = 1e9;
    for (var i = 0; i < size; i++) {
      var dr = r - pal[i * 3], dg = g - pal[i * 3 + 1], db = b - pal[i * 3 + 2];
      var d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
      if (d < bd) { bd = d; best = i; }
    }
    lut[k] = best;
    return best;
  };
}

// ---------- Encodage ----------
function encode(frames, w, h, delay, gray, attempt) {
  var P = buildPalette(frames, w, h);
  var map = makeMapper(P);
  var amp = gray ? 5 : 11;
  var n = w * h, nf = frames.length;
  var prev = null, cur = new Uint8Array(n), out = new Writer(Math.max(1 << 16, n * nf / 3));

  // En-tête, palette globale (256 entrées), boucle infinie
  out.str('GIF89a');
  out.u16(w); out.u16(h);
  out.u8(0xF7); out.u8(0); out.u8(0);
  for (var i = 0; i < 256 * 3; i++) out.u8(P.pal[i]);
  out.u8(0x21); out.u8(0xFF); out.u8(11); out.str('NETSCAPE2.0'); out.u8(3); out.u8(1); out.u16(0); out.u8(0);

  var pending = null; // image prête à écrire (on attend de savoir si les suivantes sont identiques)
  for (var f = 0; f < nf; f++) {
    var src = frames[f];
    for (var y = 0, p = 0; y < h; y++) {
      var row = (y & 3) << 2;
      for (var x = 0; x < w; x++, p++) {
        var o = p * 4, t = (BAYER[row | (x & 3)] / 16 - 0.47) * amp;
        var r = src[o] + t, g = src[o + 1] + t, b = src[o + 2] + t;
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        b = b < 0 ? 0 : b > 255 ? 255 : b;
        cur[p] = map(((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2));
      }
    }
    var block;
    if (!prev) {
      block = { x: 0, y: 0, w: w, h: h, data: cur.slice(), transparent: false, delay: delay };
    } else {
      // zone modifiée depuis l'image précédente
      var x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var yy = 0, q = 0; yy < h; yy++) {
        for (var xx = 0; xx < w; xx++, q++) {
          if (cur[q] !== prev[q]) {
            if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
            if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
          }
        }
      }
      if (x1 < 0) { pending.delay += delay; continue; } // image identique : on prolonge la précédente
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1, d = new Uint8Array(bw * bh);
      for (var by = 0; by < bh; by++) {
        var base = (y0 + by) * w + x0;
        for (var bx2 = 0; bx2 < bw; bx2++) {
          var v = cur[base + bx2];
          d[by * bw + bx2] = v === prev[base + bx2] ? TRANSPARENT : v;
        }
      }
      block = { x: x0, y: y0, w: bw, h: bh, data: d, transparent: true, delay: delay };
    }
    if (pending) writeBlock(out, pending);
    pending = block;
    var tmp = prev || new Uint8Array(n);
    prev = cur; cur = tmp;
    if (f % 4 === 3) progress(Math.min(0.99, (f + 1) / nf), attempt);
  }
  if (pending) writeBlock(out, pending);
  out.u8(0x3B);
  return out.bytes();
}

function writeBlock(out, b) {
  // Graphic Control Extension : disposition 1 (on garde l'image), transparence éventuelle
  out.u8(0x21); out.u8(0xF9); out.u8(4);
  out.u8((1 << 2) | (b.transparent ? 1 : 0));
  out.u16(Math.min(65535, Math.max(2, Math.round(b.delay))));
  out.u8(TRANSPARENT); out.u8(0);
  // Image Descriptor (sans palette locale)
  out.u8(0x2C); out.u16(b.x); out.u16(b.y); out.u16(b.w); out.u16(b.h); out.u8(0);
  lzw(out, b.data);
}

// ---------- Compression LZW (taille de code minimale 8) ----------
var HSIZE = 5003;
var htab = new Int32Array(HSIZE), codetab = new Int32Array(HSIZE);

function lzw(out, data) {
  var CLEAR = 256, EOI = 257;
  out.u8(8);
  var block = new Uint8Array(255), blen = 0, acc = 0, nbits = 0, size = 9, next = EOI + 1;

  function emit(code) {
    acc |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      block[blen++] = acc & 255;
      if (blen === 255) { out.u8(255); out.bytesFrom(block, 255); blen = 0; }
      acc >>>= 8;
      nbits -= 8;
    }
  }

  htab.fill(-1);
  emit(CLEAR);
  var ent = data[0];
  for (var i = 1; i < data.length; i++) {
    var c = data[i];
    var fcode = (c << 12) + ent;
    var hi = (c << 4) ^ ent;
    var found = false;
    if (htab[hi] === fcode) { ent = codetab[hi]; continue; }
    if (htab[hi] >= 0) {
      var disp = hi === 0 ? 1 : HSIZE - hi;
      for (;;) {
        hi -= disp;
        if (hi < 0) hi += HSIZE;
        if (htab[hi] === fcode) { ent = codetab[hi]; found = true; break; }
        if (htab[hi] < 0) break;
      }
      if (found) continue;
    }
    emit(ent);
    if (next === 4096) {
      emit(CLEAR);
      htab.fill(-1);
      next = EOI + 1;
      size = 9;
    } else {
      if (next >= (1 << size)) size++;
      codetab[hi] = next++;
      htab[hi] = fcode;
    }
    ent = c;
  }
  emit(ent);
  emit(EOI);
  if (nbits > 0) {
    block[blen++] = acc & 255;
    if (blen === 255) { out.u8(255); out.bytesFrom(block, 255); blen = 0; }
  }
  if (blen) { out.u8(blen); out.bytesFrom(block, blen); }
  out.u8(0);
}

// ---------- Réduction (moyenne par zone) ----------
function resize(src, w, h, nw, nh) {
  var dst = new Uint8ClampedArray(nw * nh * 4), kx = w / nw, ky = h / nh;
  for (var y = 0; y < nh; y++) {
    var ya = Math.floor(y * ky), yb = Math.max(ya + 1, Math.min(h, Math.floor((y + 1) * ky)));
    for (var x = 0; x < nw; x++) {
      var xa = Math.floor(x * kx), xb = Math.max(xa + 1, Math.min(w, Math.floor((x + 1) * kx)));
      var r = 0, g = 0, b = 0, c = 0;
      for (var yy = ya; yy < yb; yy++) {
        for (var xx = xa; xx < xb; xx++) {
          var i = (yy * w + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; c++;
        }
      }
      var o = (y * nw + x) * 4;
      dst[o] = r / c; dst[o + 1] = g / c; dst[o + 2] = b / c; dst[o + 3] = 255;
    }
  }
  return dst;
}

// ---------- Tampon d'octets extensible ----------
function Writer(cap) {
  this.buf = new Uint8Array(Math.max(1024, Math.floor(cap)));
  this.len = 0;
}
Writer.prototype.grow = function (need) {
  if (this.len + need <= this.buf.length) return;
  var nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + need));
  nb.set(this.buf.subarray(0, this.len));
  this.buf = nb;
};
Writer.prototype.u8 = function (v) { this.grow(1); this.buf[this.len++] = v & 255; };
Writer.prototype.u16 = function (v) { this.grow(2); this.buf[this.len++] = v & 255; this.buf[this.len++] = (v >> 8) & 255; };
Writer.prototype.str = function (s) { for (var i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); };
Writer.prototype.bytesFrom = function (a, n) { this.grow(n); this.buf.set(a.subarray(0, n), this.len); this.len += n; };
Writer.prototype.bytes = function () { return this.buf.subarray(0, this.len); };
