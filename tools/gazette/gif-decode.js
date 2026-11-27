/* Gazette-moi : décodeur GIF écrit à la main (aucune bibliothèque externe).
 * GifDecode.decode(ArrayBuffer) → { w, h, frames: [{ data: Uint8ClampedArray RGBA, delay (cs) }] }
 * Gère les palettes globales / locales, la transparence, l'entrelacement
 * et les trois façons d'effacer une image avant la suivante (« disposal »).
 */
(function (root) {
  'use strict';

  function lzw(minSize, data, count) {
    var clear = 1 << minSize, eoi = clear + 1, out = new Uint8Array(count);
    var prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
    var size = minSize + 1, mask = (1 << size) - 1, avail = clear + 2, old = -1, first = 0;
    var datum = 0, bits = 0, top = 0, op = 0, i = 0, code, inCode, c;
    for (c = 0; c < clear; c++) suffix[c] = c;
    while (op < count) {
      if (top === 0) {
        if (bits < size) {
          if (i >= data.length) break;
          datum |= data[i++] << bits;
          bits += 8;
          continue;
        }
        code = datum & mask;
        datum >>= size;
        bits -= size;
        if (code === clear) { size = minSize + 1; mask = (1 << size) - 1; avail = clear + 2; old = -1; continue; }
        if (code === eoi) break;
        if (old === -1) { stack[top++] = suffix[code]; old = code; first = code; continue; }
        inCode = code;
        if (code >= avail) { stack[top++] = first; code = old; }
        while (code > clear) { stack[top++] = suffix[code]; code = prefix[code]; }
        first = suffix[code];
        stack[top++] = first;
        if (avail < 4096) {
          prefix[avail] = old;
          suffix[avail] = first;
          avail++;
          if ((avail & mask) === 0 && avail < 4096) { size++; mask += avail; }
        }
        old = inCode;
      }
      out[op++] = stack[--top];
    }
    return out;
  }

  function decode(buffer) {
    var b = new Uint8Array(buffer), p = 0;
    function u8() { return b[p++]; }
    function u16() { var v = b[p] | (b[p + 1] << 8); p += 2; return v; }
    function palette(n) { var pal = b.subarray(p, p + n * 3); p += n * 3; return pal; }
    function subBlocks() {
      var parts = [], total = 0, n;
      while ((n = u8()) > 0) { parts.push(b.subarray(p, p + n)); p += n; total += n; }
      var all = new Uint8Array(total), o = 0;
      parts.forEach(function (s) { all.set(s, o); o += s.length; });
      return all;
    }

    var sig = String.fromCharCode(b[0], b[1], b[2]);
    if (sig !== 'GIF') throw new Error('pas un GIF');
    p = 6;
    var W = u16(), H = u16(), flags = u8();
    p += 2; // couleur de fond, rapport d'aspect
    var gpal = flags & 0x80 ? palette(1 << ((flags & 7) + 1)) : null;

    var canvas = new Uint8ClampedArray(W * H * 4), frames = [];
    var gce = { disposal: 0, delay: 0, trans: -1 };
    var prevDisposal = 0, prevRect = null, saved = null;

    while (p < b.length) {
      var block = u8();
      if (block === 0x3B) break;                       // fin
      if (block === 0x21) {                            // extension
        var label = u8();
        if (label === 0xF9) {
          u8();
          var pf = u8();
          gce = { disposal: (pf >> 2) & 7, delay: u16(), trans: pf & 1 ? b[p] : -1 };
          p++;
          u8();
        } else subBlocks();
        continue;
      }
      if (block !== 0x2C) break;                       // octet inattendu : on s'arrête là
      var ix = u16(), iy = u16(), iw = u16(), ih = u16(), f2 = u8();
      var pal = f2 & 0x80 ? palette(1 << ((f2 & 7) + 1)) : gpal;
      var interlaced = !!(f2 & 0x40);
      var minSize = u8(), pixels = lzw(minSize, subBlocks(), iw * ih);
      if (!pal) continue;

      // effacement demandé par l'image précédente
      if (prevDisposal === 2 && prevRect) clearRect(canvas, W, H, prevRect);
      else if (prevDisposal === 3 && saved) canvas.set(saved);
      saved = gce.disposal === 3 ? canvas.slice() : null;

      // lignes dans l'ordre (entrelacement : 0, 4, 2, 1 par pas de 8, 8, 4, 2)
      var rows = [];
      if (interlaced) [[0, 8], [4, 8], [2, 4], [1, 2]].forEach(function (s) { for (var r = s[0]; r < ih; r += s[1]) rows.push(r); });
      else for (var r2 = 0; r2 < ih; r2++) rows.push(r2);
      for (var k = 0; k < ih; k++) {
        var y = iy + rows[k];
        if (y >= H) continue;
        for (var x = 0; x < iw; x++) {
          var X = ix + x;
          if (X >= W) continue;
          var ci = pixels[k * iw + x];
          if (ci === gce.trans) continue;
          var o = (y * W + X) * 4, q = ci * 3;
          canvas[o] = pal[q]; canvas[o + 1] = pal[q + 1]; canvas[o + 2] = pal[q + 2]; canvas[o + 3] = 255;
        }
      }
      // délai nul ou quasi nul : les navigateurs l'affichent à 1/10 s
      frames.push({ data: canvas.slice(), delay: gce.delay < 2 ? 10 : gce.delay });
      prevDisposal = gce.disposal;
      prevRect = { x: ix, y: iy, w: iw, h: ih };
      gce = { disposal: 0, delay: 0, trans: -1 };
    }
    if (!frames.length) throw new Error('GIF vide');
    return { w: W, h: H, frames: frames };
  }

  function clearRect(c, W, H, r) {
    for (var y = r.y; y < Math.min(H, r.y + r.h); y++) {
      c.fill(0, (y * W + r.x) * 4, (y * W + Math.min(W, r.x + r.w)) * 4);
    }
  }

  root.GifDecode = { decode: decode };
})(this);
