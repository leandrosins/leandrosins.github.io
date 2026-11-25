/* Enigme-moi sur le visage : fait tourner le moteur hors du fil principal (l'écran reste fluide). */
'use strict';

importScripts('secret-engine.js');

self.onmessage = function (e) {
  var m = e.data;
  try {
    var src = { data: new Uint8ClampedArray(m.buffer), w: m.w, h: m.h };
    var res = self.SecretEngine.process(src, m.key, m.decode, function (index, count) {
      self.postMessage({ type: 'step', index: index, count: count });
    });
    self.postMessage({ type: 'done', buffer: res.buffer }, [res.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
