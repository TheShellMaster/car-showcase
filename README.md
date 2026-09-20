# La Collection — dix-sept voitures en 3D et un quartier à conduire

Site statique en Three.js, sans build : trois pages HTML, du CSS et quelques modules JS.

- `index.html` — la collection : dix-sept voitures, de la Dacia Sandero à la Bugatti Chiron, dans un studio 3D.
  La voiture réagit à la souris (ou au glisser sur mobile), les sections scrollées changent la caméra et
  mettent en avant un détail (design, châssis, moteur, habitacle, fiche technique). Sélecteur de voiture
  à droite (ou en bas sur téléphone), flèches ← → au clavier.
- `drive.html` — conduite en ville avec la voiture choisie : quartier de 470 m de côté, 36 carrefours à
  feux, trafic autonome qui respecte les feux, collisions, mini-carte. Clavier sur desktop, curseur de
  direction analogique + boutons Gaz/Frein sur écran tactile. Trois caméras (poursuite, capot, cinéma).
- `status.html` — diagnostic autonome (sans CDN) : teste réseau, CDN, WebGL et compatibilité en 1 s.

Documentation complète (utilisation, architecture, déploiement, dépannage) : `docs.html`,
en ligne sur <https://theshellmaster.github.io/car-showcase/docs.html>.

Site publié : <https://theshellmaster.github.io/car-showcase/>

## Lancer en local

```bash
python3 -m http.server 8765
```

Puis ouvrir <http://localhost:8765/>. Depuis un téléphone sur le même réseau : `http://<ip-du-pc>:8765/`.

## Structure

| Fichier | Rôle |
| --- | --- |
| `cars.js` | Les dix-sept voitures : textes, fiche technique, couleur, modèle 3D, performances de conduite |
| `vehicles.js` | Chargeur commun : échelle, orientation, recoloration des modèles Quaternius et Kenney, roues animables |
| `main.js` / `styles.css` | Studio : scène, ombres, presets de caméra, sélecteur, bascule entre voitures, rotation tactile |
| `city.js` | Quartier procédural : carte de tuiles, instanciation par secteur avec niveau de détail, feux, roulabilité |
| `drive.js` / `drive.css` | Conduite : physique à pas fixe, collisions, trafic autonome, caméras, HUD, mini-carte, son, contrôles tactiles |
| `docs.html` / `docs.css` | Documentation |
| `status.html` | Diagnostic autonome : réseau, CDN, WebGL, compatibilité (aucune dépendance externe) |
| `assets/cars/` | Voitures CC0 : Quaternius (Cars Bundle) et Kenney (Car Kit) |
| `assets/city/` | City Kit Kenney (CC0) : routes, feux, lampadaires, immeubles, maisons, arbres |
| `vendor/three/` | Three.js 0.170 + Draco servis en local (même origine) |

Three.js et Draco sont servis depuis `vendor/three/` (aucune dépendance CDN) ; la police Archivo vient de
Google Fonts avec repli système. Aucun `npm install` n'est nécessaire.

## Crédits

Modèles 3D : [Quaternius](https://quaternius.com/) et [Kenney](https://kenney.nl/), licence CC0, repeints pour
la collection. Ancien modèle réaliste de la 458 Spider (`assets/ferrari.glb`) : vicent091036, CC BY 4.0.
