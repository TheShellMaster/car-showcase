# 458 Spider — studio interactif et simulateur d'autoroute

Site statique en Three.js, sans build : deux pages HTML, du CSS et deux modules JS.

- `index.html` — studio : la voiture réagit à la souris (ou au glisser sur mobile), les sections
  scrollées changent la caméra et mettent en avant un détail (aéro, jantes, arrière, vue de dessus, fiche technique).
- `drive.html` — conduite libre sur une autoroute générique à trois voies : clavier sur desktop,
  curseur de direction analogique + boutons Gaz/Frein sur écran tactile. Trois caméras (poursuite, capot, cinéma).

## Lancer en local

```bash
python3 -m http.server 8765
```

Puis ouvrir <http://localhost:8765/>. Depuis un téléphone sur le même réseau : `http://<ip-du-pc>:8765/`.

## Structure

| Fichier | Rôle |
| --- | --- |
| `main.js` / `styles.css` | Studio : scène, matériaux, presets de caméra, rotation tactile |
| `drive.js` / `drive.css` | Simulateur : physique à pas fixe, route infinie, caméras, HUD, son moteur synthétisé, contrôles tactiles |
| `assets/ferrari.glb` | Modèle Draco-compressé (exemple three.js, © vicent091036, CC BY 4.0) |

Three.js est chargé depuis un CDN via import map ; aucun `npm install` n'est nécessaire.
