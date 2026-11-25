/* Story Maker : dessin de la lettre sur un canvas. 100 % local.
 * La lettre fait 1080 px de large ; sa hauteur suit le texte.
 * Polices libres (OFL) rangées dans assets/fonts (déclarées dans story.css).
 */
(function (root) {
  'use strict';

  var W = 1080;
  var MAX_H = 15000;          // au-delà, on réduit l'image (limite des canvas sur iPhone)

  // size : correction de taille (à corps égal, Garamond paraît plus petit que Baskerville)
  var FONTS = {
    garamond: { label: 'Garamond', family: 'SM EB Garamond', file: 'ebgaramond', size: 1.12, weight: 400, title: 600 },
    lora: { label: 'Lora', family: 'SM Lora', file: 'lora', size: 0.97, weight: 400, title: 600 },
    baskerville: { label: 'Baskerville', family: 'SM Libre Baskerville', file: 'librebaskerville', size: 0.9, weight: 400, title: 700 },
    cormorant: { label: 'Cormorant', family: 'SM Cormorant', file: 'cormorantgaramond', size: 1.16, weight: 500, title: 600 },
    plume: { label: 'Plume', family: 'SM Dancing Script', file: 'dancingscript', size: 1.2, weight: 400, title: 700, noItalic: true }
  };

  // paper : la page ; frame : la bordure (plus sombre) ; orn : enluminures ; ink : le texte
  var THEMES = {
    rose: { label: 'Rose', paper: '#fcebee', frame: '#e8b9c3', orn: '#b26a7b', ink: '#3b272c' },
    peche: { label: 'Pêche', paper: '#fdf0e4', frame: '#f0c6a6', orn: '#b8734a', ink: '#3d2a1f' },
    vanille: { label: 'Vanille', paper: '#fcf6e3', frame: '#e6d49e', orn: '#9c7e33', ink: '#37301c' },
    menthe: { label: 'Menthe', paper: '#ebf6ef', frame: '#aad6be', orn: '#4f8e6d', ink: '#22332a' },
    ciel: { label: 'Ciel', paper: '#eaf3fb', frame: '#abcbe7', orn: '#4e7ca5', ink: '#222f3d' },
    lavande: { label: 'Lavande', paper: '#f0ecfb', frame: '#c5b7ec', orn: '#7462b0', ink: '#2d283e' },
    lilas: { label: 'Lilas', paper: '#f9ebf6', frame: '#ddb5d7', orn: '#9b5a92', ink: '#382535' },
    perle: { label: 'Perle', paper: '#f3f1ec', frame: '#d2cdc1', orn: '#857c69', ink: '#2e2c28' }
  };

  // ---------- Polices ----------
  // Les @font-face sont dans story.css ; ici on attend qu'elles soient chargées
  // (un canvas ne patiente pas : une police absente serait remplacée par Georgia).
  var loading = {};
  function loadFont(key) {
    var f = FONTS[key];
    if (loading[key]) return loading[key];
    if (!document.fonts || !document.fonts.load) return (loading[key] = Promise.resolve());
    var wanted = [font(f, 30), font(f, 30, f.title)];
    if (!f.noItalic) wanted.push(font(f, 30, f.weight, true));
    loading[key] = Promise.all(wanted.map(function (s) { return document.fonts.load(s, 'Aa'); }))
      .catch(function () { delete loading[key]; throw new Error('police'); });
    return loading[key];
  }

  function font(f, px, weight, italic) {
    return (italic && !f.noItalic ? 'italic ' : '') + (weight || f.weight) + ' ' + Math.round(px * 10) / 10 + 'px "' + f.family + '", Georgia, serif';
  }

  // ---------- Couleurs ----------
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); }).join(',') + ')';
  }
  function alpha(hex, a) { var c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // ---------- Texte ----------
  // Typographie française : apostrophes, points de suspension, tirets ;
  // la ponctuation haute reste collée au mot qui la précède.
  function typo(s) {
    return s.replace(/\r\n?/g, '\n')
      .replace(/'/g, '’')
      .replace(/\.\.\./g, '…')
      .replace(/ -- | - /g, ' — ')
      .replace(/"([^"\n]*)"/g, '« $1 »');
  }

  function words(line) {
    var raw = line.split(/[ \t]+/).filter(Boolean), out = [];
    for (var i = 0; i < raw.length; i++) {
      var w = raw[i];
      if (out.length && /^[;:!?»%]+[.,…]*$/.test(w)) out[out.length - 1] += ' ' + w;
      else if (out.length && /«$/.test(out[out.length - 1]) && out[out.length - 1].length === 1) out[out.length - 1] += ' ' + w;
      else out.push(w);
    }
    return out;
  }

  // Coupe les mots en lignes ; widthAt(i) donne la largeur de la ligne i.
  function wrap(ctx, list, widthAt, startLine) {
    var lines = [], cur = [], curW = 0, space = ctx.measureText(' ').width, n = startLine || 0;
    function push(last) { lines.push({ words: cur, width: curW, last: last, max: widthAt(n) }); n++; cur = []; curW = 0; }
    for (var i = 0; i < list.length; i++) {
      var w = list[i], ww = ctx.measureText(w).width, max = widthAt(n);
      if (ww > max) { // mot plus long qu'une ligne : coupé à la lettre
        if (cur.length) push(false);
        var piece = '';
        for (var k = 0; k < w.length; k++) {
          if (ctx.measureText(piece + w[k]).width > widthAt(n) && piece) { cur = [piece]; curW = ctx.measureText(piece).width; push(false); piece = ''; }
          piece += w[k];
        }
        w = piece; ww = ctx.measureText(w).width;
      }
      if (cur.length && curW + space + ww > max) push(false);
      curW += (cur.length ? space : 0) + ww;
      cur.push(w);
    }
    if (cur.length) push(true);
    return lines;
  }

  function drawLine(ctx, line, x, y, justify) {
    var space = ctx.measureText(' ').width, gap = space;
    if (justify && !line.last && line.words.length > 1) {
      var g = (line.max - line.width) / (line.words.length - 1) + space;
      if (g < space * 2.4) gap = g; // trop d'espace : on laisse la ligne en drapeau
    }
    for (var i = 0; i < line.words.length; i++) {
      ctx.fillText(line.words[i], x, y);
      x += ctx.measureText(line.words[i]).width + gap;
    }
  }

  // ---------- Ornements ----------
  function diamond(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath(); ctx.fill();
  }
  function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  // Coin enluminé : deux volutes qui partent du coin le long des bords.
  // Repère local : le coin en (0, 0), le dessin s'étend vers +x et +y.
  function corner(ctx, s) {
    for (var k = 0; k < 2; k++) {
      ctx.save();
      if (k) { ctx.rotate(Math.PI / 2); ctx.scale(1, -1); } // symétrie par la diagonale
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(s * 0.35, s * 0.02, s * 0.55, s * 0.18, s * 0.62, s * 0.08);
      ctx.bezierCurveTo(s * 0.68, -s * 0.01, s * 0.8, s * 0.02, s * 0.78, s * 0.1);
      ctx.bezierCurveTo(s * 0.76, s * 0.16, s * 0.68, s * 0.15, s * 0.69, s * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.07);
      ctx.quadraticCurveTo(s * 0.32, s * 0.22, s * 0.46, s * 0.2);
      ctx.stroke();
      dot(ctx, s * 0.92, s * 0.05, s * 0.022);
      ctx.restore();
    }
    // feuille au coin
    ctx.save();
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.ellipse(s * 0.2, 0, s * 0.12, s * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    dot(ctx, s * 0.06, s * 0.06, s * 0.03);
  }

  function rule(ctx, cx, y, half) {
    ctx.beginPath();
    ctx.moveTo(cx - half, y); ctx.lineTo(cx - 14, y);
    ctx.moveTo(cx + 14, y); ctx.lineTo(cx + half, y);
    ctx.stroke();
    diamond(ctx, cx, y, 7);
    dot(ctx, cx - half - 7, y, 2.6);
    dot(ctx, cx + half + 7, y, 2.6);
  }

  // ---------- Mise en page + dessin ----------
  // data : { title, text, name, photo (canvas carré ou null), theme, font }
  function render(canvas, data) {
    var T = THEMES[data.theme] || THEMES.rose, F = FONTS[data.font] || FONTS.garamond;
    var B = 54, P = 66, X0 = B + P, CW = W - 2 * X0;
    var body = 33 * F.size, LH = Math.round(body * 1.5);
    var titleSize = 56 * F.size, titleLH = titleSize * 1.18;
    var hasStamp = !!(data.photo || (data.name || '').trim()), R = 82;
    var name = (data.name || '').trim(), title = typo((data.title || '').trim()), text = typo(data.text || '');

    var m = canvas.getContext('2d');
    var ops = []; // la mise en page produit une liste d'opérations, dessinées une fois la hauteur connue

    // --- en-tête : titre à gauche, tampon à droite
    var y = B + P, headerH = 0;
    if (hasStamp) {
      var nameSize = 29 * F.size, nameW = 2 * R + 140;
      m.font = font(F, nameSize, F.weight, true);
      while (name && m.measureText(name).width > nameW && nameSize > 16) { nameSize -= 1; m.font = font(F, nameSize, F.weight, true); }
      var scx = W - X0 - R - 10, scy = y + R + 8;
      ops.push(function (c) { stamp(c, T, F, data.photo, name, scx, scy, R, nameSize); });
      headerH = 2 * R + 16 + (name ? 26 + nameSize * 1.1 : 0);
    }
    var titleW = hasStamp ? CW - 2 * R - 70 : CW, centered = !hasStamp;
    if (title) {
      m.font = font(F, titleSize, F.title);
      var tl = wrap(m, words(title.replace(/\n+/g, ' ')), function () { return titleW; });
      var ty = y + (hasStamp ? 14 : 0);
      tl.forEach(function (line, i) {
        var ly = ty + titleSize * 0.95 + i * titleLH, lx = centered ? X0 + (CW - line.width) / 2 : X0;
        ops.push(function (c) { c.font = font(F, titleSize, F.title); c.fillStyle = T.ink; drawLine(c, line, lx, ly, false); });
      });
      var ry = ty + titleSize * 0.95 + (tl.length - 1) * titleLH + 34;
      var rcx = centered ? W / 2 : X0 + 86;
      ops.push(function (c) { c.strokeStyle = T.orn; c.fillStyle = T.orn; c.lineWidth = 1.6; rule(c, rcx, ry, 68); });
      headerH = Math.max(headerH, ry + 10 - y);
    }
    y += headerH + (headerH ? 46 : 0);

    // --- corps du texte, avec une lettrine enluminée
    m.font = font(F, body);
    var paras = text.split('\n'), first = true, capBottom = -1, capW = 0, gapP = Math.round(LH * 0.42);
    var trimmed = text.replace(/^\s+/, '');
    var cap = /^\p{L}/u.test(trimmed) ? trimmed[0] : '';
    if (!trimmed) {
      var py = y + body;
      ops.push(function (c) { c.font = font(F, body, F.weight, true); c.fillStyle = alpha(T.ink, 0.35); c.fillText('Votre texte apparaîtra ici…', X0, py); });
      y += LH;
    }
    var blank = 0;
    for (var p = 0; p < paras.length && trimmed; p++) {
      var line = paras[p].trim();
      if (!line) { blank++; continue; }
      if (!first) y += blank ? Math.round(LH * 0.9) : gapP;
      blank = 0;
      var list = words(line);
      if (first && cap) {
        // lettrine sur 3 lignes ; le premier mot perd sa première lettre
        var capSide = Math.round(LH * 2 + body * 0.95);
        capW = capSide + 20;
        capBottom = y + capSide + 4;
        list[0] = list[0].slice(1);
        if (!list[0]) list.shift();
        var cy0 = y + 4;
        ops.push(function (c) { lettrine(c, T, F, cap, X0, cy0, capSide); });
      }
      first = false;
      m.font = font(F, body);
      var startY = y;
      var lines = wrap(m, list, function (i) {
        return startY + i * LH < capBottom ? CW - capW : CW;
      });
      lines.forEach(function (ln, i) {
        var ly = startY + i * LH + body, lx = startY + i * LH < capBottom ? X0 + capW : X0;
        ops.push(function (c) { c.font = font(F, body); c.fillStyle = T.ink; drawLine(c, ln, lx, ly, true); });
      });
      y = startY + lines.length * LH;
    }
    y = Math.max(y, capBottom);

    // --- fleuron final
    var endY = y + 54;
    ops.push(function (c) { c.strokeStyle = T.orn; c.fillStyle = T.orn; c.lineWidth = 1.6; rule(c, W / 2, endY, 90); });
    var H = Math.ceil(endY + 40 + P + B);

    // --- dessin
    var k = H > MAX_H ? MAX_H / H : 1;
    canvas.width = Math.round(W * k);
    canvas.height = Math.round(H * k);
    var c = canvas.getContext('2d');
    c.setTransform(k, 0, 0, k, 0, 0);
    c.textBaseline = 'alphabetic';
    frame(c, T, H, B);
    ops.forEach(function (op) { c.save(); op(c); c.restore(); });
    return { width: canvas.width, height: canvas.height };
  }

  function frame(c, T, H, B) {
    // bordure : la couleur du thème, un peu plus sombre en bas à droite
    var g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, mix(T.frame, '#ffffff', 0.18));
    g.addColorStop(1, mix(T.frame, T.orn, 0.12));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // filet dans la bordure
    c.strokeStyle = alpha(T.orn, 0.5);
    c.lineWidth = 1.4;
    c.strokeRect(B * 0.42, B * 0.42, W - B * 0.84, H - B * 0.84);
    c.fillStyle = alpha(T.orn, 0.65);
    [[W / 2, B * 0.42], [W / 2, H - B * 0.42], [B * 0.42, H / 2], [W - B * 0.42, H / 2]].forEach(function (p) { diamond(c, p[0], p[1], 6); });

    // la page, légèrement ombrée, plus claire au centre
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.16)';
    c.shadowBlur = 26;
    c.shadowOffsetY = 6;
    c.fillStyle = T.paper;
    c.fillRect(B, B, W - 2 * B, H - 2 * B);
    c.restore();
    var r = c.createRadialGradient(W / 2, H * 0.4, 50, W / 2, H / 2, Math.max(W, H) * 0.75);
    r.addColorStop(0, mix(T.paper, '#ffffff', 0.45));
    r.addColorStop(0.6, T.paper);
    r.addColorStop(1, mix(T.paper, T.frame, 0.35));
    c.fillStyle = r;
    c.fillRect(B, B, W - 2 * B, H - 2 * B);

    // double filet + coins enluminés
    var i1 = B + 18, i2 = B + 25;
    c.strokeStyle = alpha(T.orn, 0.55);
    c.lineWidth = 1.3;
    c.strokeRect(i1, i1, W - 2 * i1, H - 2 * i1);
    c.lineWidth = 0.7;
    c.strokeRect(i2, i2, W - 2 * i2, H - 2 * i2);
    c.strokeStyle = alpha(T.orn, 0.8);
    c.fillStyle = alpha(T.orn, 0.8);
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    [[i2, i2, 1, 1], [W - i2, i2, -1, 1], [i2, H - i2, 1, -1], [W - i2, H - i2, -1, -1]].forEach(function (q) {
      c.save(); c.translate(q[0] + 6 * q[2], q[1] + 6 * q[3]); c.scale(q[2], q[3]); corner(c, 96); c.restore();
    });
  }

  function lettrine(c, T, F, ch, x, y, s) {
    c.fillStyle = alpha(T.frame, 0.45);
    c.fillRect(x, y, s, s);
    c.strokeStyle = T.orn;
    c.lineWidth = 1.6;
    c.strokeRect(x + 0.8, y + 0.8, s - 1.6, s - 1.6);
    c.lineWidth = 0.7;
    c.strokeRect(x + 6, y + 6, s - 12, s - 12);
    c.fillStyle = T.orn;
    [[x, y], [x + s, y], [x, y + s], [x + s, y + s]].forEach(function (p) { diamond(c, p[0], p[1], 5); });
    // la lettre, centrée sur sa vraie silhouette
    var size = s * 0.78;
    c.font = font(F, size, F.title);
    var mt = c.measureText(ch);
    var asc = mt.actualBoundingBoxAscent || size * 0.7, desc = mt.actualBoundingBoxDescent || 0;
    var left = mt.actualBoundingBoxLeft || 0, right = mt.actualBoundingBoxRight || mt.width;
    c.fillStyle = mix(T.orn, T.ink, 0.25);
    c.fillText(ch, x + (s - (left + right)) / 2 + left, y + (s + asc - desc) / 2);
  }

  function stamp(c, T, F, photo, name, cx, cy, R, nameSize) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.2)';
    c.shadowBlur = 16;
    c.shadowOffsetY = 5;
    c.fillStyle = mix(T.paper, '#ffffff', 0.6);
    c.beginPath(); c.arc(cx, cy, R + 8, 0, Math.PI * 2); c.fill();
    c.restore();
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
    if (photo) c.drawImage(photo, cx - R, cy - R, 2 * R, 2 * R);
    else {
      c.fillStyle = mix(T.frame, '#ffffff', 0.3);
      c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      var ch = (name.match(/\p{L}/u) || ['?'])[0].toUpperCase();
      c.font = font(F, R * 1.05, F.title);
      c.fillStyle = T.orn;
      c.textAlign = 'center';
      var mt = c.measureText(ch), asc = mt.actualBoundingBoxAscent || R * 0.7, desc = mt.actualBoundingBoxDescent || 0;
      c.fillText(ch, cx, cy + (asc - desc) / 2);
    }
    c.restore();
    // anneaux du tampon
    c.strokeStyle = T.orn;
    c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, R + 8, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = alpha(T.orn, 0.55);
    c.lineWidth = 1.4;
    c.setLineDash([2.5, 6]);
    c.beginPath(); c.arc(cx, cy, R + 15, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    if (name) {
      c.font = font(F, nameSize, F.weight, true);
      c.fillStyle = mix(T.orn, T.ink, 0.35);
      c.textAlign = 'center';
      c.fillText(name, cx, cy + R + 26 + nameSize * 0.85);
    }
  }

  root.Letter = { render: render, loadFont: loadFont, FONTS: FONTS, THEMES: THEMES, font: font };
})(this);
