// Quartier procédural : un damier de rues à deux voies avec carrefours à feux, trottoirs,
// immeubles, maisons, arbres et lampadaires. Les tuiles et bâtiments sont des assets Kenney (CC0)
// mis à l'échelle 1 unité = 10 m, instanciés par modèle pour rester léger.
//
// Repère : x vers l'est, z vers le sud (l'avant des voitures est en -z). La tuile (i, j) a son
// centre en (tileX(i), tileZ(j)). Les rues sont sur les lignes i = road(k) et j = road(k).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const TILE = 10; // mètres par tuile
export const PERIOD = 8; // tuiles entre deux rues parallèles
export const ROADS = 6; // rues par axe → 6 × 6 carrefours
export const MARGIN = 3; // tuiles de bâti au-delà des rues extérieures
export const SIDE = MARGIN * 2 + (ROADS - 1) * PERIOD + 1; // 47 tuiles = 470 m
export const HALF_ROAD = 3.6; // demi-largeur roulable (le reste de la tuile est trottoir)
export const LANE = 2.3; // décalage de voie par rapport à l'axe de la rue

export const T = { BLOCK: 0, NS: 1, EW: 2, CROSS: 3, PARK: 4 };

export const road = (k) => MARGIN + k * PERIOD;
export const tileX = (i) => (i - SIDE / 2 + 0.5) * TILE;
export const tileZ = (j) => (j - SIDE / 2 + 0.5) * TILE;
export const tileOf = (x, z) => [Math.floor(x / TILE + SIDE / 2), Math.floor(z / TILE + SIDE / 2)];
const isRoadIndex = (i) => i >= MARGIN && i <= road(ROADS - 1) && (i - MARGIN) % PERIOD === 0;

// Générateur pseudo-aléatoire déterministe : la même ville à chaque visite.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Carte des tuiles

export function buildMap() {
  const map = new Uint8Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++) {
    for (let i = 0; i < SIDE; i++) {
      const rx = isRoadIndex(i), rz = isRoadIndex(j);
      map[j * SIDE + i] = rx && rz ? T.CROSS : rx ? T.NS : rz ? T.EW : T.BLOCK;
    }
  }
  return map;
}

export const tileAt = (map, i, j) => (i < 0 || j < 0 || i >= SIDE || j >= SIDE ? T.BLOCK : map[j * SIDE + i]);

/** La position (x, z) est-elle roulable (chaussée, hors trottoirs et bâtiments) ? */
export function isDrivable(map, x, z) {
  const [i, j] = tileOf(x, z);
  const t = tileAt(map, i, j);
  if (t === T.BLOCK || t === T.PARK) return false;
  const dx = x - tileX(i), dz = z - tileZ(j);
  if (t === T.NS) return Math.abs(dx) < HALF_ROAD;
  if (t === T.EW) return Math.abs(dz) < HALF_ROAD;
  // Carrefour : tout sauf les quarts de trottoir dans les coins.
  return !(Math.abs(dx) > HALF_ROAD && Math.abs(dz) > HALF_ROAD);
}

// ---------------------------------------------------------------------------
// Chargement et instanciation

const gltfLoader = new GLTFLoader();
const gltfCache = new Map();
function loadGltf(url) {
  if (!gltfCache.has(url)) gltfCache.set(url, new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej)));
  return gltfCache.get(url);
}

/** Regroupe toutes les poses d'un même modèle et produit un InstancedMesh par maillage. */
class Instancer {
  /**
   * @param lod  null : toujours détaillé ; { color } : au loin, remplacé par une boîte de la même
   *             emprise (12 triangles au lieu de 1 000 à 5 000) ; "hide" : masqué au loin (arbres).
   */
  constructor(url, baseScale, castShadow, lod = null) {
    this.url = url;
    this.baseScale = baseScale;
    this.castShadow = castShadow;
    this.lod = lod;
    this.matrices = [];
  }
  add(x, y, z, rotY, scale = 1) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3().setScalar(this.baseScale * scale)
    );
    this.matrices.push(m);
  }
  async build(parent) {
    const shadows = this.castShadow;
    if (!this.matrices.length) return;
    const gltf = await loadGltf(this.url);
    gltf.scene.updateMatrixWorld(true);
    // Les instances sont regroupées par secteur (cellules de ~120 m) : chaque groupe a sa propre
    // sphère englobante et sort du rendu dès qu'il est hors champ. Sans cela, toute la ville
    // (1,6 M de triangles) serait dessinée à chaque image.
    const cell = (SIDE * TILE) / 4;
    const chunks = new Map();
    const p = new THREE.Vector3();
    for (const m of this.matrices) {
      p.setFromMatrixPosition(m);
      const key = Math.floor(p.x / cell) + "," + Math.floor(p.z / cell);
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(m);
    }
    const tmp = new THREE.Matrix4();
    const chunkEntries = new Map();
    const entryFor = (key) => {
      if (!chunkEntries.has(key)) chunkEntries.set(key, { center: new THREE.Vector3(), hi: [], lo: [], mode: this.lod ? "lod" : "static" });
      return chunkEntries.get(key);
    };
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      for (const [key, list] of chunks) {
        const inst = new THREE.InstancedMesh(o.geometry, mat, list.length);
        list.forEach((m, k) => inst.setMatrixAt(k, tmp.multiplyMatrices(m, o.matrixWorld)));
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = shadows;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        parent.add(inst);
        const e = entryFor(key);
        e.hi.push(inst);
        e.center.copy(inst.boundingSphere.center);
      }
    });
    // Version lointaine : une boîte grise de la même emprise que le modèle.
    if (this.lod && this.lod.color) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
      geo.translate(center.x, center.y, center.z);
      const mat = new THREE.MeshLambertMaterial({ color: this.lod.color });
      for (const [key, list] of chunks) {
        const inst = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((m, k) => inst.setMatrixAt(k, m));
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.visible = false;
        parent.add(inst);
        entryFor(key).lo.push(inst);
      }
    }
    for (const e of chunkEntries.values()) lodChunks.push(e);
  }
}

// Secteurs à niveau de détail : mis à jour chaque image selon la distance à la caméra.
const lodChunks = [];
export function updateLOD(camPos) {
  for (const e of lodChunks) {
    const d = e.center.distanceTo(camPos) - 60; // les secteurs font ~120 m de côté
    if (e.mode === "static") {
      for (const m of e.hi) m.visible = d < 330;
      continue;
    }
    const hi = d < 130, lo = !hi && d < 330;
    for (const m of e.hi) m.visible = hi;
    for (const m of e.lo) m.visible = lo;
  }
}

const ROADS_DIR = "assets/city/roads/";
const COMM_DIR = "assets/city/commercial/";
const SUB_DIR = "assets/city/suburban/";

// Orientation des tuiles Kenney (déterminée visuellement) : la route droite court le long de z.
const ROT = { straightNS: Math.PI / 2, straightEW: 0, buildingFront: Math.PI }; // route droite le long de x à rotation 0 ; façades vers -z

/**
 * Construit le quartier dans `parent`. Renvoie la carte, la liste des carrefours et les feux.
 */
export async function buildCity(parent, { seed = 7 } = {}) {
  const map = buildMap();
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const inst = new Map();
  // Seuls les bâtiments projettent une ombre : routes, dallage, arbres et mobilier n'en ont pas besoin
  // et doubleraient le coût du rendu des ombres.
  const lodFor = (name) => {
    if (/skyscraper/.test(name)) return { color: 0x8c95a1 };
    if (/^building-type/.test(name)) return { color: 0xaeb3a9 };
    if (/^building/.test(name)) return { color: 0x9aa3ad };
    if (/^tree/.test(name)) return "hide";
    return null;
  };
  const use = (dir, name, scale = 10) => {
    const key = dir + name;
    if (!inst.has(key)) inst.set(key, new Instancer(dir + name + ".glb", scale, /^building/.test(name), lodFor(name)));
    return inst.get(key);
  };

  // Sol : une grande dalle verte sous tout le quartier.
  const groundSize = SIDE * TILE + 400;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: 0x8ea684, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  parent.add(ground);

  // Dallage des îlots (trottoir clair) : une tuile plate par tuile de bloc.
  const pavement = use(ROADS_DIR, "tile-low");

  // Rues
  for (let j = 0; j < SIDE; j++) {
    for (let i = 0; i < SIDE; i++) {
      const t = map[j * SIDE + i];
      const x = tileX(i), z = tileZ(j);
      if (t === T.NS) use(ROADS_DIR, "road-straight").add(x, 0, z, ROT.straightNS);
      else if (t === T.EW) use(ROADS_DIR, "road-straight").add(x, 0, z, ROT.straightEW);
      else if (t === T.CROSS) {
        const n = tileAt(map, i, j - 1) !== T.BLOCK, s = tileAt(map, i, j + 1) !== T.BLOCK;
        const w = tileAt(map, i - 1, j) !== T.BLOCK, e = tileAt(map, i + 1, j) !== T.BLOCK;
        const count = n + s + w + e;
        if (count === 4) use(ROADS_DIR, "road-crossroad").add(x, 0, z, 0);
        else if (count === 3) {
          // T : la branche manquante indique l'orientation.
          const missing = !n ? 0 : !e ? 1 : !s ? 2 : 3;
          use(ROADS_DIR, "road-intersection").add(x, 0, z, ROT.tee(missing));
        } else {
          // Virage : deux branches adjacentes.
          const corner = n && e ? 0 : e && s ? 1 : s && w ? 2 : 3;
          use(ROADS_DIR, "road-bend").add(x, 0, z, ROT.bend(corner));
        }
      } else {
        pavement.add(x, 0, z, 0);
      }
    }
  }

  // Îlots : rectangles de bloc entre les rues (et les marges extérieures).
  const bounds = [];
  const cuts = [0, ...Array.from({ length: ROADS }, (_, k) => road(k)), SIDE - 1];
  for (let a = 0; a < cuts.length - 1; a++) {
    for (let b = 0; b < cuts.length - 1; b++) {
      const i0 = cuts[a] + (a === 0 ? 0 : 1), i1 = cuts[a + 1] - (a + 1 === cuts.length - 1 ? 0 : 1);
      const j0 = cuts[b] + (b === 0 ? 0 : 1), j1 = cuts[b + 1] - (b + 1 === cuts.length - 1 ? 0 : 1);
      if (i1 < i0 || j1 < j0) continue;
      bounds.push({ i0, i1, j0, j1 });
    }
  }

  const center = (SIDE - 1) / 2;
  const COMMERCIAL = "abcdefghijklmn".split("").map((c) => "building-" + c);
  const SKYSCRAPERS = "abcde".split("").map((c) => "building-skyscraper-" + c);
  const HOUSES = "abcdefgh".split("").map((c) => "building-type-" + c);

  for (const b of bounds) {
    const ci = (b.i0 + b.i1) / 2, cj = (b.j0 + b.j1) / 2;
    const dist = Math.hypot(ci - center, cj - center) / center; // 0 au centre, ~1 au bord
    const district = dist < 0.3 ? "tower" : dist < 0.72 ? "commercial" : "suburb";
    const interior = new Set();

    // Périmètre : bâtiments face à la rue. On parcourt chaque bord de l'îlot.
    const edges = [
      { fixed: "j", at: b.j0, from: b.i0, to: b.i1, rot: Math.PI, faces: b.j0 > 0 }, // bord nord, façade vers -z
      { fixed: "j", at: b.j1, from: b.i0, to: b.i1, rot: 0, faces: b.j1 < SIDE - 1 }, // bord sud, façade vers +z
      { fixed: "i", at: b.i0, from: b.j0, to: b.j1, rot: -Math.PI / 2, faces: b.i0 > 0 }, // ouest, façade vers -x
      { fixed: "i", at: b.i1, from: b.j0, to: b.j1, rot: Math.PI / 2, faces: b.i1 < SIDE - 1 }, // est, façade vers +x
    ];
    const taken = new Set();
    for (const e of edges) {
      if (!e.faces) continue;
      for (let k = e.from; k <= e.to; k++) {
        const i = e.fixed === "j" ? k : e.at, j = e.fixed === "j" ? e.at : k;
        const key = i + "," + j;
        if (taken.has(key)) continue;
        // Coins : laissés au bord nord/sud, sautés sur les bords est/ouest.
        if (e.fixed === "i" && (k === e.from || k === e.to) && (b.j0 > 0 || b.j1 < SIDE - 1)) continue;
        const x = tileX(i), z = tileZ(j);
        if (district === "tower") {
          // Une tour occupe 2 × 2 tuiles ; sinon un immeuble sur 1 tuile.
          const i2 = e.fixed === "j" ? i + 1 : i + (e.at === b.i0 ? 1 : -1);
          const j2 = e.fixed === "j" ? j + (e.at === b.j0 ? 1 : -1) : j + 1;
          const canTower =
            rand() < 0.5 &&
            (e.fixed === "j" ? k + 1 <= e.to : k + 1 <= e.to) &&
            i2 >= b.i0 && i2 <= b.i1 && j2 >= b.j0 && j2 <= b.j1 &&
            !taken.has(i2 + "," + j) && !taken.has(i + "," + j2) && !taken.has(i2 + "," + j2);
          if (canTower) {
            use(COMM_DIR, pick(SKYSCRAPERS), 10).add((x + tileX(i2)) / 2, 0, (z + tileZ(j2)) / 2, e.rot + ROT.buildingFront, 1.35);
            [key, i2 + "," + j, i + "," + j2, i2 + "," + j2].forEach((kk) => taken.add(kk));
            continue;
          }
          use(COMM_DIR, pick(COMMERCIAL), 10).add(x, 0, z, e.rot + ROT.buildingFront, 1.05);
        } else if (district === "commercial") {
          use(COMM_DIR, pick(COMMERCIAL), 10).add(x, 0, z, e.rot + ROT.buildingFront, 0.98);
        } else {
          use(SUB_DIR, pick(HOUSES), 7).add(x, 0, z, e.rot + ROT.buildingFront, 1);
          if (rand() < 0.6) {
            // Un arbre devant la maison, côté rue.
            const off = 4.2;
            const tx = x + (e.fixed === "i" ? (e.at === b.i0 ? -off : off) : (rand() - 0.5) * 6);
            const tz = z + (e.fixed === "j" ? (e.at === b.j0 ? -off : off) : (rand() - 0.5) * 6);
            use(SUB_DIR, rand() < 0.5 ? "tree-large" : "tree-small", 10).add(tx, 0, tz, rand() * Math.PI * 2, 0.8 + rand() * 0.5);
          }
        }
        taken.add(key);
      }
    }
    // Intérieur de l'îlot : parc arboré (ou immeubles bas au centre-ville).
    for (let j = b.j0 + 1; j < b.j1; j++) {
      for (let i = b.i0 + 1; i < b.i1; i++) {
        const key = i + "," + j;
        if (taken.has(key)) continue;
        interior.add(key);
        map[j * SIDE + i] = T.PARK;
        const x = tileX(i) + (rand() - 0.5) * 6, z = tileZ(j) + (rand() - 0.5) * 6;
        if (district === "tower" && rand() < 0.5) use(COMM_DIR, pick(COMMERCIAL), 10).add(tileX(i), 0, tileZ(j), Math.floor(rand() * 4) * (Math.PI / 2), 0.9);
        else if (rand() < 0.35) use(SUB_DIR, rand() < 0.6 ? "tree-large" : "tree-small", 10).add(x, 0, z, rand() * Math.PI * 2, 0.9 + rand() * 0.6);
      }
    }
  }

  // Lampadaires : le long des rues, tous les 3 tuiles, en alternant les côtés.
  for (let k = 0; k < ROADS; k++) {
    const r = road(k);
    for (let m = MARGIN; m <= road(ROADS - 1); m += 3) {
      if (isRoadIndex(m)) continue;
      const side = ((m / 3) | 0) % 2 === 0 ? 1 : -1;
      use(ROADS_DIR, "light-curved", 10).add(tileX(r) + side * 4.3, 0, tileZ(m), side > 0 ? Math.PI / 2 : -Math.PI / 2);
      use(ROADS_DIR, "light-curved", 10).add(tileX(m), 0, tileZ(r) + side * 4.3, side > 0 ? 0 : Math.PI);
    }
  }

  // Carrefours et feux tricolores : un poteau à chaque coin, tourné vers le trafic qui arrive.
  const intersections = [];
  const lampMatrices = { red: [], amber: [], green: [] };
  const lampOwner = []; // pour chaque index de lampe : { inter, axis }
  for (let a = 0; a < ROADS; a++) {
    for (let bIdx = 0; bIdx < ROADS; bIdx++) {
      const i = road(a), j = road(bIdx);
      const x = tileX(i), z = tileZ(j);
      const inter = { i, j, x, z, phase: rand() * 24, ns: "green", ew: "red" };
      intersections.push(inter);
      // Quatre coins : le feu est sur le trottoir à droite de la voie qui arrive.
      // Voie arrivant du nord (roule vers +z) : coin nord-ouest, tourné vers -z (face au conducteur).
      const corners = [
        { dx: -4.4, dz: -4.4, rot: 0, axis: "ns" }, // arrivée du nord (vers +z) → à sa droite : x négatif
        { dx: 4.4, dz: 4.4, rot: Math.PI, axis: "ns" }, // arrivée du sud (vers -z)
        { dx: 4.4, dz: -4.4, rot: -Math.PI / 2, axis: "ew" }, // arrivée de l'est (vers -x)
        { dx: -4.4, dz: 4.4, rot: Math.PI / 2, axis: "ew" }, // arrivée de l'ouest (vers +x)
      ];
      for (const c of corners) {
        use(ROADS_DIR, "traffic-light", 10).add(x + c.dx, 0, z + c.dz, c.rot);
        // Tête de feu : trois lampes empilées à 4,4 m, décalée vers la chaussée.
        const head = new THREE.Vector3(x + c.dx, 4.2, z + c.dz);
        const toward = new THREE.Vector3(-c.dx, 0, -c.dz).normalize().multiplyScalar(0.55);
        head.add(toward);
        for (const [name, dy] of [["red", 0.42], ["amber", 0], ["green", -0.42]]) {
          lampMatrices[name].push(new THREE.Matrix4().compose(new THREE.Vector3(head.x, head.y + dy, head.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
          lampOwner.push({ inter, axis: c.axis, name });
        }
      }
    }
  }

  // Construction de toutes les instances (en parallèle).
  await Promise.all([...inst.values()].map((v) => v.build(parent)));

  // Têtes de feux : boîtier sombre + lampes émissives colorées par instance.
  const lampGeo = new THREE.SphereGeometry(0.16, 10, 8);
  const lamps = {};
  const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 1.35, 0.32), new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.8 }), lampMatrices.amber.length);
  lampMatrices.amber.forEach((m, k) => housing.setMatrixAt(k, m));
  housing.instanceMatrix.needsUpdate = true;
  housing.frustumCulled = false;
  parent.add(housing);
  for (const name of ["red", "amber", "green"]) {
    const mesh = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lampMatrices[name].length);
    lampMatrices[name].forEach((m, k) => mesh.setMatrixAt(k, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lampMatrices[name].length * 3), 3);
    mesh.frustumCulled = false;
    parent.add(mesh);
    lamps[name] = mesh;
  }
  const LAMP_ON = { red: new THREE.Color(0xff2a1f), amber: new THREE.Color(0xffb020), green: new THREE.Color(0x2ee06a) };
  const LAMP_OFF = new THREE.Color(0x2a2d31);

  /** Fait avancer les feux (cycle 24 s : vert 10, orange 2, rouge 12) et met à jour les lampes. */
  function stepLights(dt) {
    for (const it of intersections) {
      it.phase = (it.phase + dt) % 24;
      const p = it.phase;
      it.ns = p < 10 ? "green" : p < 12 ? "amber" : "red";
      it.ew = p < 12 ? "red" : p < 22 ? "green" : "amber";
    }
    // Chaque coin possède 3 lampes consécutives dans lampOwner (rouge, orange, vert) → même index par couleur.
    const n = lampMatrices.red.length;
    for (let k = 0; k < n; k++) {
      const owner = lampOwner[k * 3];
      const state = owner.inter[owner.axis];
      for (const name of ["red", "amber", "green"]) {
        lamps[name].setColorAt(k, state === name ? LAMP_ON[name] : LAMP_OFF);
      }
    }
    for (const name of ["red", "amber", "green"]) lamps[name].instanceColor.needsUpdate = true;
  }

  const intersectionAt = (i, j) => intersections.find((it) => it.i === i && it.j === j);

  return { map, intersections, intersectionAt, stepLights };
}

// Rotations des tuiles en T et des virages : la branche manquante / le coin déterminent l'angle.
// Convention Kenney (vérifiée à l'écran) : road-intersection a sa branche manquante vers -z
// à rotation 0 ; road-bend relie -z et +x à rotation 0.
ROT.tee = (missing) => [0, -Math.PI / 2, Math.PI, Math.PI / 2][missing];
ROT.bend = (corner) => Math.PI + [0, -Math.PI / 2, Math.PI, Math.PI / 2][corner]; // à rotation 0 le virage relie -x et +z
