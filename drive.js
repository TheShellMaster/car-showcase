import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// ---------------------------------------------------------------------------
// DOM

const canvas = document.getElementById("scene");
const loaderBar = document.getElementById("loader-bar");
const loaderText = document.getElementById("loader-text");
const startEl = document.getElementById("start");
const hudSpeed = document.getElementById("hud-speed");
const hudGear = document.getElementById("hud-gear");
const hudRpm = document.getElementById("hud-rpm");
const soundToggle = document.getElementById("sound-toggle");
const cameraToggle = document.getElementById("camera-toggle");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;

// ---------------------------------------------------------------------------
// Road layout (metres). The car drives on the right carriageway, nose towards -z.

const ROAD = {
  textureWidth: 32,
  dashPeriod: 13,
  medianHalf: 1.5,
  barrierHalf: 0.3,
  innerShoulder: 1.0,
  laneWidth: 3.5,
  lanes: 3,
  outerShoulder: 3.0,
};
ROAD.carriagewayOuter = ROAD.medianHalf + ROAD.innerShoulder + ROAD.laneWidth * ROAD.lanes + ROAD.outerShoulder; // 16
ROAD.railX = ROAD.carriagewayOuter - 0.35;
ROAD.laneCenter = (i) => ROAD.medianHalf + ROAD.innerShoulder + ROAD.laneWidth * (i + 0.5);

const CAR = {
  halfWidth: 0.95,
  wheelbase: 2.65,
  wheelRadius: 0.36,
  vmax: 89, // m/s, about 320 km/h
  reverseMax: 8,
};

// ---------------------------------------------------------------------------
// Renderer, scene, camera

// Fail loudly instead of leaving the loader on screen forever.
const fail = (message) => {
  loaderText.textContent = message;
  loaderBar.style.width = "0%";
};
window.addEventListener("error", (e) => fail("Une erreur a interrompu la conduite : " + (e.message || "erreur inconnue") + ". Voir la page Documentation, section Dépannage."), { once: true });
const probe = document.createElement("canvas");
if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
  throw new Error("WebGL n'est pas disponible sur ce navigateur");
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const fogColor = new THREE.Color(0xdfe3e8);
scene.fog = new THREE.Fog(fogColor, 120, 900);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 2000);

// Sky dome with a vertical gradient; follows the camera so it never ends.
const sky = (() => {
  const geo = new THREE.SphereGeometry(1500, 32, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x9fb1c8);
  const horizon = fogColor;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 1500, 0, 1);
    c.copy(horizon).lerp(top, Math.pow(t, 0.6));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false }));
  scene.add(mesh);
  return mesh;
})();

// Lights

scene.add(new THREE.HemisphereLight(0xcfd8e3, 0x6f7a66, 0.6));

const sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 120;
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);
const sunOffset = new THREE.Vector3(18, 32, 14);

// ---------------------------------------------------------------------------
// Procedural textures

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function noiseFill(ctx, w, h, base, amount, count) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = (Math.random() - 0.5) * amount;
    ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v)})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function roadTexture() {
  const pxPerM = 64;
  const w = ROAD.textureWidth * pxPerM;
  const h = ROAD.dashPeriod * pxPerM;
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  noiseFill(ctx, w, h, "#4a4c50", 0.22, 26000);

  const xToPx = (x) => (x + ROAD.textureWidth / 2) * pxPerM;

  // Median: lighter concrete.
  ctx.fillStyle = "#9c9d99";
  ctx.fillRect(xToPx(-ROAD.medianHalf), 0, ROAD.medianHalf * 2 * pxPerM, h);

  const lineW = 0.15 * pxPerM;
  ctx.fillStyle = "#e9e9e4";
  for (const side of [1, -1]) {
    const inner = side * (ROAD.medianHalf + ROAD.innerShoulder);
    const outer = side * (ROAD.carriagewayOuter - ROAD.outerShoulder);
    ctx.fillRect(xToPx(inner) - lineW / 2, 0, lineW, h);
    ctx.fillRect(xToPx(outer) - lineW / 2, 0, lineW, h);
    for (let i = 1; i < ROAD.lanes; i++) {
      const x = side * (ROAD.medianHalf + ROAD.innerShoulder + ROAD.laneWidth * i);
      ctx.fillRect(xToPx(x) - lineW / 2, 0, lineW, 3 * pxPerM);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function grassTexture() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext("2d");
  noiseFill(ctx, 512, 512, "#8c9a7a", 0.25, 14000);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// World

const world = new THREE.Group();
scene.add(world);

const GROUND_TILE = 20;
const GROUND_SIZE = 4000;
const grassTex = grassTexture();
grassTex.repeat.set(GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
  new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
world.add(ground);

const ROAD_LENGTH = 1300;
const roadTex = roadTexture();
roadTex.repeat.set(1, ROAD_LENGTH / ROAD.dashPeriod);
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD.textureWidth, ROAD_LENGTH),
  new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85, metalness: 0 })
);
road.rotation.x = -Math.PI / 2;
road.receiveShadow = true;
world.add(road);

const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b9b3, roughness: 0.9 });
const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 });

const medianBarrier = new THREE.Mesh(new THREE.BoxGeometry(ROAD.barrierHalf * 2, 0.85, ROAD_LENGTH), concrete);
medianBarrier.position.y = 0.425;
medianBarrier.castShadow = true;
medianBarrier.receiveShadow = true;
world.add(medianBarrier);

const rails = [];
for (const side of [1, -1]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, ROAD_LENGTH), steel);
  rail.position.set(side * ROAD.railX, 0.72, 0);
  rail.castShadow = true;
  world.add(rail);
  rails.push(rail);
}

// Repeating props. Each group keeps N instances in a window around the car.

function makeRepeater({ mesh, spacing, window: win, place }) {
  const count = Math.ceil((win * 2) / spacing) + 1;
  const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, count);
  inst.castShadow = mesh.castShadow;
  inst.receiveShadow = mesh.receiveShadow;
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Instances move every frame; the cached bounding sphere would cull them wrongly.
  inst.frustumCulled = false;
  world.add(inst);
  const m = new THREE.Matrix4();
  return {
    update(carZ) {
      const first = Math.floor((carZ - win) / spacing);
      for (let i = 0; i < count; i++) {
        const idx = first + i;
        place(idx, idx * spacing, m);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
    },
  };
}

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const repeaters = [];
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3(1, 1, 1);
const yAxis = new THREE.Vector3(0, 1, 0);

// Guardrail posts, both sides.
for (const side of [1, -1]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.1), steel);
  post.castShadow = true;
  repeaters.push(
    makeRepeater({
      mesh: post,
      spacing: 4,
      window: 320,
      place: (idx, z, m) => {
        pos.set(side * (ROAD.railX + 0.06), 0.375, z);
        m.compose(pos, quat.identity(), scl.set(1, 1, 1));
      },
    })
  );
}

// Lamp posts on the median.
{
  const geo = new THREE.CylinderGeometry(0.09, 0.14, 11, 8);
  const lamp = new THREE.Mesh(geo, steel);
  lamp.castShadow = true;
  repeaters.push(
    makeRepeater({
      mesh: lamp,
      spacing: 45,
      window: 650,
      place: (idx, z, m) => {
        pos.set(0, 5.5 + 0.85, z);
        m.compose(pos, quat.identity(), scl.set(1, 1, 1));
      },
    })
  );
  const arm = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.14, 0.14), steel);
  repeaters.push(
    makeRepeater({
      mesh: arm,
      spacing: 45,
      window: 650,
      place: (idx, z, m) => {
        pos.set(0, 11.2, z);
        m.compose(pos, quat.identity(), scl.set(1, 1, 1));
      },
    })
  );
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.6 }));
  for (const side of [1, -1]) {
    repeaters.push(
      makeRepeater({
        mesh: head,
        spacing: 45,
        window: 650,
        place: (idx, z, m) => {
          pos.set(side * 3.1, 11.1, z);
          m.compose(pos, quat.identity(), scl.set(1, 1, 1));
        },
      })
    );
  }
}

// Overpasses.
{
  const deck = new THREE.Mesh(new THREE.BoxGeometry(46, 1.6, 9), concrete);
  deck.castShadow = true;
  deck.receiveShadow = true;
  repeaters.push(
    makeRepeater({
      mesh: deck,
      spacing: 520,
      window: 800,
      place: (idx, z, m) => {
        pos.set(0, 6.6, z + 260);
        m.compose(pos, quat.identity(), scl.set(1, 1, 1));
      },
    })
  );
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 2.6), concrete);
  pillar.castShadow = true;
  for (const x of [-20.5, 20.5]) {
    repeaters.push(
      makeRepeater({
        mesh: pillar,
        spacing: 520,
        window: 800,
        place: (idx, z, m) => {
          pos.set(x, 3, z + 260);
          m.compose(pos, quat.identity(), scl.set(1, 1, 1));
        },
      })
    );
  }
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(46, 1.1, 0.3), concrete);
  for (const dz of [-4.35, 4.35]) {
    repeaters.push(
      makeRepeater({
        mesh: parapet,
        spacing: 520,
        window: 800,
        place: (idx, z, m) => {
          pos.set(0, 7.95, z + 260 + dz);
          m.compose(pos, quat.identity(), scl.set(1, 1, 1));
        },
      })
    );
  }
}

// Trees scattered along both verges.
{
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 7), new THREE.MeshStandardMaterial({ color: 0x5f7358, roughness: 1 }));
  canopy.castShadow = true;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x6e5d4b, roughness: 1 }));
  for (const side of [1, -1]) {
    const placeTree = (part) => (idx, z, m) => {
      const h1 = hash(idx * 2 + side);
      const h2 = hash(idx * 3 + side * 7);
      const h3 = hash(idx * 5 + side * 11);
      const x = side * (26 + h1 * 60);
      const s = 0.7 + h2 * 0.9;
      const y = part === "canopy" ? 2.2 * s + 3.5 * s : 1.1 * s;
      pos.set(x, y, z + h3 * 9);
      quat.setFromAxisAngle(yAxis, h1 * Math.PI);
      m.compose(pos, quat, scl.set(s, s, s));
    };
    repeaters.push(makeRepeater({ mesh: canopy, spacing: 11, window: 520, place: placeTree("canopy") }));
    repeaters.push(makeRepeater({ mesh: trunk, spacing: 11, window: 520, place: placeTree("trunk") }));
  }
}

// Distant hills.
{
  const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial({ color: 0xa9b4bf, roughness: 1 }));
  for (const side of [1, -1]) {
    repeaters.push(
      makeRepeater({
        mesh: hill,
        spacing: 140,
        window: 1100,
        place: (idx, z, m) => {
          const h1 = hash(idx * 13 + side * 3);
          const h2 = hash(idx * 17 + side * 5);
          const rx = 160 + h1 * 160;
          const ry = 40 + h2 * 70;
          pos.set(side * (340 + h2 * 260), -6, z + h1 * 80);
          m.compose(pos, quat.identity(), scl.set(rx, ry, 220));
        },
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Car

const carRoot = new THREE.Group();
scene.add(carRoot);

const car = {
  x: ROAD.laneCenter(1),
  z: 0,
  yaw: 0,
  v: 0,
  accel: 0,
  steer: 0,
  body: null,
  wheels: [],
  frontPivots: [],
  hitFlash: 0,
  touching: false,
};

const bodyMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x0b2247,
  metalness: 0.45,
  roughness: 0.28,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
});
const detailsMaterial = new THREE.MeshStandardMaterial({ color: 0x9da3ac, metalness: 1.0, roughness: 0.3 });
// No transmission here: it would render the scene twice per frame.
const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xdfe8f2, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.35 });

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/");
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

gltfLoader.load(
  "assets/ferrari.glb",
  (gltf) => {
    const model = gltf.scene.children[0];
    model.getObjectByName("body").material = bodyMaterial;
    ["rim_fl", "rim_fr", "rim_rr", "rim_rl", "trim"].forEach((n) => {
      const o = model.getObjectByName(n);
      if (o) o.material = detailsMaterial;
    });
    model.getObjectByName("glass").material = glassMaterial;

    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });

    // Wrap the body so roll and pitch can be applied without touching its own transform.
    const main = model.getObjectByName("main");
    const bodyPivot = new THREE.Group();
    main.parent.add(bodyPivot);
    bodyPivot.add(main);
    car.body = bodyPivot;

    for (const name of ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]) {
      const wheel = model.getObjectByName(name);
      if (!wheel) continue;
      car.wheels.push(wheel);
      if (name.startsWith("wheel_f")) {
        const pivot = new THREE.Group();
        pivot.position.copy(wheel.position);
        wheel.position.set(0, 0, 0);
        wheel.parent.add(pivot);
        pivot.add(wheel);
        car.frontPivots.push(pivot);
      }
    }

    carRoot.add(model);

    loaderText.textContent = "Prêt";
    loaderBar.style.width = "100%";
    requestAnimationFrame(() => document.body.classList.add("ready"));
  },
  (xhr) => {
    if (xhr.total) {
      const p = Math.round((xhr.loaded / xhr.total) * 100);
      loaderBar.style.width = p + "%";
      loaderText.textContent = "Chargement de la voiture " + p + " %";
    }
  },
  () => {
    loaderText.textContent = "La voiture n'a pas pu être chargée. Vérifiez que le dossier assets/ est présent puis rechargez la page.";
  }
);

// ---------------------------------------------------------------------------
// Input

const keys = { gas: false, brake: false, left: false, right: false, hand: false };
const keyMap = {
  ArrowUp: "gas",
  KeyW: "gas",
  KeyZ: "gas",
  ArrowDown: "brake",
  KeyS: "brake",
  ArrowLeft: "left",
  KeyA: "left",
  KeyQ: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "hand",
};

let driving = false;
function startDriving() {
  if (driving) return;
  driving = true;
  startEl.classList.add("hidden");
  document.body.classList.add("driving");
}

function resetCar() {
  car.x = ROAD.laneCenter(1);
  car.z = 0;
  car.yaw = 0;
  car.v = 0;
  car.steer = 0;
}

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "BUTTON") return;
  startDriving();
  const k = keyMap[e.code];
  if (k) {
    keys[k] = true;
    e.preventDefault();
  }
  if (e.code === "KeyR") resetCar();
  if (e.code === "KeyC") cycleCamera();
  if (e.code === "KeyM") toggleSound();
});
window.addEventListener("keyup", (e) => {
  const k = keyMap[e.code];
  if (k) keys[k] = false;
});
window.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button, a")) return;
  startDriving();
});

document.querySelectorAll(".touch-button").forEach((btn) => {
  const key = btn.dataset.key;
  const on = (e) => {
    e.preventDefault();
    keys[key] = true;
    btn.classList.add("active");
    startDriving();
  };
  const off = () => {
    keys[key] = false;
    btn.classList.remove("active");
  };
  btn.addEventListener("pointerdown", on);
  btn.addEventListener("pointerup", off);
  btn.addEventListener("pointercancel", off);
  btn.addEventListener("pointerleave", off);
});

// Touch steering slider: analog value in [-1, 1], springs back to 0 on release.
const touchSteer = { value: 0 };
const steerEl = document.getElementById("touch-steer");
const steerKnob = document.getElementById("touch-steer-knob");
if (steerEl) {
  let steerPointer = null;
  const setFromX = (clientX) => {
    const r = steerEl.getBoundingClientRect();
    const v = THREE.MathUtils.clamp(((clientX - r.left) / r.width) * 2 - 1, -1, 1);
    touchSteer.value = -v; // left on screen = positive steer
    steerKnob.style.transform = `translateX(${(v * r.width) / 2}px)`;
  };
  steerEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    steerPointer = e.pointerId;
    steerEl.setPointerCapture(e.pointerId);
    steerEl.classList.add("active");
    setFromX(e.clientX);
    startDriving();
  });
  steerEl.addEventListener("pointermove", (e) => {
    if (e.pointerId === steerPointer) setFromX(e.clientX);
  });
  const release = (e) => {
    if (e.pointerId !== steerPointer) return;
    steerPointer = null;
    touchSteer.value = 0;
    steerEl.classList.remove("active");
    steerKnob.style.transform = "translateX(0)";
  };
  steerEl.addEventListener("pointerup", release);
  steerEl.addEventListener("pointercancel", release);
}

// Show the right instructions for the input available.
document.querySelectorAll(finePointer ? "[data-coarse]" : "[data-fine]").forEach((el) => (el.hidden = true));
document.querySelectorAll(finePointer ? "[data-fine]" : "[data-coarse]").forEach((el) => (el.hidden = false));

const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
if (finePointer && !reducedMotion) {
  window.addEventListener("pointermove", (e) => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
  });
}

// Camera modes

const cameraModes = ["poursuite", "capot", "cinéma"];
let cameraMode = 0;
function cycleCamera() {
  cameraMode = (cameraMode + 1) % cameraModes.length;
  cameraToggle.textContent = "Caméra : " + cameraModes[cameraMode];
}
cameraToggle.addEventListener("click", cycleCamera);

// Sound: a small synthesized V8.

let audio = null;
let soundOn = false;
function toggleSound() {
  if (!audio) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    const osc2 = ctx.createOscillator();
    osc2.type = "square";
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc1.start();
    osc2.start();
    audio = { ctx, osc1, osc2, filter, gain };
  }
  soundOn = !soundOn;
  if (soundOn) audio.ctx.resume();
  soundToggle.textContent = soundOn ? "Son actif" : "Son coupé";
  soundToggle.setAttribute("aria-pressed", String(soundOn));
}
soundToggle.addEventListener("click", toggleSound);

// ---------------------------------------------------------------------------
// Simulation

const GEARS_KMH = [0, 55, 95, 140, 185, 235, 285, 330];

function gearFor(kmh) {
  for (let i = GEARS_KMH.length - 1; i >= 1; i--) {
    if (kmh >= GEARS_KMH[i - 1]) return i;
  }
  return 1;
}

function stepCar(dt) {
  const throttle = keys.gas ? 1 : 0;
  const brake = keys.brake ? 1 : 0;
  const steerTarget = touchSteer.value !== 0 ? touchSteer.value : (keys.left ? 1 : 0) - (keys.right ? 1 : 0);

  // Steering: quick to respond, tighter lock at speed.
  const lock = 0.55 / (1 + Math.abs(car.v) / 14);
  car.steer = THREE.MathUtils.damp(car.steer, steerTarget * lock, 8, dt);

  let a = 0;
  const v = car.v;
  const speedRatio = Math.min(Math.abs(v) / CAR.vmax, 1);

  if (throttle && v >= -0.5) {
    a += 10.5 * (1 - Math.pow(speedRatio, 1.6));
  }
  if (brake) {
    if (v > 0.6) a -= 15;
    else if (v > -CAR.reverseMax) a -= 4; // reverse
  }
  if (keys.hand) a -= v > 0 ? 20 : v < 0 ? -20 : 0;

  // Drag and rolling resistance.
  a -= 0.0028 * v * Math.abs(v);
  if (!throttle && !brake) a -= Math.sign(v) * Math.min(Math.abs(v) / dt, 0.9);

  // Off the asphalt: grass slows you down.
  const onAsphalt = car.x > ROAD.medianHalf && car.x < ROAD.carriagewayOuter;
  if (!onAsphalt) a -= Math.sign(v) * Math.min(Math.abs(v) / dt, 5);

  car.accel = a;
  car.v += a * dt;
  if (Math.abs(car.v) < 0.02 && !throttle && !brake) car.v = 0;

  // Bicycle model.
  if (Math.abs(car.v) > 0.01) {
    car.yaw += (car.v / CAR.wheelbase) * Math.tan(car.steer) * dt;
  }
  const fx = -Math.sin(car.yaw);
  const fz = -Math.cos(car.yaw);
  car.x += fx * car.v * dt;
  car.z += fz * car.v * dt;

  // Barriers: a hit costs speed once, then the car scrapes along and straightens out.
  const minX = ROAD.barrierHalf + CAR.halfWidth + 0.05;
  const maxX = ROAD.railX - CAR.halfWidth - 0.05;
  car.x = THREE.MathUtils.clamp(car.x, minX, maxX);
  // "Touching" means sitting against a wall while still pointing into it.
  const hitting = (car.x >= maxX - 0.02 && fx * car.v > 0) || (car.x <= minX + 0.02 && fx * car.v < 0);
  if (hitting) {
    if (!car.touching && Math.abs(car.v) > 2) {
      car.v *= 0.6;
      car.hitFlash = 1;
    }
    // Rub along the wall: keep the component of motion parallel to it.
    car.v *= Math.exp(-(1 - Math.abs(fz)) * 6 * dt);
    // Turn the nose parallel to the wall, whichever way it is closest.
    const parallel = Math.abs(Math.sin(car.yaw)) < Math.SQRT1_2 ? Math.round(car.yaw / Math.PI) * Math.PI : car.yaw;
    car.yaw = THREE.MathUtils.damp(car.yaw, parallel, 6, dt);
  }
  car.touching = hitting;
  car.hitFlash = Math.max(0, car.hitFlash - dt * 3);

  // Apply to the scene graph.
  carRoot.position.set(car.x, 0, car.z);
  carRoot.rotation.y = car.yaw;

  if (car.body) {
    const roll = THREE.MathUtils.clamp(-car.steer * car.v * 0.0045, -0.045, 0.045);
    const pitch = THREE.MathUtils.clamp(car.accel * 0.0035, -0.03, 0.03);
    car.body.rotation.z = THREE.MathUtils.damp(car.body.rotation.z, roll, 6, dt);
    car.body.rotation.x = THREE.MathUtils.damp(car.body.rotation.x, pitch, 6, dt);
  }
  const wheelDelta = (car.v * dt) / CAR.wheelRadius;
  for (const w of car.wheels) w.rotation.x -= wheelDelta;
  for (const p of car.frontPivots) p.rotation.y = car.steer;
}

// Camera

// The camera is placed rigidly relative to the car each frame; only its
// orbit parameters are smoothed. That keeps it glued to the car even when
// the frame rate drops, while still feeling soft.
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const orbit = { phi: Math.PI, dist: 6.4, height: 1.9, lookAhead: 2.5, fov: 40 };
const fwd = new THREE.Vector3();

function dampAngle(current, target, lambda, dt) {
  let delta = target - current;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function stepCamera(dt) {
  mouse.x = THREE.MathUtils.damp(mouse.x, mouse.tx, 4, dt);
  mouse.y = THREE.MathUtils.damp(mouse.y, mouse.ty, 4, dt);

  fwd.set(-Math.sin(car.yaw), 0, -Math.cos(car.yaw));
  const speed = Math.abs(car.v);
  const mode = cameraModes[cameraMode];

  if (mode === "poursuite") {
    // Relative orbit angle: behind the car, swung by the pointer and a touch of steering lag.
    const targetPhi = Math.PI - mouse.x * 0.9 - car.steer * Math.min(speed, 30) * 0.02;
    orbit.phi = dampAngle(orbit.phi, targetPhi, 6, dt);
    // Portrait screens are narrow: pull back and rise a little so the car does not fill the frame.
    const portrait = THREE.MathUtils.clamp(1 - camera.aspect, 0, 0.6);
    orbit.dist = THREE.MathUtils.damp(orbit.dist, 6.4 + speed * 0.03 + portrait * 4, 4, dt);
    orbit.height = THREE.MathUtils.damp(orbit.height, 1.9 + speed * 0.008 - mouse.y * 0.7 + portrait * 1.2, 4, dt);
    orbit.fov = THREE.MathUtils.damp(orbit.fov, 40 + (Math.min(speed, 80) / 80) * 12, 3, dt);
    const phi = car.yaw + orbit.phi;
    camPos.set(car.x - Math.sin(phi) * orbit.dist, orbit.height, car.z - Math.cos(phi) * orbit.dist);
    camLook.set(car.x + fwd.x * 2.5, 0.7, car.z + fwd.z * 2.5);
    camera.fov = orbit.fov;
  } else if (mode === "capot") {
    // On the bonnet, just ahead of the windscreen.
    const look = car.yaw - mouse.x * 0.6;
    camPos.set(car.x + fwd.x * 1.35, 0.98, car.z + fwd.z * 1.35);
    camLook.set(camPos.x - Math.sin(look) * 30, 0.9 - mouse.y * 4, camPos.z - Math.cos(look) * 30);
    camera.fov = 60 + (Math.min(speed, 80) / 80) * 8;
  } else {
    // Cinema: fixed on the outer side of the road so the median barrier never blocks the view.
    const targetPhi = -Math.PI / 2 - 0.35 - mouse.x * 1.1;
    orbit.phi = dampAngle(orbit.phi, targetPhi, 3, dt);
    orbit.height = THREE.MathUtils.damp(orbit.height, 1.4 - mouse.y * 0.8, 3, dt);
    const dist = 7.5;
    let dx = -Math.sin(orbit.phi) * dist;
    let dz = -Math.cos(orbit.phi) * dist;
    // Never put the camera beyond the guardrail: slide it back along the road instead.
    const maxDx = ROAD.railX - 0.6 - car.x;
    if (dx > maxDx) {
      dx = Math.max(maxDx, 0.5);
      dz = Math.sign(dz || 1) * Math.sqrt(Math.max(dist * dist - dx * dx, 1));
    }
    camPos.set(car.x + dx, orbit.height, car.z + dz);
    camLook.set(car.x, 0.55, car.z);
    camera.fov = 34;
  }

  // Tiny shake at very high speed and on impact.
  const shake = (speed > 60 ? (speed - 60) / 30 : 0) * 0.02 + car.hitFlash * 0.05;
  if (shake > 0 && !reducedMotion) {
    camPos.x += (Math.random() - 0.5) * shake;
    camPos.y += (Math.random() - 0.5) * shake;
  }

  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.updateProjectionMatrix();
}

// World follow

function stepWorld() {
  const zSnapRoad = Math.round(car.z / ROAD.dashPeriod) * ROAD.dashPeriod;
  road.position.z = zSnapRoad;
  medianBarrier.position.z = zSnapRoad;
  for (const r of rails) r.position.z = zSnapRoad;

  ground.position.x = Math.round(car.x / GROUND_TILE) * GROUND_TILE;
  ground.position.z = Math.round(car.z / GROUND_TILE) * GROUND_TILE;

  for (const r of repeaters) r.update(car.z);

  sky.position.copy(camera.position);

  sun.position.set(car.x + sunOffset.x, sunOffset.y, car.z + sunOffset.z);
  sun.target.position.set(car.x, 0, car.z);
}

// HUD and sound

let hudTimer = 0;
function stepHud(dt) {
  hudTimer += dt;
  const kmh = Math.abs(car.v) * 3.6;
  const gear = car.v < -0.3 ? "R" : kmh < 1 ? "N" : String(gearFor(kmh));
  let rpmFrac;
  if (gear === "N") rpmFrac = keys.gas ? 0.5 : 0.1;
  else if (gear === "R") rpmFrac = Math.min(kmh / 30, 1);
  else {
    const g = Number(gear);
    const lo = GEARS_KMH[g - 1];
    const hi = GEARS_KMH[g];
    rpmFrac = 0.25 + 0.75 * THREE.MathUtils.clamp((kmh - lo) / (hi - lo), 0, 1);
  }

  if (hudTimer > 0.08) {
    hudTimer = 0;
    hudSpeed.textContent = String(Math.round(kmh));
    hudGear.textContent = gear;
    hudRpm.style.width = Math.round(rpmFrac * 100) + "%";
  }

  if (audio) {
    const rpm = 900 + rpmFrac * 8100;
    const f = (rpm / 60) * 4;
    const t = audio.ctx.currentTime;
    audio.osc1.frequency.setTargetAtTime(f, t, 0.05);
    audio.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    audio.filter.frequency.setTargetAtTime(300 + rpm * 0.12, t, 0.05);
    const target = soundOn ? 0.025 + (keys.gas ? 0.05 : 0.015) * (0.4 + rpmFrac) : 0;
    audio.gain.gain.setTargetAtTime(target, t, 0.08);
  }
}

// ---------------------------------------------------------------------------
// Loop

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Physics runs at a fixed rate so a slow frame never becomes a slow car.
const FIXED_DT = 1 / 120;
let accumulator = 0;
function simulate(dt) {
  accumulator = Math.min(accumulator + dt, 0.25);
  while (accumulator >= FIXED_DT) {
    stepCar(FIXED_DT);
    accumulator -= FIXED_DT;
  }
}

const clock = new THREE.Clock();

// Adaptive resolution: weak GPUs drop render scale rather than frame rate.
const quality = { ratio: Math.min(window.devicePixelRatio, 1.25), min: 0.6, frames: 0, time: 0 };
function adaptQuality(dt) {
  quality.frames++;
  quality.time += dt;
  if (quality.time < 1.5) return;
  const fps = quality.frames / quality.time;
  quality.frames = 0;
  quality.time = 0;
  let next = quality.ratio;
  if (fps < 28) next = Math.max(quality.min, quality.ratio * 0.85);
  else if (fps > 56) next = Math.min(Math.min(window.devicePixelRatio, 1.25), quality.ratio * 1.1);
  if (Math.abs(next - quality.ratio) > 0.01) {
    quality.ratio = next;
    renderer.setPixelRatio(quality.ratio);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

function animate() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.25);

  if (driving) simulate(dt);
  stepCamera(Math.min(dt, 0.05));
  stepWorld();
  stepHud(dt);
  adaptQuality(rawDt);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

stepWorld();
animate();
