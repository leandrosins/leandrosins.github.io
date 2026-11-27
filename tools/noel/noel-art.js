/* Déballe-moi sous le sapin : cadres et accessoires, dessinés par le code.
 * 100 % local : aucune image téléchargée, tout reste net quelle que soit la taille.
 *
 * Un cadre : layout(pw, ph) → { W, H, ox, oy, rot } (taille finale, coin de la photo,
 * rotation autour de son centre) ; draw(c, L, photo, opts) dessine le tout.
 * Un accessoire : boîte w × h (en unités de sa taille S), draw(c, st) dans ce repère.
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var SCRIPT = '"SM Dancing Script", "Snell Roundhand", cursive';

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
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); }
  function radial(c, x, y, r, inner, outer, fx, fy) {
    var g = c.createRadialGradient(x + (fx || 0) * r, y + (fy || 0) * r, r * 0.05, x, y, r);
    g.addColorStop(0, inner); g.addColorStop(1, outer);
    return g;
  }
  // texte qui tient dans une largeur donnée
  function fitText(c, text, x, y, maxW, size, weight, family) {
    var s = size;
    do { c.font = (weight || 600) + ' ' + s + 'px ' + family; s *= 0.94; } while (c.measureText(text).width > maxW && s > 6);
    c.fillText(text, x, y);
  }
  function photoAt(c, photo, L) {
    c.save();
    c.translate(L.ox + photo.width / 2, L.oy + photo.height / 2);
    c.rotate(L.rot);
    c.drawImage(photo, -photo.width / 2, -photo.height / 2);
    c.restore();
  }

  // Fourrure : un bord de petites boules blanches
  function fluff(c, pts, r, seed) {
    var R = rng(seed);
    c.fillStyle = '#fbfbf8';
    pts.forEach(function (p) { circle(c, p[0], p[1], r * (0.75 + 0.5 * R())); c.fill(); });
  }

  // ======================= Cadres =======================
  var FRAMES = {};

  FRAMES.aucun = {
    label: 'Aucun',
    layout: function (pw, ph) { return { W: pw, H: ph, ox: 0, oy: 0, rot: 0 }; },
    draw: function (c, L, photo) { photoAt(c, photo, L); }
  };

  // ---- Guirlande lumineuse : un fil qui festonne le long des bords
  FRAMES.guirlande = {
    label: 'Guirlande',
    layout: function (pw, ph) { return { W: pw, H: ph, ox: 0, oy: 0, rot: 0 }; },
    draw: function (c, L, photo) {
      photoAt(c, photo, L);
      var m = Math.min(L.W, L.H), ins = m * 0.035, sag = m * 0.03, step = m * 0.15;
      var COLORS = ['#ff4a4a', '#ffd23f', '#3ee07a', '#4fb3ff', '#ff6fd0'];
      var corners = [[ins, ins], [L.W - ins, ins], [L.W - ins, L.H - ins], [ins, L.H - ins]];
      var normals = [[0, 1], [-1, 0], [0, -1], [1, 0]];
      var bulbs = [], k = 0;
      c.strokeStyle = '#173a1f';
      c.lineWidth = Math.max(2, m * 0.006);
      c.lineCap = 'round';
      for (var e = 0; e < 4; e++) {
        var A = corners[e], B = corners[(e + 1) % 4], N = normals[e];
        var len = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(2, Math.round(len / step));
        for (var i = 0; i < n; i++) {
          var x0 = A[0] + (B[0] - A[0]) * i / n, y0 = A[1] + (B[1] - A[1]) * i / n;
          var x1 = A[0] + (B[0] - A[0]) * (i + 1) / n, y1 = A[1] + (B[1] - A[1]) * (i + 1) / n;
          var cx = (x0 + x1) / 2 + N[0] * sag * 2, cy = (y0 + y1) / 2 + N[1] * sag * 2;
          c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(cx, cy, x1, y1); c.stroke();
          // ampoule au creux du feston, tournée vers l'intérieur
          bulbs.push([(x0 + 2 * cx + x1) / 4, (y0 + 2 * cy + y1) / 4, Math.atan2(N[1], N[0]) - Math.PI / 2, COLORS[k++ % COLORS.length]]);
        }
      }
      var br = m * 0.022;
      // halo lumineux, puis les ampoules
      c.save();
      c.globalCompositeOperation = 'lighter';
      bulbs.forEach(function (b) {
        c.fillStyle = radial(c, b[0], b[1], br * 4.2, b[3] + '99', b[3] + '00');
        circle(c, b[0], b[1], br * 4.2); c.fill();
      });
      c.restore();
      bulbs.forEach(function (b) {
        c.save();
        c.translate(b[0], b[1]);
        c.rotate(b[2]);
        c.fillStyle = '#5b5f52';
        c.fillRect(-br * 0.45, -br * 0.2, br * 0.9, br * 0.8);
        c.beginPath();
        c.ellipse(0, br * 1.55, br * 0.78, br * 1.05, 0, 0, TAU);
        c.fillStyle = radial(c, 0, br * 1.55, br * 1.2, '#ffffff', b[3], -0.3, -0.35);
        c.fill();
        c.restore();
      });
    }
  };

  // ---- Sucre d'orge : bordure rayée rouge et blanc
  FRAMES.sucre = {
    label: 'Sucre d’orge',
    layout: function (pw, ph) {
      var t = Math.round(Math.min(pw, ph) * 0.065);
      return { W: pw + 2 * t, H: ph + 2 * t, ox: t, oy: t, rot: 0, t: t };
    },
    draw: function (c, L, photo) {
      var t = L.t, W = L.W, H = L.H;
      c.save();
      rr(c, 0, 0, W, H, t * 0.9);
      c.clip();
      c.fillStyle = '#fffaf6';
      c.fillRect(0, 0, W, H);
      c.fillStyle = '#d7192b';
      var sw = t * 0.62, gap = t * 1.25;
      for (var d = -H; d < W + H; d += gap) {
        c.beginPath();
        c.moveTo(d, 0); c.lineTo(d + sw, 0); c.lineTo(d + sw - H, H); c.lineTo(d - H, H);
        c.closePath(); c.fill();
      }
      // relief : le bâton est rond, plus clair au milieu de la bande
      var bands = [[0, 0, W, t, 0, 1], [0, H - t, W, t, 0, -1], [0, 0, t, H, 1, 0], [W - t, 0, t, H, -1, 0]];
      bands.forEach(function (b) {
        var g = b[4] ? c.createLinearGradient(b[0], 0, b[0] + b[2], 0) : c.createLinearGradient(0, b[1], 0, b[1] + b[3]);
        g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(0.42, 'rgba(255,255,255,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
        c.fillStyle = g;
        c.fillRect(b[0], b[1], b[2], b[3]);
      });
      c.restore();
      photoAt(c, photo, L);
      c.strokeStyle = '#8f0f1c';
      c.lineWidth = Math.max(2, t * 0.08);
      c.strokeRect(t, t, photo.width, photo.height);
    }
  };

  // ---- Cadeau à déballer : papier cadeau déchiré autour de la photo
  FRAMES.cadeau = {
    label: 'Cadeau',
    layout: function (pw, ph) {
      var t = Math.round(Math.min(pw, ph) * 0.12);
      return { W: pw + 2 * t, H: ph + 2 * t, ox: t, oy: t, rot: 0, t: t };
    },
    draw: function (c, L, photo) {
      var t = L.t, W = L.W, H = L.H, m = Math.min(photo.width, photo.height), R = rng(7);
      photoAt(c, photo, L);
      // bord déchiré : un contour en dents irrégulières, qui mord un peu sur la photo
      var x0 = t, y0 = t, x1 = t + photo.width, y1 = t + photo.height, step = m * 0.018, jag = m * 0.03;
      var hole = [];
      [[x0, y0, x1, y0, 0, 1], [x1, y0, x1, y1, -1, 0], [x1, y1, x0, y1, 0, -1], [x0, y1, x0, y0, 1, 0]].forEach(function (s) {
        var len = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(4, Math.round(len / step));
        for (var i = 0; i < n; i++) {
          var f = i / n, d = jag * (0.15 + 0.85 * R());
          hole.push([s[0] + (s[2] - s[0]) * f + s[4] * d, s[1] + (s[3] - s[1]) * f + s[5] * d, s[4], s[5]]);
        }
      });
      function paper(shrink) {
        c.beginPath();
        c.rect(0, 0, W, H);
        hole.forEach(function (p, i) {
          var x = p[0] - p[2] * shrink, y = p[1] - p[3] * shrink;
          if (i) c.lineTo(x, y); else c.moveTo(x, y);
        });
        c.closePath();
      }
      // envers du papier (blanc), puis le papier rouge un peu en retrait
      c.fillStyle = '#f4ece2';
      paper(0); c.fill('evenodd');
      c.save();
      paper(jag * 0.45);
      c.clip('evenodd');
      var g = c.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#c4142f'); g.addColorStop(1, '#8d0b20');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      // motif : pois dorés et petites étoiles
      var sp = t * 0.5;
      for (var yy = 0, row = 0; yy < H + sp; yy += sp, row++) {
        for (var xx = (row % 2) * sp / 2; xx < W + sp; xx += sp) {
          c.fillStyle = 'rgba(255, 214, 120, 0.85)';
          if ((row + Math.round(xx / sp)) % 3) { circle(c, xx, yy, t * 0.035); c.fill(); }
          else star(c, xx, yy, t * 0.08, 'rgba(255, 230, 160, 0.9)');
        }
      }
      // rubans verts sur le papier (haut, bas, gauche, droite)
      var rw = t * 0.46;
      c.fillStyle = '#1d7a3b';
      c.fillRect(W / 2 - rw / 2, 0, rw, H);
      c.fillRect(0, H / 2 - rw / 2, W, rw);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(W / 2 - rw / 2 + rw * 0.12, 0, rw * 0.1, H);
      c.fillRect(0, H / 2 - rw / 2 + rw * 0.12, W, rw * 0.1);
      c.restore();
      // ombre du papier sur la photo
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.35)';
      c.shadowBlur = m * 0.02;
      c.strokeStyle = 'rgba(0,0,0,0.01)';
      paper(0); c.stroke();
      c.restore();
      // le nœud, en haut au centre
      c.save();
      c.translate(W / 2, t * 0.6);
      var S = t * 2.5;
      c.scale(S, S);
      bow(c, '#1d7a3b', '#2fa255', '#0f4d24');
      c.restore();
    }
  };

  function star(c, x, y, r, color) {
    c.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4, rr2 = i % 2 ? r * 0.3 : r;
      c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
    }
    c.closePath();
    c.fillStyle = color;
    c.fill();
  }

  // ---- Polaroïd suspendu à une guirlande, avec une légende manuscrite
  FRAMES.polaroid = {
    label: 'Polaroïd',
    layout: function (pw, ph) {
      var m = Math.min(pw, ph), b = Math.round(pw * 0.055), bottom = Math.round(pw * 0.22), bg = Math.round(m * 0.1), top = Math.round(m * 0.14);
      var W = pw + 2 * b + 2 * bg, H = ph + b + bottom + bg + top;
      return { W: W, H: H, ox: bg + b, oy: top + b, rot: -0.03, b: b, bottom: bottom, bg: bg, top: top };
    },
    draw: function (c, L, photo, opts) {
      var W = L.W, H = L.H, m = Math.min(W, H), R = rng(3);
      // fond vert sapin avec des lumières floues
      c.fillStyle = radial(c, W / 2, H * 0.45, Math.max(W, H) * 0.75, '#1f5a3c', '#0b2416');
      c.fillRect(0, 0, W, H);
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 26; i++) {
        var x = R() * W, y = R() * H, r = m * (0.02 + 0.05 * R());
        var col = ['#ffcf6b', '#ff6b6b', '#ffffff', '#7ee2a8'][i % 4];
        c.fillStyle = radial(c, x, y, r, col + '55', col + '00');
        circle(c, x, y, r); c.fill();
      }
      c.restore();
      // la ficelle
      c.strokeStyle = '#d9c39a';
      c.lineWidth = Math.max(2, m * 0.005);
      c.beginPath();
      c.moveTo(0, L.top * 0.35);
      c.quadraticCurveTo(W / 2, L.top * 1.15, W, L.top * 0.35);
      c.stroke();
      // le tirage, légèrement penché
      var pw = photo.width, ph = photo.height, b = L.b;
      c.save();
      c.translate(L.ox + pw / 2, L.oy + ph / 2);
      c.rotate(L.rot);
      c.shadowColor = 'rgba(0,0,0,0.45)';
      c.shadowBlur = m * 0.035;
      c.shadowOffsetY = m * 0.012;
      c.fillStyle = '#fbfaf5';
      c.fillRect(-pw / 2 - b, -ph / 2 - b, pw + 2 * b, ph + b + L.bottom);
      c.shadowColor = 'transparent';
      c.drawImage(photo, -pw / 2, -ph / 2);
      c.strokeStyle = 'rgba(0,0,0,0.12)';
      c.lineWidth = 1;
      c.strokeRect(-pw / 2, -ph / 2, pw, ph);
      // légende
      var caption = (opts && opts.caption != null ? opts.caption : 'Joyeux Noël').trim();
      if (caption) {
        c.fillStyle = '#3a2f2a';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        fitText(c, caption, 0, ph / 2 + L.bottom * 0.52, pw * 0.92, L.bottom * 0.5, 600, SCRIPT);
      }
      // pince à linge en bois
      var cw = pw * 0.07, ch = L.top * 0.75;
      c.fillStyle = '#c99a63';
      rr(c, -cw / 2, -ph / 2 - b - ch * 0.55, cw, ch, cw * 0.2); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(-cw / 2, -ph / 2 - b - ch * 0.55 + ch * 0.45, cw, ch * 0.06);
      c.fillStyle = '#a7a9ad';
      c.fillRect(-cw * 0.55, -ph / 2 - b - ch * 0.12, cw * 1.1, ch * 0.08);
      c.restore();
    }
  };

  // ======================= Accessoires =======================
  // Chaque dessin est centré en (0, 0), en unités de la taille S de l'accessoire.
  function bow(c, mid, light, dark) {
    // deux boucles
    [-1, 1].forEach(function (s) {
      c.save();
      c.scale(s, 1);
      c.beginPath();
      c.moveTo(0, 0);
      c.bezierCurveTo(0.12, -0.32, 0.5, -0.36, 0.48, -0.08);
      c.bezierCurveTo(0.47, 0.12, 0.2, 0.1, 0, 0);
      var g = c.createLinearGradient(0, -0.3, 0, 0.1);
      g.addColorStop(0, light); g.addColorStop(1, dark);
      c.fillStyle = g; c.fill();
      c.beginPath();
      c.moveTo(0.06, -0.02);
      c.bezierCurveTo(0.16, -0.2, 0.36, -0.22, 0.38, -0.1);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 0.025; c.stroke();
      // queue en V
      c.beginPath();
      c.moveTo(0.02, 0.02);
      c.quadraticCurveTo(0.12, 0.18, 0.3, 0.33);
      c.lineTo(0.22, 0.3); c.lineTo(0.2, 0.38);
      c.quadraticCurveTo(0.06, 0.2, -0.04, 0.05);
      c.closePath();
      c.fillStyle = mid; c.fill();
      c.restore();
    });
    rr(c, -0.075, -0.07, 0.15, 0.14, 0.04);
    c.fillStyle = dark; c.fill();
    rr(c, -0.06, -0.06, 0.1, 0.06, 0.03);
    c.fillStyle = 'rgba(255,255,255,0.25)'; c.fill();
  }

  var STICKERS = {
    bonnet: {
      label: 'Bonnet', w: 1.2, h: 1.0, size: 0.45,
      draw: function (c) {
        c.beginPath();
        c.moveTo(-0.46, 0.24);
        c.bezierCurveTo(-0.42, -0.22, -0.02, -0.5, 0.3, -0.36);
        c.bezierCurveTo(0.46, -0.28, 0.5, -0.14, 0.46, -0.04);
        c.bezierCurveTo(0.36, -0.16, 0.2, -0.18, 0.14, -0.04);
        c.bezierCurveTo(0.2, 0.06, 0.38, 0.12, 0.46, 0.24);
        c.closePath();
        var g = c.createLinearGradient(-0.4, -0.4, 0.4, 0.3);
        g.addColorStop(0, '#ef3340'); g.addColorStop(1, '#a10f1c');
        c.fillStyle = g; c.fill();
        c.beginPath();
        c.moveTo(-0.2, 0.2); c.bezierCurveTo(-0.15, -0.05, 0.02, -0.25, 0.22, -0.3);
        c.strokeStyle = 'rgba(80,0,10,0.35)'; c.lineWidth = 0.03; c.stroke();
        // bande de fourrure
        rr(c, -0.56, 0.16, 1.12, 0.26, 0.13);
        c.fillStyle = '#f6f5f1'; c.fill();
        var pts = [];
        for (var i = 0; i <= 14; i++) { var x = -0.52 + i * 1.04 / 14; pts.push([x, 0.18]); pts.push([x, 0.4]); }
        fluff(c, pts, 0.05, 11);
        c.fillStyle = 'rgba(0,0,0,0.08)';
        rr(c, -0.54, 0.31, 1.08, 0.1, 0.05); c.fill();
        // pompon
        c.fillStyle = radial(c, 0.47, -0.03, 0.15, '#ffffff', '#dcdad3', -0.3, -0.3);
        circle(c, 0.47, -0.03, 0.13); c.fill();
        var pp = [];
        for (var k = 0; k < 10; k++) pp.push([0.47 + Math.cos(k / 10 * TAU) * 0.11, -0.03 + Math.sin(k / 10 * TAU) * 0.11]);
        fluff(c, pp, 0.045, 5);
      }
    },
    barbe: {
      label: 'Barbe', w: 1.3, h: 1.3, size: 0.4,
      draw: function (c) {
        var R = rng(21);
        c.fillStyle = '#e6e4de';
        for (var i = 0; i <= 18; i++) {
          var a = Math.PI * (0.02 + 0.96 * i / 18), x = -Math.cos(a) * 0.42, y = -0.28 + Math.sin(a) * 0.72;
          circle(c, x, y + 0.01, 0.17 + 0.05 * R()); c.fill();
        }
        c.fillStyle = '#fbfbf8';
        circle(c, 0, 0.1, 0.3); c.fill();
        R = rng(21);
        for (var j = 0; j <= 18; j++) {
          var a2 = Math.PI * (0.02 + 0.96 * j / 18);
          circle(c, -Math.cos(a2) * 0.42, -0.3 + Math.sin(a2) * 0.7, 0.15 + 0.05 * R()); c.fill();
        }
        // moustache
        [-1, 1].forEach(function (s) {
          c.save(); c.scale(s, 1);
          c.beginPath();
          c.moveTo(0, -0.3);
          c.bezierCurveTo(0.12, -0.42, 0.34, -0.38, 0.4, -0.22);
          c.bezierCurveTo(0.3, -0.27, 0.16, -0.22, 0, -0.18);
          c.closePath();
          c.fillStyle = '#ffffff'; c.fill();
          c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 0.015; c.stroke();
          c.restore();
        });
        c.strokeStyle = 'rgba(0,0,0,0.07)';
        c.lineWidth = 0.02;
        for (var k = 0; k < 7; k++) { c.beginPath(); c.moveTo(-0.25 + k * 0.08, -0.05); c.quadraticCurveTo(-0.2 + k * 0.07, 0.2, -0.12 + k * 0.04, 0.38); c.stroke(); }
      }
    },
    bois: {
      label: 'Bois de renne', w: 1.3, h: 0.9, size: 0.55,
      draw: function (c) {
        c.lineCap = 'round';
        c.lineJoin = 'round';
        function antler() {
          c.beginPath();
          c.moveTo(-0.18, 0.36);
          c.bezierCurveTo(-0.3, 0.1, -0.36, -0.12, -0.5, -0.38);
          c.moveTo(-0.27, 0.12); c.quadraticCurveTo(-0.16, -0.02, -0.14, -0.2);
          c.moveTo(-0.36, -0.1); c.quadraticCurveTo(-0.5, -0.12, -0.6, -0.2);
          c.moveTo(-0.43, -0.25); c.quadraticCurveTo(-0.34, -0.33, -0.32, -0.42);
        }
        [-1, 1].forEach(function (s) {
          c.save(); c.scale(s, 1);
          antler(); c.strokeStyle = '#4a2c14'; c.lineWidth = 0.09; c.stroke();
          antler(); c.strokeStyle = '#9a6533'; c.lineWidth = 0.06; c.stroke();
          antler(); c.strokeStyle = 'rgba(255,230,190,0.35)'; c.lineWidth = 0.015; c.stroke();
          c.restore();
        });
        // serre-tête
        c.beginPath();
        c.moveTo(-0.3, 0.42); c.quadraticCurveTo(0, 0.26, 0.3, 0.42);
        c.strokeStyle = '#3a2412'; c.lineWidth = 0.05; c.stroke();
      }
    },
    nez: {
      label: 'Nez rouge', w: 0.32, h: 0.32, size: 0.12,
      draw: function (c) {
        c.fillStyle = radial(c, 0, 0, 0.15, '#ff6b6b', '#b30a12', -0.35, -0.35);
        circle(c, 0, 0, 0.15); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.beginPath(); c.ellipse(-0.05, -0.06, 0.04, 0.025, -0.6, 0, TAU); c.fill();
      }
    },
    chaussette: {
      label: 'Chaussette', w: 0.66, h: 1.05, size: 0.35,
      draw: function (c) {
        c.beginPath();
        c.moveTo(-0.22, -0.32);
        c.lineTo(-0.22, 0.12);
        c.bezierCurveTo(-0.22, 0.44, 0.06, 0.5, 0.24, 0.42);
        c.bezierCurveTo(0.38, 0.35, 0.34, 0.14, 0.18, 0.12);
        c.lineTo(0.17, -0.32);
        c.closePath();
        var g = c.createLinearGradient(-0.25, 0, 0.3, 0);
        g.addColorStop(0, '#e3263a'); g.addColorStop(1, '#a00f1f');
        c.fillStyle = g; c.fill();
        // talon et pointe
        c.save(); c.clip();
        c.fillStyle = '#f3efe6';
        circle(c, -0.22, 0.34, 0.14); c.fill();
        circle(c, 0.34, 0.33, 0.12); c.fill();
        star(c, -0.02, -0.08, 0.08, 'rgba(255,255,255,0.85)');
        star(c, 0.07, 0.14, 0.06, 'rgba(255,255,255,0.7)');
        c.restore();
        // revers de fourrure
        rr(c, -0.29, -0.5, 0.53, 0.2, 0.08);
        c.fillStyle = '#f6f5f1'; c.fill();
        var pts = [];
        for (var i = 0; i <= 8; i++) { pts.push([-0.27 + i * 0.49 / 8, -0.49]); pts.push([-0.27 + i * 0.49 / 8, -0.31]); }
        fluff(c, pts, 0.04, 4);
        // boucle d'accroche
        c.beginPath(); c.ellipse(-0.24, -0.53, 0.05, 0.07, 0, 0, TAU);
        c.strokeStyle = '#c71c2e'; c.lineWidth = 0.025; c.stroke();
      }
    },
    gui: {
      label: 'Gui', w: 0.95, h: 0.85, size: 0.35,
      draw: function (c) {
        function leaf(x, y, a, l) {
          c.save(); c.translate(x, y); c.rotate(a);
          c.beginPath();
          c.moveTo(0, 0);
          c.bezierCurveTo(l * 0.3, -l * 0.28, l * 0.85, -l * 0.18, l, 0);
          c.bezierCurveTo(l * 0.85, l * 0.18, l * 0.3, l * 0.28, 0, 0);
          var g = c.createLinearGradient(0, -l * 0.2, 0, l * 0.2);
          g.addColorStop(0, '#5fae4c'); g.addColorStop(1, '#2d6b2b');
          c.fillStyle = g; c.fill();
          c.beginPath(); c.moveTo(0, 0); c.lineTo(l * 0.9, 0);
          c.strokeStyle = 'rgba(220,255,200,0.35)'; c.lineWidth = 0.012; c.stroke();
          c.restore();
        }
        c.strokeStyle = '#6b5a2e'; c.lineWidth = 0.03; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, -0.22); c.lineTo(0, 0.05); c.stroke();
        leaf(0, 0.02, 2.4, 0.45); leaf(0, 0.02, 0.74, 0.45);
        leaf(0, 0.0, 1.9, 0.38); leaf(0, 0.0, 1.24, 0.38);
        [[-0.05, 0.08], [0.05, 0.09], [0, 0.15], [-0.09, 0.15], [0.09, 0.16]].forEach(function (p) {
          c.fillStyle = radial(c, p[0], p[1], 0.05, '#ffffff', '#cfd6c8', -0.4, -0.4);
          circle(c, p[0], p[1], 0.045); c.fill();
        });
        c.save(); c.translate(0, -0.27); c.scale(0.55, 0.55); bow(c, '#d4202f', '#f04656', '#8e0d18'); c.restore();
      }
    },
    noeud: {
      label: 'Nœud', w: 1.0, h: 0.8, size: 0.35,
      draw: function (c) { bow(c, '#d4202f', '#f04656', '#8e0d18'); }
    },
    etiquette: {
      label: 'Étiquette', w: 1.0, h: 0.6, size: 0.42, text: true,
      draw: function (c, st) {
        // ficelle
        c.beginPath(); c.moveTo(-0.33, 0); c.bezierCurveTo(-0.45, -0.1, -0.45, -0.25, -0.5, -0.3);
        c.strokeStyle = '#b9332f'; c.lineWidth = 0.02; c.stroke();
        c.beginPath();
        c.moveTo(-0.42, -0.22); c.lineTo(0.47, -0.22); c.lineTo(0.47, 0.22); c.lineTo(-0.42, 0.22); c.lineTo(-0.5, 0.1); c.lineTo(-0.5, -0.1);
        c.closePath();
        var g = c.createLinearGradient(0, -0.22, 0, 0.22);
        g.addColorStop(0, '#e7c99b'); g.addColorStop(1, '#cfa874');
        c.fillStyle = g; c.fill();
        c.strokeStyle = 'rgba(90,55,20,0.45)'; c.lineWidth = 0.012; c.stroke();
        circle(c, -0.38, 0, 0.035);
        c.fillStyle = '#f7f1e6'; c.fill();
        c.strokeStyle = 'rgba(90,55,20,0.6)'; c.stroke();
        c.fillStyle = '#5a2f17';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        // texte dessiné à ×200 puis réduit : une police de 0,2 px se rend mal
        c.save();
        c.scale(0.005, 0.005);
        fitText(c, (st && st.text) || 'À déballer', 12, 2, 148, 44, 700, SCRIPT);
        c.restore();
      }
    }
  };

  root.NoelArt = { FRAMES: FRAMES, STICKERS: STICKERS, SCRIPT: SCRIPT };
})(this);
