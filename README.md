# 458 Spider — studio interactif et simulateur d'autoroute

Site statique en Three.js, sans build : HTML, CSS et modules JS, modèle Draco.

- `index.html` — studio : la voiture réagit à la souris (ou au glisser sur mobile), les sections
  scrollées changent la caméra et mettent en avant un détail (aéro, jantes, arrière, vue de dessus, fiche technique).
- `drive.html` — conduite libre sur une autoroute générique à trois voies : clavier sur desktop,
  curseur de direction analogique + boutons Gaz/Frein sur écran tactile. Trois caméras (poursuite, capot, cinéma).
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
| `main.js` / `styles.css` | Studio : scène, matériaux, presets de caméra, rotation tactile |
| `docs.html` / `docs.css` | Documentation |
| `status.html` | Diagnostic autonome : réseau, CDN, WebGL, compatibilité (aucune dépendance externe) |
| `drive.js` / `drive.css` | Simulateur : physique à pas fixe, route infinie, caméras, HUD, son moteur synthétisé, contrôles tactiles |
| `assets/ferrari.glb` | Modèle Draco-compressé 759 Ko (1,6 Mo avant optimisation, original en `assets/ferrari.original.glb` hors dépôt) — © vicent091036, CC BY 4.0 |
| `vendor/three/` | Three.js 0.170 + Draco servis en local (même origine) |

Three.js et Draco sont servis depuis `vendor/three/` (aucune dépendance CDN) ; la police Archivo vient de Google Fonts avec repli système. Aucun `npm install` n'est nécessaire.
