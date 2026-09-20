// Chargeur commun des véhicules (studio et conduite).
//
// Deux familles de modèles CC0 sont utilisées :
//  - Quaternius : matériaux séparés (peinture, vitres, phares, feux), roues avec pivot à l'origine ;
//  - Kenney : un seul matériau texturé (colormap) partagé par tout le kit, roues avec pivot correct.
// Les deux ont l'avant en +Z et la gauche en +X. Le monde du site a l'avant en -Z, donc on pivote
// de 180° et on normalise chaque voiture à sa longueur réelle, roues au sol (y = 0).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("vendor/three/examples/jsm/libs/draco/gltf/");
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
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

// ---------------------------------------------------------------------------
// Modèles réalistes (Sketchfab) : structures hétérogènes. Les roues sont retrouvées par leur nom
// (nœud ou matériau), découpées si un seul maillage contient les quatre, puis regroupées en quatre
// pivots placés au centre de chaque roue. La peinture est reconnue par le nom de son matériau.

const WHEEL_RE = /wheel|tire|tyre|(^|[^a-z])rims?([^a-z]|$)|brake|rotor|caliper|(^|[^a-z])disc([^a-z]|$)|\bfelge|\breifen|pneu|jante/i;
const NOT_WHEEL_RE = /steer|stwheel|volant|steering|spare|wheelarch|wheel_arch|wheelhouse|fender|trim|window|glass|light/i;
const PAINT_RE = /carpaint|car_paint|paint|\bbody\b|carrosserie|lack|karosserie|exterior_color/i;
const GLASS_RE = /glass|window|windshield|windscreen|vitre|verre/i;
const NOT_PAINT_RE = /interior|int_|black|chrome|plastic|trim|badge|logo|light|lamp|glass|rubber|carbon/i;

function baseName(o) {
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  return (o.name || "") + " " + (m && m.name ? m.name : "");
}

/** Découpe un maillage en morceaux par quadrant (signe de x et de z du centroïde de chaque triangle). */
function splitByQuadrant(mesh, centerX, centerZ, toModel) {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  geo.applyMatrix4(toModel);
  const pos = geo.attributes.position;
  const buckets = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const cx = (a.x + b.x + c.x) / 3 - centerX, cz = (a.z + b.z + c.z) / 3 - centerZ;
    const key = (cx >= 0 ? "R" : "L") + (cz >= 0 ? "B" : "F");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i, i + 1, i + 2);
  }
  const parts = [];
  for (const idx of buckets.values()) {
    if (idx.length < 30) continue;
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) {
      const src = geo.attributes[name];
      const arr = new src.array.constructor(idx.length * src.itemSize);
      idx.forEach((vi, k) => {
        for (let s = 0; s < src.itemSize; s++) arr[k * src.itemSize + s] = src.array[vi * src.itemSize + s];
      });
      g.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize, src.normalized));
    }
    const m = new THREE.Mesh(g, mesh.material);
    parts.push(m);
  }
  return parts;
}

function dressSketchfab(model, spec) {
  // Repère "modèle" : tout est exprimé dans l'espace de la racine du glTF.
  model.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // 0. Maillages de collision exportés par erreur : masqués. Maillages sans normales : lissés
  //    (sinon three.js les rend à facettes, ce que les reflets de la peinture rendent criant).
  // Tolérance de soudure relative à la taille du modèle (certains sont en millimètres, d'autres en mètres).
  const rawBox = new THREE.Box3().setFromObject(model);
  const weldTol = rawBox.getSize(new THREE.Vector3()).length() * 1.5e-5;
  // Coques dupliquées (exports SketchUp : une face avant et une face arrière superposées → scintillement) :
  // deux maillages de même boîte englobante et même nombre de sommets, on n'en garde qu'un.
  const seen = new Map();
  const dupes = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (/colid|collider|collision|\bcol_/i.test(baseName(o))) o.visible = false;
    if (!o.geometry.attributes.normal) {
      o.geometry = mergeVertices(o.geometry, weldTol);
      o.geometry.computeVertexNormals();
    }
    o.geometry.computeBoundingBox();
    // Boîte en espace modèle : des roues qui partagent une géométrie ne sont pas des doublons.
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const q = (v) => Math.round(v / (weldTol * 20));
    const key = [q(bb.min.x), q(bb.min.y), q(bb.min.z), q(bb.max.x), q(bb.max.y), q(bb.max.z), o.geometry.attributes.position.count].join("|");
    if (seen.has(key)) dupes.push(o);
    else seen.set(key, o);
  });
  for (const o of dupes) o.parent.remove(o);
  // 1. Roues : candidats par nom, découpe des maillages combinés.
  const candidates = [];
  model.traverse((o) => {
    if (o.isMesh && WHEEL_RE.test(baseName(o)) && !NOT_WHEEL_RE.test(baseName(o))) candidates.push(o);
  });
  const pieces = [];
  for (const o of candidates) {
    const toModel = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    const bb = new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position).applyMatrix4(toModel);
    const s = bb.getSize(new THREE.Vector3());
    const combined = s.x > size.x * 0.55 || s.z > size.z * 0.5;
    if (combined) {
      pieces.push(...splitByQuadrant(o, center.x, center.z, toModel));
    } else {
      const geo = o.geometry.clone().applyMatrix4(toModel);
      pieces.push(new THREE.Mesh(geo, o.material));
    }
    o.parent.remove(o);
  }
  // 2. Regroupement en quatre roues par quadrant.
  const groups = new Map();
  for (const p of pieces) {
    p.geometry.computeBoundingBox();
    const c = p.geometry.boundingBox.getCenter(new THREE.Vector3());
    const key = (c.x >= center.x ? "R" : "L") + (c.z >= center.z ? "B" : "F");
    if (!groups.has(key)) groups.set(key, { meshes: [], box: new THREE.Box3() });
    groups.get(key).meshes.push(p);
    groups.get(key).box.union(p.geometry.boundingBox);
  }
  const wheels = { front: [], all: [] };
  let radius = 0;
  for (const [key, g] of groups) {
    const c = g.box.getCenter(new THREE.Vector3());
    const s = g.box.getSize(new THREE.Vector3());
    // Une vraie roue est à peu près aussi haute que longue ; sinon c'est un passage de roue ou un trim.
    if (s.y < size.y * 0.15 || Math.abs(s.y - s.z) > Math.max(s.y, s.z) * 0.6) {
      g.meshes.forEach((m) => model.add(m));
      continue;
    }
    const pivot = new THREE.Group();
    pivot.position.copy(c);
    for (const m of g.meshes) {
      m.geometry.translate(-c.x, -c.y, -c.z);
      pivot.add(m);
    }
    model.add(pivot);
    pivot.rotation.order = "YXZ";
    wheels.all.push(pivot);
    // Rayon : la plus grande pièce ronde du groupe (le pneu), pas un disque ou un logo.
    let rr = 0;
    for (const m of g.meshes) {
      const ps = m.geometry.boundingBox.getSize(new THREE.Vector3());
      if (Math.abs(ps.y - ps.z) < Math.max(ps.y, ps.z) * 0.25) rr = Math.max(rr, Math.max(ps.y, ps.z) / 2);
    }
    radius = Math.max(radius, rr || Math.max(s.y, s.z) / 2);
    pivot.userData.quadrant = key;
  }
  // L'avant dépend de l'orientation déclarée du modèle ("+z" : le nez est en +z).
  const frontIsPlusZ = (spec.forward || "+z") === "+z";
  for (const p of wheels.all) {
    const isFront = frontIsPlusZ ? p.position.z > center.z : p.position.z < center.z;
    if (isFront) wheels.front.push(p);
  }

  // 3. Peinture : matériau nommé, sinon le plus étendu hors vitres/noirs.
  const areaByMat = new Map();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || GLASS_RE.test(m.name || "")) continue;
      const pos = o.geometry.attributes.position;
      if (!pos) continue;
      // Aire approximative : on échantillonne un triangle sur huit.
      let area = 0;
      const idx = o.geometry.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 24) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        if (i2 >= pos.count) break;
        tmpA.fromBufferAttribute(pos, i0);
        tmpB.fromBufferAttribute(pos, i1);
        tmpC.fromBufferAttribute(pos, i2);
        area += tmpB.sub(tmpA).cross(tmpC.sub(tmpA)).length();
      }
      areaByMat.set(m, (areaByMat.get(m) || 0) + area);
    }
  });
  let paintMat = null;
  if (spec.paintMaterial) for (const m of areaByMat.keys()) if (m.name === spec.paintMaterial) paintMat = m;
  if (!paintMat) for (const m of areaByMat.keys()) if (PAINT_RE.test(m.name || "") && !NOT_PAINT_RE.test(m.name || "")) paintMat = paintMat && areaByMat.get(paintMat) > areaByMat.get(m) ? paintMat : m;
  if (!paintMat) {
    let best = -1;
    for (const [m, a] of areaByMat) if (a > best && !NOT_PAINT_RE.test(m.name || "")) (best = a), (paintMat = m);
  }
  if (paintMat) {
    // Vernis : la peinture passe en MeshPhysicalMaterial (clearcoat), conservée sur tous ses maillages.
    // (MeshPhysicalMaterial.copy attend un matériau physique : on recopie les propriétés une à une.)
    const physical = new THREE.MeshPhysicalMaterial({
      name: paintMat.name,
      color: paintMat.color ? paintMat.color.clone() : new THREE.Color(0xffffff),
      map: paintMat.map || null,
      normalMap: paintMat.normalMap || null,
      roughnessMap: paintMat.roughnessMap || null,
      metalnessMap: paintMat.metalnessMap || null,
      aoMap: paintMat.aoMap || null,
      emissive: paintMat.emissive ? paintMat.emissive.clone() : new THREE.Color(0),
      emissiveMap: paintMat.emissiveMap || null,
      roughness: paintMat.roughness ?? 0.4,
      metalness: paintMat.metalness ?? 0.3,
      side: paintMat.side,
    });
    if (paintMat.normalScale) physical.normalScale.copy(paintMat.normalScale);
    physical.clearcoat = 1.0;
    physical.clearcoatRoughness = 0.06;
    if (spec.paint && (spec.recolor || !physical.map)) physical.color.set(spec.paint);
    // Sans texture métal/rugosité, on impose un aspect peinture ; avec, on respecte l'auteur.
    if (!physical.metalnessMap && !physical.roughnessMap) {
      physical.metalness = Math.max(physical.metalness, 0.3);
      physical.roughness = Math.min(physical.roughness, 0.35);
    }
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) o.material = o.material.map((m) => (m === paintMat ? physical : m));
      else if (o.material === paintMat) o.material = physical;
    });
    paintMat = physical;
  }
  // Les vitres deviennent teintées et brillantes.
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m && GLASS_RE.test(m.name || "") && !/light|lamp|phare/i.test(m.name || "")) {
        m.transparent = true;
        m.opacity = Math.min(m.opacity ?? 1, 0.45);
        m.roughness = 0.05;
        m.metalness = 0.5;
        m.depthWrite = false;
      }
    }
  });
  return { wheels, radius, paint: paintMat };
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

  let wheels = { front: [], all: [] };
  let materials;
  let modelWheelRadius = 0;
  if (spec.kind === "sketchfab") {
    const r = dressSketchfab(model, spec);
    wheels = r.wheels;
    materials = { paint: r.paint, accent: r.paint };
    modelWheelRadius = r.radius;
  } else {
    model.traverse((o) => {
      if (!o.isMesh) return;
      const n = (o.name + " " + (o.parent?.name || "")).toLowerCase();
      if (!n.includes("wheel")) return;
      if (spec.kind === "quaternius") recenterWheel(o);
      o.rotation.order = "YXZ"; // braquage (Y) autour de la rotation de roulement (X)
      wheels.all.push(o);
      if (n.includes("front")) wheels.front.push(o);
    });
    materials = spec.kind === "quaternius" ? dressQuaternius(model, spec) : dressKenney(model, spec);
  }

  // Normalisation : longueur réelle, avant vers -Z, roues au sol.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  // Longueur réelle, mais sans dépasser la largeur réelle : les modèles Kenney sont trapus.
  let scale = spec.length / size.z;
  if (spec.width) scale = Math.min(scale, spec.width / size.x);
  const inner = new THREE.Group();
  inner.add(model);
  model.scale.setScalar(scale);
  model.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
  // Les modèles ont l'avant en +z (retournés de 180°), sauf ceux déclarés forward: "-z".
  inner.rotation.y = spec.kind === "sketchfab" && spec.forward === "-z" ? 0 : Math.PI;

  const group = new THREE.Group();
  group.add(inner);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  const finalSize = new THREE.Vector3(size.x * scale, size.y * scale, size.z * scale);
  const wheelRadius = modelWheelRadius
    ? modelWheelRadius * scale
    : wheels.all.length
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
