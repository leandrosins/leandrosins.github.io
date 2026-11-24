/* Accueil : groupes dépliables. L'état est retenu le temps de la session,
   pour retrouver le groupe ouvert en revenant d'un outil. */
(function () {
  'use strict';

  var KEY = 'home-open-groups';

  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save(state) {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* navigation privée */ }
  }

  var state = load();
  Array.prototype.forEach.call(document.querySelectorAll('.tool-group'), function (group) {
    var toggle = group.querySelector('.group-toggle');
    var links = group.querySelectorAll('.group-panel a');

    function set(open) {
      group.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      // fermé : les outils cachés ne sont pas atteignables au clavier
      Array.prototype.forEach.call(links, function (a) { a.tabIndex = open ? 0 : -1; });
    }

    set(!!state[group.id]);
    toggle.addEventListener('click', function () {
      var open = !group.classList.contains('is-open');
      set(open);
      state[group.id] = open;
      save(state);
    });
  });
})();
