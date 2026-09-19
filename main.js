import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CARS, carFromLocation, rememberCar } from "./cars.js?v=3";
import { loadVehicle } from "./vehicles.js?v=4";

const canvas = document.getElementById("scene");
const loaderBar = document.getElementById("loader-bar");
const loaderText = document.getElementById("loader-text");
const hint = document.getElementById("hint");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;

const fail = (message) => {
  loaderText.textContent = message;
  loaderBar.style.width = "0%";
};
window.addEventListener("error", (e) => fail("Une erreur a interrompu le studio : " + (e.message || "erreur inconnue") + ". Voir la page Documentation, section Dépannage."), { once: true });

if (!document.body.classList.contains("no-webgl")) boot();

function boot() {
  // ---------------------------------------------------------------------------
  // Rendu

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 100);

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 6, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -4;
  key.shadow.camera.right = key.shadow.camera.top = 4;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.0005;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe6f2, 0.7);
  fill.position.set(-5, 2, -4);
  scene.add(fill);

  // Sol d'ombre : invisible, ne reçoit que l'ombre portée.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Le pivot reçoit la rotation souris / tactile ; la voiture est un enfant du pivot.
  const pivot = new THREE.Group();
  scene.add(pivot);

  // ---------------------------------------------------------------------------
  // Caméras (en mètres, pour une voiture de 4,5 m ; mises à l'échelle par voiture)

  const VIEWS = {
    hero: { pos: [6.0, 1.6, -5.9], target: [0.6, 0.15, 0.45] },
    aero: { pos: [-2.2, 0.55, -4.1], target: [0.5, 0.45, -1.7] },
    wheel: { pos: [2.5, 0.6, -2.6], target: [0.8, 0.35, -1.3] },
    rear: { pos: [-3.2, 1.05, 3.9], target: [-0.4, 0.6, 0.75] },
    top: { pos: [0.3, 8.0, 0.9], target: [1.1, 0.4, -0.1] },
    specs: { pos: [-5.6, 1.0, -3.4], target: [0.7, 0.35, -1.1] },
  };
  let viewScale = 1;
  let currentView = "hero";

  const cameraState = {
    pos: new THREE.Vector3().fromArray(VIEWS.hero.pos),
    target: new THREE.Vector3().fromArray(VIEWS.hero.target),
    goalPos: new THREE.Vector3().fromArray(VIEWS.hero.pos),
    goalTarget: new THREE.Vector3().fromArray(VIEWS.hero.target),
  };

  function setView(name) {
    const v = VIEWS[name];
    if (!v) return;
    currentView = name;
    cameraState.goalPos.fromArray(v.pos).multiplyScalar(viewScale);
    cameraState.goalTarget.fromArray(v.target).multiplyScalar(viewScale);
  }
  window.__setView = setView;

  const observer = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && setView(e.target.dataset.view)),
    { threshold: 0.55 }
  );
  function observeSections() {
    observer.disconnect();
    document.querySelectorAll("[data-view]").forEach((s) => observer.observe(s));
  }

  // ---------------------------------------------------------------------------
  // Entrées : souris (desktop) / glisser (tactile)

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const spin = { yaw: 0, vel: 0, active: false, lastX: 0, lastT: 0 };
  let hintDismissed = false;
  const dismissHint = () => {
    if (hintDismissed) return;
    hintDismissed = true;
    hint.classList.add("hidden");
  };

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
  const endSpin = () => (spin.active = false);
  window.addEventListener("pointerup", endSpin);
  window.addEventListener("pointercancel", endSpin);

  // ---------------------------------------------------------------------------
  // Contenu : textes, sections, sélecteur

  const el = {
    kicker: document.getElementById("hero-kicker"),
    title: document.getElementById("hero-title"),
    lead: document.getElementById("hero-lead"),
    heroDrive: document.getElementById("hero-drive"),
    cardDrive: document.getElementById("card-drive"),
    navDrive: document.getElementById("nav-drive"),
    details: document.getElementById("details"),
    specBody: document.getElementById("spec-body"),
    railList: document.getElementById("rail-list"),
    rail: document.getElementById("rail"),
  };

  const SPEC_LABELS = {
    moteur: "Moteur",
    puissance: "Puissance",
    couple: "Couple",
    zeroCent: "0 – 100 km/h",
    vmax: "Vitesse maximale",
    poids: "Poids",
    transmission: "Transmission",
  };

  function renderCar(car) {
    document.title = `${car.brand} ${car.model} — La Collection`;
    el.kicker.textContent = `${car.rank} / ${CARS.length} · ${car.tier} · ${car.origin}, ${car.years}`;
    el.title.innerHTML = `${car.brand}<br />${car.model}`;
    el.lead.textContent = `${car.lead} ${finePointer ? "Déplacez la souris pour tourner autour, faites défiler pour approcher." : "Glissez pour tourner autour, faites défiler pour approcher."}`;
    const driveUrl = `drive.html?car=${car.id}`;
    el.heroDrive.href = el.cardDrive.href = el.navDrive.href = driveUrl;

    el.details.innerHTML = car.sections
      .map(
        (s, i) => `
      <section class="view detail" data-view="${s.view}" id="detail-${i}">
        <article class="card">
          <h2>${s.title}</h2>
          <p>${s.text}</p>
          <dl class="facts">${s.facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
        </article>
      </section>`
      )
      .join("");
    car.sections.slice(0, 3).forEach((s, i) => {
      const a = document.getElementById(`nav-detail-${i}`);
      if (a) a.textContent = s.title;
    });

    el.specBody.innerHTML =
      Object.entries(car.specs)
        .map(([k, v]) => `<tr><th scope="row">${SPEC_LABELS[k] || k}</th><td>${v}</td></tr>`)
        .join("") +
      `<tr><th scope="row">Prix indicatif</th><td>${car.price}</td></tr>` +
      `<tr><th scope="row">Production</th><td>${car.origin}, ${car.years}</td></tr>`;

    [...el.railList.children].forEach((li) => li.classList.toggle("current", li.dataset.id === car.id));
    const cur = el.railList.querySelector(".current");
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "center", behavior: reducedMotion ? "auto" : "smooth" });

    observeSections();
  }

  function buildRail() {
    el.railList.innerHTML = CARS.map(
      (c) => `<li data-id="${c.id}"><button type="button" class="rail-item" data-id="${c.id}">
        <span class="rail-rank">${String(c.rank).padStart(2, "0")}</span>
        <span class="rail-swatch" style="--paint:${c.paint}"></span>
        <span class="rail-name"><strong>${c.brand}</strong> ${c.model}</span>
      </button></li>`
    ).join("");
    el.railList.addEventListener("click", (e) => {
      const b = e.target.closest(".rail-item");
      if (b) showCar(b.dataset.id);
    });
    document.getElementById("rail-prev").addEventListener("click", () => step(-1));
    document.getElementById("rail-next").addEventListener("click", () => step(1));
    window.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea")) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    });
  }

  function step(dir) {
    const i = CARS.findIndex((c) => c.id === current?.id);
    const next = CARS[(i + dir + CARS.length) % CARS.length];
    showCar(next.id);
  }

  // ---------------------------------------------------------------------------
  // Chargement et bascule de voiture

  let current = null;
  let vehicle = null;
  let switching = null;
  const swap = { t: 1, dir: 1, outgoing: null }; // t : 0 → 1 pendant la transition

  async function showCar(id) {
    const car = CARS.find((c) => c.id === id);
    if (!car || (current && current.id === id)) return;
    const prevRank = current ? current.rank : car.rank;
    current = car;
    rememberCar(car.id);
    history.replaceState(null, "", `?car=${car.id}`);
    viewScale = car.vehicle.length / 4.5;
    renderCar(car);
    setView(currentView);
    el.rail.classList.add("loading");
    const token = (switching = {});
    const v = await loadVehicle({ ...car.vehicle, paint: car.paint, accent: car.accent });
    if (token !== switching) return; // une autre bascule a eu lieu entre-temps
    el.rail.classList.remove("loading");

    // Transition : l'ancienne sort d'un côté, la nouvelle entre de l'autre.
    if (vehicle) {
      swap.outgoing = vehicle.group;
      swap.dir = car.rank >= prevRank ? 1 : -1;
      swap.t = 0;
    }
    vehicle = v;
    pivot.add(v.group);
    v.group.position.x = swap.outgoing ? -swap.dir * 9 : 0;
    // Recadre l'ombre sur la voiture.
    key.shadow.camera.left = key.shadow.camera.bottom = -car.vehicle.length * 0.8;
    key.shadow.camera.right = key.shadow.camera.top = car.vehicle.length * 0.8;
    key.shadow.camera.updateProjectionMatrix();

    if (!document.body.classList.contains("ready")) {
      loaderText.textContent = "Prêt";
      loaderBar.style.width = "100%";
      requestAnimationFrame(() => document.body.classList.add("ready"));
    }
    // Précharge les voisines pour une bascule instantanée.
    const i = CARS.indexOf(car);
    [CARS[i + 1], CARS[i - 1]].filter(Boolean).forEach((c) => loadVehicle({ ...c.vehicle, paint: c.paint, accent: c.accent }).catch(() => {}));
  }

  // ---------------------------------------------------------------------------
  // Boucle

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  const tmpTarget = new THREE.Vector3();
  const damp = (a, b, l, dt) => THREE.MathUtils.damp(a, b, l, dt);

  function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);

    mouse.x = damp(mouse.x, mouse.tx, 4, dt);
    mouse.y = damp(mouse.y, mouse.ty, 4, dt);
    if (!spin.active) {
      spin.yaw += spin.vel * dt;
      spin.vel *= Math.exp(-3 * dt);
    }
    pivot.rotation.y = mouse.x * 0.55 + spin.yaw;

    // Transition entre deux voitures.
    if (swap.t < 1) {
      swap.t = Math.min(1, swap.t + dt / (reducedMotion ? 0.01 : 0.7));
      const e = 1 - Math.pow(1 - swap.t, 3);
      if (swap.outgoing) swap.outgoing.position.x = swap.dir * 9 * e;
      if (vehicle) vehicle.group.position.x = -swap.dir * 9 * (1 - e);
      if (swap.t >= 1 && swap.outgoing) {
        pivot.remove(swap.outgoing);
        swap.outgoing = null;
      }
    }

    for (const k of ["x", "y", "z"]) {
      cameraState.pos[k] = damp(cameraState.pos[k], cameraState.goalPos[k], 2.2, dt);
      cameraState.target[k] = damp(cameraState.target[k], cameraState.goalTarget[k], 2.2, dt);
    }
    const portrait = Math.max(0, 1.3 - camera.aspect);
    tmpTarget.copy(cameraState.target);
    tmpTarget.y -= portrait * 0.5 * viewScale;
    camera.position.copy(cameraState.pos).sub(cameraState.target).multiplyScalar(1 + portrait * 2.3).add(cameraState.target);
    // En portrait la carte de texte occupe le bas de l'écran : on décale le cadrage pour que la
    // voiture reste dans le tiers supérieur, sans changer l'angle de vue.
    if (portrait > 0) {
      const W = renderer.domElement.width, H = renderer.domElement.height;
      camera.setViewOffset(W, H, 0, Math.round(portrait * H * 0.28), W, H);
    } else if (camera.view && camera.view.enabled) {
      camera.clearViewOffset();
    }
    camera.position.y += -mouse.y * 0.35;
    tmpTarget.y += -mouse.y * 0.08;
    camera.lookAt(tmpTarget);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  window.__renderStill = () => {
    renderer.render(scene, camera);
    return canvas.toDataURL("image/png");
  };

  // Démarrage
  buildRail();
  loaderText.textContent = "Chargement de la collection";
  loaderBar.style.width = "30%";
  showCar(carFromLocation().id).catch((err) => fail("Le modèle n'a pas pu être chargé : " + err.message));
  animate();
}
