// Chargeur commun des véhicules (studio et conduite).
//
// Deux familles de modèles CC0 sont utilisées :
//  - Quaternius : matériaux séparés (peinture, vitres, phares, feux), roues avec pivot à l'origine ;
//  - Kenney : un seul matériau texturé (colormap) partagé par tout le kit, roues avec pivot correct.
// Les deux ont l'avant en +Z et la gauche en +X. Le monde du site a l'avant en -Z, donc on pivote
// de 180° et on normalise chaque voiture à sa longueur réelle, roues au sol (y = 0).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const gltfLoader = new GLTFLoader();
const cache = new Map();

function loadGltf(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      new Promise((resolve, reject) => gltfLoader.load(url, resolve, undefined, reject))
    );
  }
  return cache.get(url);
}

// Matériaux communs, pour que toutes les voitures partagent le même rendu de peinture.

export function paintMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    metalness: 0.35,
    roughness: 0.32,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
}

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x1d2733,
  metalness: 0.6,
  roughness: 0.05,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.85,
});
const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.2, roughness: 0.7 });
const greyMaterial = new THREE.MeshStandardMaterial({ color: 0x8e949c, metalness: 0.9, roughness: 0.35 });
const headlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xf4f7ff,
  emissive: 0xdde6ff,
  emissiveIntensity: 0.35,
  roughness: 0.2,
});
const taillightMaterial = new THREE.MeshStandardMaterial({
  color: 0xb3111b,
  emissive: 0xff1a1a,
  emissiveIntensity: 0.25,
  roughness: 0.3,
});

const QUATERNIUS_FIXED = {
  Windows: glassMaterial,
  Black: darkMaterial,
  Grey: greyMaterial,
  Headlights: headlightMaterial,
  TailLights: taillightMaterial,
};

// Remplace les matériaux Quaternius : peinture (+ accent) en MeshPhysical, le reste par nos matériaux.
function dressQuaternius(root, spec) {
  const paint = paintMaterial(spec.paint);
  const accent = spec.accent ? paintMaterial(spec.accent) : paint;
  let paintSeen = false;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m) => {
      const name = m.name || "";
      if (QUATERNIUS_FIXED[name]) return QUATERNIUS_FIXED[name];
      if (/^Material/.test(name)) return darkMaterial;
      // Premier matériau libre = peinture principale, le suivant = accent.
      if (!paintSeen) {
        paintSeen = true;
        return paint;
      }
      return accent;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });
  return { paint, accent };
}

// Kenney : un seul mesh "body" texturé. On sépare les triangles dont la couleur d'atlas est la
// peinture d'origine (la couleur dominante par surface) pour leur donner notre matériau de peinture.
const colormapPixels = new Map();
// L'atlas dessiné sur un canvas est dans le sens des UV glTF (origine en haut) : pas de retournement.
const FLIP_ATLAS_V = false;
function pixelsOf(texture) {
  const img = texture.image;
  const key = img.src || img;
  if (!colormapPixels.has(key)) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // GLTFLoader décode les images en ImageBitmap déjà retournées verticalement (puis flipY = false) ;
    // avec un HTMLImageElement (repli TextureLoader) l'image est dans le sens glTF, origine en haut.
    const flipped = FLIP_ATLAS_V;
    colormapPixels.set(key, { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, flipped });
  }
  return colormapPixels.get(key);
}

function sampleAtlas(px, u, v) {
  const x = Math.min(px.w - 1, Math.max(0, Math.floor((u % 1 + 1) % 1 * px.w)));
  const vv = px.flipped ? 1 - v : v;
  const y = Math.min(px.h - 1, Math.max(0, Math.floor((vv % 1 + 1) % 1 * px.h)));
  const i = (y * px.w + x) * 4;
  return [px.data[i], px.data[i + 1], px.data[i + 2]];
}

// Teinte (0–360) et saturation (0–1) d'une couleur RVB, pour regrouper les dégradés d'une même case.
function hueSat([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const sat = max === 0 ? 0 : d / max;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, sat, lum: max / 255 };
}

function splitKenneyBody(mesh, spec) {
  // Copie : la géométrie d'origine est partagée par toutes les instances du même modèle.
  const geo = mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.toNonIndexed();
  const baseMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!baseMat.map || !baseMat.map.image) return;
  const px = pixelsOf(baseMat.map);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const index = geo.index ? Array.from(geo.index.array) : Array.from({ length: pos.count }, (_, i) => i);

  // Couleur d'atlas et aire par triangle.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const tris = [];
  const areaByColor = new Map();
  for (let i = 0; i < index.length; i += 3) {
    const [i0, i1, i2] = [index[i], index[i + 1], index[i + 2]];
    const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
    const v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
    const { h, sat, lum } = hueSat(sampleAtlas(px, u, v));
    // Regroupe par teinte (cases de 20°) ; les gris (vitres, pneus, chromes) sont hors jeu.
    const key = sat > 0.25 && lum > 0.15 ? Math.round(h / 20) : -1;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    const area = b.sub(a).cross(c.sub(a)).length() * 0.5;
    tris.push({ i0, i1, i2, key });
    if (key >= 0) areaByColor.set(key, (areaByColor.get(key) || 0) + area);
  }
  // La peinture est la teinte qui couvre la plus grande surface.
  let paintKey = null, best = -1;
  areaByColor.forEach((area, key) => {
    if (area > best) {
      best = area;
      paintKey = key;
    }
  });
  const near = (k) => k >= 0 && paintKey !== null && Math.min(Math.abs(k - paintKey), 18 - Math.abs(k - paintKey)) <= 1;
  const paintIdx = [], restIdx = [];
  for (const t of tris) (near(t.key) ? paintIdx : restIdx).push(t.i0, t.i1, t.i2);
  geo.setIndex([...paintIdx, ...restIdx]);
  geo.clearGroups();
  geo.addGroup(0, paintIdx.length, 0);
  geo.addGroup(paintIdx.length, restIdx.length, 1);
  mesh.geometry = geo;
  const paint = paintMaterial(spec.paint);
  const rest = baseMat.clone();
  rest.roughness = 0.6;
  rest.metalness = 0.05;
  mesh.material = [paint, rest];
  return paint;
}

function dressKenney(root, spec) {
  let paint = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (/^wheel/.test(o.name) || /^wheel/.test(o.parent?.name || "")) return;
    const p = splitKenneyBody(o, spec);
    if (p && !paint) paint = p;
  });
  return { paint, accent: paint };
}

// Recentre la géométrie d'une roue sur son propre pivot pour pouvoir la faire tourner.
function recenterWheel(mesh) {
  mesh.geometry = mesh.geometry.clone();
  mesh.geometry.computeBoundingBox();
  const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
  mesh.geometry.translate(-center.x, -center.y, -center.z);
  mesh.position.add(center);
}

/**
 * Charge et prépare un véhicule.
 * @param {object} spec  { src, kind: "quaternius"|"kenney", length, paint, accent? }
 * @returns {Promise<{group, wheels:{front:THREE.Object3D[], all:THREE.Object3D[]}, size:THREE.Vector3, materials}>}
 */
export async function loadVehicle(spec) {
  const gltf = await loadGltf(spec.src);
  const model = gltf.scene.clone(true);
  // Chaque instance a ses propres matériaux et géométries de roues.
  model.traverse((o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });

  const wheels = { front: [], all: [] };
  model.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.name + " " + (o.parent?.name || "")).toLowerCase();
    if (!n.includes("wheel")) return;
    if (spec.kind === "quaternius") recenterWheel(o);
    o.rotation.order = "YXZ"; // braquage (Y) autour de la rotation de roulement (X)
    wheels.all.push(o);
    if (n.includes("front")) wheels.front.push(o);
  });

  const materials = spec.kind === "quaternius" ? dressQuaternius(model, spec) : dressKenney(model, spec);

  // Normalisation : longueur réelle, avant vers -Z, roues au sol.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = spec.length / size.z;
  const inner = new THREE.Group();
  inner.add(model);
  model.scale.setScalar(scale);
  model.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
  inner.rotation.y = Math.PI;

  const group = new THREE.Group();
  group.add(inner);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  const finalSize = new THREE.Vector3(size.x * scale, size.y * scale, size.z * scale);
  const wheelRadius = wheels.all.length
    ? (() => {
        wheels.all[0].geometry.computeBoundingBox();
        const s = wheels.all[0].geometry.boundingBox.getSize(new THREE.Vector3());
        return (Math.max(s.y, s.z) / 2) * scale;
      })()
    : 0.33;

  return { group, wheels, size: finalSize, materials, wheelRadius, scale };
}

/** Fait tourner les roues et braque les roues avant (angle en radians). */
export function animateWheels(vehicle, distanceDelta, steer) {
  if (!vehicle) return;
  const dTheta = vehicle.wheelRadius > 0 ? distanceDelta / vehicle.wheelRadius : 0;
  for (const w of vehicle.wheels.all) w.rotation.x -= dTheta;
  for (const w of vehicle.wheels.front) w.rotation.y = -steer;
}
