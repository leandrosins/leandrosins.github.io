// Enregistre le service worker pour que le site fonctionne hors ligne.
(function () {
  if (!('serviceWorker' in navigator)) return;
  // Le script est inclus depuis la racine ou depuis /tools/xxx/ : on retrouve la racine
  // du site à partir de l'URL de ce script.
  var me = document.currentScript && document.currentScript.src;
  var root = me ? me.replace(/assets\/js\/register-sw\.js.*$/, '') : '/';
  window.addEventListener('load', function () {
    navigator.serviceWorker.register(root + 'sw.js', { scope: root }).then(function () {
      var badge = document.getElementById('offline-badge');
      if (badge) badge.classList.add('is-ready');
    }).catch(function () { /* hors https / file:// : pas grave */ });
  });
})();
