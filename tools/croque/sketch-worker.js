/* Croque-moi les seins : fait tourner le moteur hors du fil principal (l'écran reste fluide). */
'use strict';

importScripts('sketch-engine.js');

self.onmessage = function (e) {
  var m = e.data;
  try {
    var src = { data: new Uint8ClampedArray(m.buffer), w: m.w, h: m.h };
    var res = self.SketchEngine.draw(src, m.options, function (index, count, sheet) {
      // chaque passe s'affiche : on voit le croquis monter, de l'estompe aux traits
      var shot = index < count - 1 ? sheet.snapshot().buffer : null;
      self.postMessage({ type: 'layer', index: index, count: count, buffer: shot }, shot ? [shot] : []);
    });
    self.postMessage({ type: 'done', buffer: res.data.buffer }, [res.data.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
