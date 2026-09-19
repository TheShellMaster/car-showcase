import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const canvas = document.getElementById("scene");
const loader = document.getElementById("loader");
const loaderBar = document.getElementById("loader-bar");
const loaderText = document.getElementById("loader-text");
const hint = document.getElementById("hint");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;

// Renderer

// Fail loudly instead of leaving the loader on screen forever.
const fail = (message) => {
  loaderText.textContent = message;
  loaderBar.style.width = "0%";
};
window.addEventListener("error", (e) => fail("Une erreur a interrompu le studio : " + (e.message || "erreur inconnue") + ". Voir la page Documentation, section Dépannage."), { once: true });
const probe = document.createElement("canvas");
if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
  throw new Error("WebGL n'est pas disponible sur ce navigateur");
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.65;

const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 100);

// A soft key light gives the paint a readable highlight on top of the environment.
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(3, 6, 2);
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe6f2, 0.6);
fill.position.set(-5, 2, -4);
scene.add(fill);

// Materials

const bodyMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x0b2247,
  metalness: 0.45,
  roughness: 0.28,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
});
const detailsMaterial = new THREE.MeshStandardMaterial({
  color: 0x9da3ac,
  metalness: 1.0,
  roughness: 0.3,
});
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0.25,
  roughness: 0,
  transmission: 1.0,
  transparent: true,
});

// Car pivot: mouse yaw is applied here so camera presets stay clean.

const pivot = new THREE.Group();
scene.add(pivot);

// Camera presets per section

const views = {
  // The model's nose points towards -z.
  hero: { pos: [4.3, 1.25, -4.4], target: [0, 0.35, 0] },
  aero: { pos: [-2.2, 0.5, -4.1], target: [0.5, 0.45, -1.7] },
  wheel: { pos: [2.5, 0.55, -2.6], target: [0.8, 0.35, -1.3] },
  rear: { pos: [-3.2, 1.05, 3.9], target: [-0.4, 0.6, 0.75] },
  top: { pos: [0.3, 8.0, 0.9], target: [1.1, 0.4, -0.1] },
  specs: { pos: [-5.6, 1.0, -3.4], target: [0.7, 0.35, -1.1] },
};

const cameraState = {
  pos: new THREE.Vector3().fromArray(views.hero.pos),
  target: new THREE.Vector3().fromArray(views.hero.target),
  goalPos: new THREE.Vector3().fromArray(views.hero.pos),
  goalTarget: new THREE.Vector3().fromArray(views.hero.target),
};

function setView(name) {
  const v = views[name];
  if (!v) return;
  cameraState.goalPos.fromArray(v.pos);
  cameraState.goalTarget.fromArray(v.target);
}

const sections = document.querySelectorAll("[data-view]");
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) setView(entry.target.dataset.view);
    });
  },
  { threshold: 0.55 }
);
sections.forEach((s) => observer.observe(s));

// Input. Desktop: the car follows the pointer position. Touch: drag sideways to spin it.

const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
const spin = { yaw: 0, vel: 0, active: false, lastX: 0, lastT: 0 };
let hintDismissed = false;

function dismissHint() {
  if (hintDismissed) return;
  hintDismissed = true;
  hint.classList.add("hidden");
}

if (finePointer && !reducedMotion) {
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
    if (Math.abs(mouse.tx) > 0.3) dismissHint();
  });
} else if (!finePointer) {
  hint.querySelector("span:last-child").textContent = "Glissez le doigt pour faire tourner la voiture";
}

// With touch-action: pan-y on the page, vertical swipes scroll and horizontal ones reach us here.
window.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch" || e.target.closest("a, button")) return;
  spin.active = true;
  spin.vel = 0;
  spin.lastX = e.clientX;
  spin.lastT = performance.now();
});
window.addEventListener("pointermove", (e) => {
  if (!spin.active || e.pointerType !== "touch") return;
  const now = performance.now();
  const dx = e.clientX - spin.lastX;
  const dt = Math.max(now - spin.lastT, 1) / 1000;
  const delta = (dx / window.innerWidth) * Math.PI * 1.4;
  spin.yaw += delta;
  spin.vel = delta / dt;
  spin.lastX = e.clientX;
  spin.lastT = now;
  if (Math.abs(dx) > 2) dismissHint();
});
const endSpin = () => {
  spin.active = false;
};
window.addEventListener("pointerup", endSpin);
window.addEventListener("pointercancel", endSpin);

// Load model

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("vendor/three/examples/jsm/libs/draco/gltf/");
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

const shadowTexture = new THREE.TextureLoader().load("assets/ferrari_ao.png");

gltfLoader.load(
  "assets/ferrari.glb",
  (gltf) => {
    const car = gltf.scene.children[0];

    car.getObjectByName("body").material = bodyMaterial;
    ["rim_fl", "rim_fr", "rim_rr", "rim_rl", "trim"].forEach((n) => {
      const o = car.getObjectByName(n);
      if (o) o.material = detailsMaterial;
    });
    car.getObjectByName("glass").material = glassMaterial;

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
      new THREE.MeshBasicMaterial({
        map: shadowTexture,
        blending: THREE.MultiplyBlending,
        toneMapped: false,
        transparent: true,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;
    car.add(shadow);

    pivot.add(car);

    loaderText.textContent = "Prêt";
    loaderBar.style.width = "100%";
    requestAnimationFrame(() => document.body.classList.add("ready"));
  },
  (xhr) => {
    if (xhr.total) {
      const p = Math.round((xhr.loaded / xhr.total) * 100);
      loaderBar.style.width = p + "%";
      loaderText.textContent = "Chargement du modèle " + p + " %";
    }
  },
  () => {
    loaderText.textContent = "Le modèle n'a pas pu être chargé. Vérifiez que le dossier assets/ est présent puis rechargez la page.";
  }
);

// Resize

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Loop

const clock = new THREE.Clock();
const tmpTarget = new THREE.Vector3();

function damp(current, goal, lambda, dt) {
  return THREE.MathUtils.damp(current, goal, lambda, dt);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);

  mouse.x = damp(mouse.x, mouse.tx, 4, dt);
  mouse.y = damp(mouse.y, mouse.ty, 4, dt);

  // Car yaw: pointer position on desktop, drag with inertia on touch.
  if (!spin.active) {
    spin.yaw += spin.vel * dt;
    spin.vel *= Math.exp(-3 * dt);
  }
  pivot.rotation.y = mouse.x * 0.55 + spin.yaw;

  cameraState.pos.x = damp(cameraState.pos.x, cameraState.goalPos.x, 2.2, dt);
  cameraState.pos.y = damp(cameraState.pos.y, cameraState.goalPos.y, 2.2, dt);
  cameraState.pos.z = damp(cameraState.pos.z, cameraState.goalPos.z, 2.2, dt);
  cameraState.target.x = damp(cameraState.target.x, cameraState.goalTarget.x, 2.2, dt);
  cameraState.target.y = damp(cameraState.target.y, cameraState.goalTarget.y, 2.2, dt);
  cameraState.target.z = damp(cameraState.target.z, cameraState.goalTarget.z, 2.2, dt);

  // Portrait screens: back the camera off and drop the target so the car sits above the copy.
  const portrait = Math.max(0, 1.3 - camera.aspect);
  tmpTarget.copy(cameraState.target);
  tmpTarget.y -= portrait * 0.7;
  camera.position.copy(cameraState.pos).sub(cameraState.target).multiplyScalar(1 + portrait * 1.5).add(cameraState.target);

  // Vertical pointer position tilts the camera a little for parallax.
  camera.position.y += -mouse.y * 0.35;
  tmpTarget.y += -mouse.y * 0.08;
  camera.lookAt(tmpTarget);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
