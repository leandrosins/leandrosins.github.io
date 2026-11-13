# leandrosins.github.io

**Leandro's tools** — une série de petits outils qui tournent entièrement dans le navigateur,
pensés pour le smartphone (iOS en priorité). Aucune dépendance externe : pas de CDN, pas de
police distante, pas de requête réseau. Une fois la page visitée, le site fonctionne hors ligne
(service worker) et peut être ajouté à l'écran d'accueil.

## Outils

| Outil | Dossier | Description |
| --- | --- | --- |
| Easy Retouche-moi | `tools/retouche/` | Flouter / pixeliser une zone, coller un émoji, apposer un tampon texte, enregistrer dans Photos. |

## Structure

```
index.html              Accueil
manifest.webmanifest    Manifeste (installation sur l'écran d'accueil)
sw.js                   Service worker (cache hors ligne)
assets/                 CSS, JS et icônes partagés
tools/<outil>/          Un dossier autonome par outil
```

## Ajouter un outil

1. Créer `tools/<nom>/index.html` (+ CSS/JS locaux).
2. Ajouter une carte dans `index.html`.
3. Ajouter ses fichiers à la liste `FILES` de `sw.js` et incrémenter `VERSION`.

## Tester en local

```bash
python -m http.server 8765
```

Puis ouvrir http://localhost:8765.
