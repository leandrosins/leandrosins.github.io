/* Impressionne-moi le corps : fait tourner le moteur hors du fil principal (l'écran reste fluide). */
'use strict';

importScripts('paint-engine.js');

self.onmessage = function (e) {
  var m = e.data;
  try {
    var src = { data: new Uint8ClampedArray(m.buffer), w: m.w, h: m.h };
    var res = self.PaintEngine.paint(src, m.options, function (index, count, surface) {
      // chaque passe s'affiche : on voit le tableau se peindre, du grossier au fin
      var shot = index < count - 1 ? surface.snapshot().buffer : null;
      self.postMessage({ type: 'layer', index: index, count: count, buffer: shot }, shot ? [shot] : []);
    });
    self.postMessage({ type: 'done', buffer: res.data.buffer }, [res.data.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
