# La Collection — dix-sept voitures en 3D

Site statique en Three.js, sans build : deux pages HTML, du CSS et quelques modules JS.

- `index.html` — la collection : dix-sept voitures réelles, de la Dacia Sandero à la Bugatti Chiron,
  dans un studio photo 3D. La voiture réagit à la souris (ou au glisser sur mobile), les sections
  scrollées changent la caméra et mettent en avant un détail (design, châssis, moteur, habitacle),
  puis la fiche technique. Sélecteur de voiture à droite (en bas sur téléphone), flèches ← → au clavier.
- `status.html` — diagnostic autonome (sans CDN) : teste réseau, WebGL et compatibilité en 1 s.

Documentation complète (utilisation, architecture, déploiement, dépannage) : `docs.html`,
en ligne sur <https://theshellmaster.github.io/car-showcase/docs.html>.

Site publié : <https://theshellmaster.github.io/car-showcase/>

## Lancer en local

```bash
python3 -m http.server 8765
```

Puis ouvrir <http://localhost:8765/>.

## Structure

| Fichier | Rôle |
| --- | --- |
| `cars.js` | Les dix-sept voitures : textes, fiche technique, couleur, modèle 3D, crédit |
| `vehicles.js` | Chargeur des modèles : orientation, échelle réelle, roues, peinture vernie, vitres, optiques, fusion des maillages |
| `main.js` / `styles.css` | Studio : éclairage photo, ombres, presets de caméra, sélecteur, bascule entre voitures, rotation tactile |
| `docs.html` / `docs.css` | Documentation |
| `status.html` | Diagnostic autonome (aucune dépendance externe) |
| `assets/cars/real/` | Les modèles (glTF binaire, Draco, WebP) et `credits.json` |
| `vendor/three/` | Three.js 0.170 + décodeur Draco servis en local |

Aucun `npm install` n'est nécessaire.

## Crédits

Les modèles 3D sont des créations d'artistes publiées sur [Sketchfab](https://sketchfab.com/) sous licences
Creative Commons ; le crédit et la licence de chaque modèle figurent dans la fiche technique de la voiture
et dans `assets/cars/real/credits.json`.
