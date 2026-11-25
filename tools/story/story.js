/* Story Maker : interface. 100 % local (aucune ressource externe).
   Le brouillon est gardé le temps de la session (sessionStorage) :
   il survit à un rechargement, pas à la fermeture de l'onglet. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var L = window.Letter;
  var KEY = 'story-draft';
  var JPEG_QUALITY = 0.93;
  var AVATAR = 330;           // côté de la photo du tampon (2 × rayon dans la lettre, avec marge)

  var state = { theme: 'rose', font: 'garamond', photo: null, mode: 'edit' };
  var titleInput = $('#title-input'), nameInput = $('#name'), textInput = $('#text');
  var canvas = $('#letter'), toastEl = $('#toast');

  // ---------- Thèmes et polices ----------
  var themesEl = $('#themes');
  Object.keys(L.THEMES).forEach(function (k) {
    var t = L.THEMES[k], b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', t.label);
    b.dataset.key = k;
    b.style.setProperty('--paper', t.paper);
    b.style.setProperty('--frame', t.frame);
    b.addEventListener('click', function () { state.theme = k; syncChoices(); changed(); });
    themesEl.appendChild(b);
  });

  var fontsEl = $('#fonts');
  Object.keys(L.FONTS).forEach(function (k) {
    var f = L.FONTS[k], b = document.createElement('button');
    b.type = 'button';
    b.className = 'font-chip';
    b.setAttribute('role', 'radio');
    b.dataset.key = k;
    b.innerHTML = '<b></b><span></span>';
    b.querySelector('b').textContent = 'Aa';
    b.querySelector('b').style.fontFamily = '"' + f.family + '", Georgia, serif';
    b.querySelector('span').textContent = f.label;
    b.addEventListener('click', function () { state.font = k; syncChoices(); changed(); });
    fontsEl.appendChild(b);
  });

  function syncChoices() {
    Array.prototype.forEach.call(themesEl.children, function (b) { b.setAttribute('aria-checked', b.dataset.key === state.theme ? 'true' : 'false'); });
    Array.prototype.forEach.call(fontsEl.children, function (b) { b.setAttribute('aria-checked', b.dataset.key === state.font ? 'true' : 'false'); });
    // le texte s'écrit dans la police choisie : on voit déjà le style
    textInput.style.fontFamily = '"' + L.FONTS[state.font].family + '", Georgia, serif';
    titleInput.style.fontFamily = textInput.style.fontFamily;
    grow(); // une autre police, une autre hauteur de texte
  }

  // ---------- Tampon ----------
  var photoInput = $('#photo-input'), avatarImg = $('#avatar-img');
  photoInput.addEventListener('change', function () {
    var file = photoInput.files && photoInput.files[0];
    photoInput.value = '';
    if (!file) return;
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      // recadrage carré au centre, comme une photo de profil
      var s = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
      c.width = c.height = AVATAR;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, AVATAR, AVATAR);
      URL.revokeObjectURL(url);
      setPhoto(c);
      changed();
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Photo illisible'); };
    img.src = url;
  });
  $('#btn-photo-clear').addEventListener('click', function () { setPhoto(null); changed(); });

  function setPhoto(c) {
    state.photo = c;
    $('#avatar').classList.toggle('has-photo', !!c);
    avatarImg.hidden = !c;
    if (c) avatarImg.src = c.toDataURL('image/jpeg', 0.85);
    $('#btn-photo-clear').hidden = !c;
  }

  // ---------- Texte ----------
  function grow() {
    // le champ suit la hauteur du texte ; on garde la position de défilement
    var sc = $('#edit'), top = sc.scrollTop;
    textInput.style.height = 'auto';
    textInput.style.height = Math.max(260, textInput.scrollHeight + 2) + 'px';
    sc.scrollTop = top;
  }
  function count() {
    var n = textInput.value.trim().length;
    $('#counter').textContent = n ? n.toLocaleString('fr-FR') + ' caractère' + (n > 1 ? 's' : '') : '';
  }
  [titleInput, nameInput, textInput].forEach(function (el) { el.addEventListener('input', changed); });
  textInput.addEventListener('input', function () { grow(); count(); });

  $('#btn-paste').addEventListener('click', function () {
    if (!navigator.clipboard || !navigator.clipboard.readText) { toast('Faites un appui long dans le champ puis « Coller »'); return; }
    navigator.clipboard.readText().then(function (txt) {
      if (!txt) { toast('Presse-papiers vide'); return; }
      var a = textInput.selectionStart, b = textInput.selectionEnd, v = textInput.value;
      if (document.activeElement !== textInput) { a = b = v.length; if (v && !/\n$/.test(v)) txt = '\n' + txt; }
      textInput.value = v.slice(0, a) + txt + v.slice(b);
      textInput.dispatchEvent(new Event('input'));
      toast('Texte collé');
    }).catch(function () { toast('Faites un appui long dans le champ puis « Coller »'); });
  });

  // ---------- Brouillon (session) ----------
  var saveTimer = 0;
  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 400);
    if (state.mode === 'preview') draw();
  }
  function saveDraft() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        theme: state.theme, font: state.font, title: titleInput.value, name: nameInput.value, text: textInput.value,
        photo: state.photo ? state.photo.toDataURL('image/jpeg', 0.85) : null
      }));
    } catch (e) { /* stockage plein ou interdit : tant pis, rien n'est perdu à l'écran */ }
  }
  function loadDraft() {
    var d = null;
    try { d = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { d = null; }
    if (!d) return;
    if (L.THEMES[d.theme]) state.theme = d.theme;
    if (L.FONTS[d.font]) state.font = d.font;
    titleInput.value = d.title || '';
    nameInput.value = d.name || '';
    textInput.value = d.text || '';
    if (d.photo) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = c.height = AVATAR;
        c.getContext('2d').drawImage(img, 0, 0, AVATAR, AVATAR);
        setPhoto(c);
        if (state.mode === 'preview') draw();
      };
      img.src = d.photo;
    }
  }

  // ---------- Écrire / Aperçu ----------
  function data() {
    return { theme: state.theme, font: state.font, title: titleInput.value, name: nameInput.value, text: textInput.value, photo: state.photo };
  }

  var drawJob = 0;
  function draw() {
    var id = ++drawJob, d = data();
    return L.loadFont(d.font).catch(function () { /* police absente : Georgia en secours */ }).then(function () {
      if (id === drawJob) L.render(canvas, d);
    });
  }

  function setMode(mode) {
    state.mode = mode;
    $('#edit').hidden = mode !== 'edit';
    $('#preview').hidden = mode !== 'preview';
    ['edit', 'preview'].forEach(function (m) {
      var b = $('#btn-' + m);
      b.classList.toggle('is-active', m === mode);
      b.setAttribute('aria-pressed', m === mode ? 'true' : 'false');
    });
    if (mode === 'preview') {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      $('#preview').scrollTop = 0;
      draw();
    } else grow();
  }
  $('#btn-edit').addEventListener('click', function () { setMode('edit'); });
  $('#btn-preview').addEventListener('click', function () { setMode('preview'); });

  // ---------- Export ----------
  var sheet = $('#save-sheet'), shareBtn = $('#btn-share'), downloadBtn = $('#btn-download');
  var exportFile = null, exportUrl = null;

  $('#btn-save').addEventListener('click', function () {
    if (!textInput.value.trim() && !titleInput.value.trim()) { toast('Écrivez d’abord votre texte'); return; }
    draw().then(function () {
      canvas.toBlob(function (blob) {
        if (!blob) { toast('Export impossible'); return; }
        if (exportUrl) URL.revokeObjectURL(exportUrl);
        var name = 'story-' + timestamp() + '.jpg';
        exportUrl = URL.createObjectURL(blob);
        try { exportFile = new File([blob], name, { type: 'image/jpeg' }); } catch (e) { exportFile = null; }
        $('#save-preview').src = exportUrl;
        downloadBtn.href = exportUrl;
        downloadBtn.download = name;
        var canShare = !!(exportFile && navigator.canShare && navigator.canShare({ files: [exportFile] }));
        shareBtn.hidden = !canShare;
        $('#save-hint').textContent = canShare
          ? 'Touchez « Enregistrer dans Photos » puis « Enregistrer l’image ». Vous pouvez aussi faire un appui long sur l’aperçu.'
          : 'Téléchargez le fichier, ou faites un appui long sur l’aperçu pour l’enregistrer.';
        sheet.hidden = false;
      }, 'image/jpeg', JPEG_QUALITY);
    });
  });
  shareBtn.addEventListener('click', function () {
    if (!exportFile) return;
    navigator.share({ files: [exportFile] }).then(function () {
      closeSheet();
      toast('Lettre enregistrée');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      downloadBtn.click();
    });
  });
  function closeSheet() { sheet.hidden = true; }
  $('#btn-close-sheet').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });

  function timestamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 1800);
  }

  loadDraft();
  syncChoices();
  count();
  setMode('edit');
  // l'aperçu se redessine quand une police finit d'arriver
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', function () { if (state.mode === 'preview') draw(); else grow(); });
  }
})();
